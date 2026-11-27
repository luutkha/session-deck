// E2E (D92): the extra agent CLIs (Codex and ~40 more, from the registry in src/shared/cliAgents.ts) in the built app.
// A fake `codex.cmd` on PATH records how it was started. Checks: creating a session with cliAgent 'codex' starts the
// CLI with its yolo argument in the session folder, the card carries the agent badge, Jarvis reads its screen and types
// into it, list_sessions names the agent, a CLI that is not installed is refused with its install hint and leaves no
// session behind, an unknown id is refused, the id survives a restart, the New Session picker offers the agents.
// Run: node scripts/e2e-cli-agents.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9486
const js = (v) => JSON.stringify(v)

async function main() {
  const t = makeChecker()
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-cli-')))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  const proj = path.join(root, 'proj')
  fs.mkdirSync(proj)
  const log = path.join(root, 'fake-codex.log')
  // The fake agent: log argv + cwd, print a marker, then log every line typed into it.
  fs.writeFileSync(path.join(bin, 'fake.js'), [
    `const fs = require('node:fs')`,
    `fs.appendFileSync(${js(log)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + String.fromCharCode(10))`,
    `console.log('FAKE-CODEX READY')`,
    `process.stdin.setEncoding('utf8')`,
    `process.stdin.on('data', (d) => { fs.appendFileSync(${js(log)}, JSON.stringify({ typed: String(d) }) + String.fromCharCode(10)) })`,
    `setInterval(() => {}, 1000)`
  ].join(String.fromCharCode(10)))
  fs.writeFileSync(path.join(bin, 'codex.cmd'), '@node "%~dp0fake.js" %*\r\n')
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`
  const records = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (x) => app.evaluate(x)

    // ---- create through the app API: starts the fake CLI with the yolo arg
    const made = await ev(`window.api.createSession({ cwd: ${js(proj)}, agent: 'shell', cliAgent: 'codex' })`)
    t.check('the session is a shell session carrying cliAgent codex, named Codex', made.agent === 'shell' && made.cliAgent === 'codex' && made.name === 'Codex', JSON.stringify(made))
    const started = await waitFor(() => (records().find((r) => r.argv) ?? null), 10000, 200)
    t.check('the fake codex started with the yolo argument', !!started && started.argv.join(' ') === '--dangerously-bypass-approvals-and-sandbox', JSON.stringify(started))
    t.check('in the session folder', !!started && started.cwd.toLowerCase() === proj.toLowerCase(), started && started.cwd)

    // ---- the card shows the agent badge
    await sleep(800)
    const badge = await ev(`!!document.querySelector('[aria-label="Codex"]')`)
    t.check('the session card carries the Codex badge', badge)

    // ---- Jarvis: list, read screen, type
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const tool = async (name, args) => {
      const r = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: js({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
      const body = await r.json()
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    const listed = await tool('list_sessions', {})
    t.check('list_sessions names the session as Codex', !listed.error && /"Codex" \(id [^)]+\) · Codex ·/.test(listed.text), listed.text.slice(0, 200))
    const screen = await waitFor(async () => { const r = await tool('read_screen', { session: 'Codex' }); return /FAKE-CODEX READY/.test(r.text) ? r : null }, 10000, 300)
    t.check('read_screen shows the CLI output', !!screen)
    const sent = await tool('send_prompt', { session: 'Codex', text: 'hello codex' })
    const typed = await waitFor(() => (records().find((r) => r.typed && r.typed.includes('hello codex')) ?? null), 10000, 200)
    t.check('send_prompt types into the CLI', !sent.error && !!typed, sent.text)

    // ---- Jarvis can create one too; a missing CLI and an unknown id are refused
    const missing = await tool('create_session', { folder: proj, cli_agent: 'amp' })
    t.check('a CLI that is not installed is refused with its hint', missing.error && /Amp CLI not found/.test(missing.text), missing.text.slice(0, 160))
    const unknown = await tool('create_session', { folder: proj, cli_agent: 'no-such-agent' })
    t.check('an unknown cli_agent is refused', unknown.error && /Unknown cli_agent/.test(unknown.text), unknown.text.slice(0, 160))
    const store = await ev(`window.api.getStore()`)
    t.check('the refused sessions left nothing behind', store.data.sessions.filter((s) => s.cliAgent !== undefined).length === 1, String(store.data.sessions.length))
    const viaJarvis = await tool('create_session', { folder: proj, cli_agent: 'codex', name: 'Codex two' })
    t.check('Jarvis creates a codex session', !viaJarvis.error && /Created "Codex two"/.test(viaJarvis.text), viaJarvis.text.slice(0, 160))

    // ---- the New Session dialog offers the agents
    await ev(`document.querySelector('[aria-label="New session"], [data-new-session]')?.click()`)
    await sleep(800)
    await ev(`document.querySelector('#new-session-agent, [aria-label="Agent"]')?.click()`)
    await sleep(500)
    const offered = await ev(`document.querySelectorAll('[data-cli-agent-option]').length`)
    t.check('the Agent picker lists the extra agents', offered >= 30, String(offered))
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })

    // ---- restart: the id is kept
    await ev('window.api.quitApp()').catch(() => undefined)
    await sleep(3000)
    app.kill()
    await sleep(1000)
    app = await launchApp({ port: PORT, userData })
    await sleep(2000)
    const again = await app.evaluate(`window.api.getStore()`)
    t.check('after a restart the session still has cliAgent codex', again.data.sessions.some((s) => s.name === 'Codex' && s.cliAgent === 'codex'), JSON.stringify(again.data.sessions.map((s) => [s.name, s.cliAgent])))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
