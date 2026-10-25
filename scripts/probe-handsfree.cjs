// Probe (hands-free quota e2e): can a real Claude TUI session be armed with a FAKE UserPromptSubmit hook and then
// pushed into the "stopped at limit" hold by pasting the limit phrase (which the TUI echoes back as output)?
// Run: node scripts/probe-handsfree.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp, strip } = require('./e2e-lib.cjs')

const PHRASE = 'You have hit your usage limit, your limit will reset at 5pm'

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-probe-handsfree-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    app = await launchApp({ port: 9458 })
    await sleep(1500)
    const s = await app.evaluate(
      `window.api.createSession({ cwd: ${JSON.stringify(root)}, name: 'cut', agent: 'claude' })`
    )
    await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('cut'))?.click()`)
    await sleep(4000)
    // Dismiss first-run dialogs (folder trust: "No, exit" preselected -> Down first).
    for (let i = 0; i < 3; i++) {
      const raw = await app.evaluate(`window.api.ptyReplay(${JSON.stringify(s.id)}).then((r) => r.data.slice(-4000))`)
      const screen = strip(raw)
      if (/Yes, I trust this folder/.test(screen) && /No, exit/.test(screen)) {
        await app.evaluate(`window.api.ptyWrite(${JSON.stringify(s.id)}, '\\x1b[B')`)
        await sleep(500)
      }
      await app.evaluate(`window.api.ptyWrite(${JSON.stringify(s.id)}, '\\r')`)
      await sleep(2500)
    }
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(s.id)}/UserPromptSubmit`, {
      method: 'POST',
      headers: { 'x-token': endpoint.token, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'probe' })
    })
    await sleep(500)
    // Paste the limit phrase: the TUI echo must trigger readScreenSignals -> reportUsageLimit.
    await app.evaluate(`window.api.ptyWrite(${JSON.stringify(s.id)}, ${JSON.stringify(PHRASE)})`)
    const held = await waitFor(async () => {
      const st = await app.evaluate('window.api.getQuotaAutopilot()')
      return st.stoppedAtLimit.includes(s.id) ? st : null
    }, 6000, 300)
    t.check('pasting the limit phrase holds the session (stoppedAtLimit)', !!held, JSON.stringify(held))
    const after = strip(await app.evaluate(`window.api.ptyReplay(${JSON.stringify(s.id)}).then((r) => r.data)`))
    console.log('phrase in replay:', after.includes('hit your'), '| usage limit in replay:', /usage\s*limit/.test(after), '| will reset:', after.includes('will reset'))
    if (process.env.E2E_DEBUG) console.log('---- screen ----\n' + after.replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '').slice(-3000))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    sleep(300)
    fs.rmSync(root, { recursive: true, force: true })
  }
}
main()
