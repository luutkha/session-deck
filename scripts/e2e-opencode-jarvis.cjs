// E2E (D79): Jarvis and an OpenCode session. A real `opencode` TUI on a FREE model answers one tiny prompt, then over Jarvis's own
// MCP endpoint (the way a real Jarvis calls it): get_last_answer returns the OpenCode reply from `opencode session export`,
// search_conversations finds OpenCode text, fleet_digest lists every session with its state and reply, and the "ask me" permission
// policy is stored on the session. No model drives Jarvis: the tools are called directly.
// Run: npx electron-vite build && node scripts/e2e-opencode-jarvis.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const PORT = 9507
// The free model is often out of quota (then the export holds an error and no text); the paid flash model answers one word for a fraction of a cent.
const MODEL = process.env.OC_E2E_MODEL || 'opencode-go/deepseek-v4.1-flash'

async function main() {
  stopOpencodeService()
  const t = makeChecker()
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-ocjarvis-'))
  const userData = path.join(rootDir, 'userdata')
  fs.mkdirSync(userData)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const cfgFile = path.join(userData, 'jarvis', 'mcp.json')
    await waitFor(() => (fs.existsSync(cfgFile) ? true : null), 20000, 300)
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const tool = async (name, args = {}) => {
      const res = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
      const body = await res.json()
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    const store = () => app.evaluate('window.api.getStore()')
    const sessionOf = async (id) => (await store()).data.sessions.find((s) => s.id === id)
    const runtimeOf = async (id) => (await store()).runtime.find((r) => r.sessionId === id)

    // ---- an OpenCode session answers one prompt
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'oc digest', agent: 'opencode', model: ${JSON.stringify(MODEL)} })`)
    const id = JSON.stringify(s.id)
    t.check('the default OpenCode permission policy is yolo (nothing stored)', s.opencodePermissions === undefined || s.opencodePermissions === 'yolo', String(s.opencodePermissions))
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('oc digest')).click()`)
    const up = await waitFor(async () => (await runtimeOf(s.id))?.run === 'running', 40000, 1000)
    t.check('the OpenCode TUI starts', !!up)
    await sleep(4000)
    await app.evaluate(`window.api.ptyWrite(${id}, 'reply with the single word: pong')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${id}, '\\r')`)
    const finished = await waitFor(async () => (await runtimeOf(s.id))?.activity === 'finished', 90000, 500)
    t.check('the turn finishes (plugin idle event)', !!finished)
    const gotId = await waitFor(async () => /^ses_/.test((await sessionOf(s.id)).opencodeSessionId || ''), 10000, 300)
    t.check('the OpenCode conversation id was captured', !!gotId)
    t.check('the plugin reported, so the card is not flagged "plugin missing"', (await runtimeOf(s.id))?.opencodePlugin !== 'missing', String((await runtimeOf(s.id))?.opencodePlugin))

    // ---- get_last_answer reads the OpenCode conversation
    const answer = await tool('get_last_answer', { session: 'oc digest' })
    t.check('get_last_answer answers for an OpenCode session', !answer.error && /pong/i.test(answer.text) && !/^The last prompt has no reply/.test(answer.text), answer.text.slice(0, 160))
    t.check('the answer is the saved conversation, not a screen scrape', !/screen/i.test(answer.text.split('\n')[0]), answer.text.split('\n')[0].slice(0, 120))

    // ---- search_conversations finds OpenCode text
    const found = await waitFor(async () => {
      const r = await tool('search_conversations', { query: 'single word: pong' })
      return !r.error && /oc digest/.test(r.text) ? r : null
    }, 20000, 1000)
    t.check('search_conversations finds the OpenCode conversation', !!found, found ? '' : (await tool('search_conversations', { query: 'single word: pong' })).text.slice(0, 200))

    // ---- fleet_digest lists everything
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'plain shell', agent: 'shell' })`)
    await sleep(1500)
    const names = (await (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/list', params: {} }) })).json()).result.tools.map((x) => x.name)
    t.check('tools/list offers fleet_digest (87 tools in all)', names.includes('fleet_digest') && names.length === 87, String(names.length))
    const digest = await tool('fleet_digest')
    t.check('fleet_digest lists both sessions', !digest.error && digest.text.includes('oc digest') && digest.text.includes('plain shell'), digest.text.slice(0, 300))
    t.check('fleet_digest shows the OpenCode reply tail', /reply:[^\r\n]*pong/i.test(digest.text), digest.text.slice(0, 400))
    t.check('fleet_digest names the agent', /opencode/i.test(digest.text) && /shell/i.test(digest.text))
    const limited = await tool('fleet_digest', { limit: 1 })
    t.check('fleet_digest limit says how many were left out', !limited.error && /1 more|not shown/i.test(limited.text), limited.text.slice(-160))
    const bad = await tool('fleet_digest', { limit: 'many' })
    t.check('a bad limit is refused with a message, not a crash', bad.error || /limit/i.test(bad.text), bad.text.slice(0, 160))

    // ---- the "ask me" permission policy is stored and survives a restart of the store read
    const ask = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'oc ask', agent: 'opencode', model: ${JSON.stringify(MODEL)}, opencodePermissions: 'ask' })`)
    t.check('createSession stores opencodePermissions "ask"', (await sessionOf(ask.id)).opencodePermissions === 'ask')
    const claude = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'shell ask', agent: 'shell', opencodePermissions: 'ask' })`).catch(() => null)
    t.check('the option is ignored (or refused) for a non-OpenCode session', claude === null || claude.opencodePermissions === undefined, JSON.stringify(claude && claude.opencodePermissions))
  } catch (error) {
    t.check('e2e ran without an exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    if (app) app.kill()
    stopOpencodeService()
    fs.rmSync(rootDir, { recursive: true, force: true })
    process.exit(t.summary() === 0 ? 0 : 1)
  }
}

main()
