// E2E (D48): send one prompt to several sessions from the bulk bar, through the real UI.
// A fake `claude` on PATH records every byte per session (no real Claude, ~/.claude is never touched).
// Verifies: Ctrl+click selection shows a Prompt button, the dialog explains where the prompt goes, the idle session
// gets it at once, the busy one only after its Stop, and the Shell session is skipped.
// Run: node scripts/e2e-broadcast.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9435

function writeFakeClaude(binDir) {
  const events = path.join(binDir, 'events.log')
  fs.writeFileSync(events, '')
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n')
  fs.writeFileSync(
    path.join(binDir, 'fake-claude.js'),
    `const fs = require('node:fs')
const events = ${JSON.stringify(events)}
const args = process.argv.slice(2)
const at = args.indexOf('--session-id') >= 0 ? args.indexOf('--session-id') : args.indexOf('--resume')
const cid = at >= 0 ? args[at + 1] : 'unknown'
const record = (event, data) => fs.appendFileSync(events, JSON.stringify({ cid, event, ...(data === undefined ? {} : { data }) }) + '\\n')
record('start')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => record('data', chunk.toString('utf8')))
process.stdout.write('fake claude ready\\r\\n> ')
setInterval(() => {}, 1 << 30)
`
  )
  return events
}

const eventsOf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n').filter(Boolean).map((l) => JSON.parse(l))

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-broadcast-'))
  const binDir = path.join(root, 'bin')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(binDir)
  fs.mkdirSync(proj)
  const eventsFile = writeFakeClaude(binDir)
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.PATH = binDir + path.delimiter + process.env.PATH
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  const js = (value) => JSON.stringify(value)
  const PROMPT = 'run the linter please'

  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const idle = await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'bc-idle' })`)
    const busy = await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'bc-busy' })`)
    const shell = await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'bc-shell', agent: 'shell' })`)
    await waitFor(() => eventsOf(eventsFile).filter((e) => e.event === 'start').length >= 2, 20000, 300)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const postHook = (id, event) => fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, {
      method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}'
    }).then((r) => r.status)
    const typedFor = (session) => eventsOf(eventsFile).filter((e) => e.cid === session.claudeSessionId && e.event === 'data').map((e) => e.data)
    const queueOf = async (id) => (await ev('window.api.getStore()')).data.sessions.find((x) => x.id === id)?.queue ?? []
    const center = (expr) => ev(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label, modifiers = 0) => {
      const point = await waitFor(() => center(expr), 6000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, modifiers, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(300)
    }
    const card = (name) => `[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))`

    // idle: one finished turn; busy: a turn is running
    await postHook(idle.id, 'UserPromptSubmit')
    await postHook(idle.id, 'Stop')
    await postHook(busy.id, 'UserPromptSubmit')
    await sleep(500)

    // Ctrl+click selects all three (2 = Ctrl modifier in CDP)
    await click(card('bc-idle'), 'idle card', 2)
    await click(card('bc-busy'), 'busy card', 2)
    await click(card('bc-shell'), 'shell card', 2)
    const count = await waitFor(() => ev(`document.querySelector('[data-testid="bulk-selection-count"]')?.innerText ?? null`), 5000, 200)
    t.check('three sessions are selected', count === '3 selected', String(count))
    t.check('the bulk bar has a Prompt button', !!(await ev(`!![...document.querySelectorAll('[data-testid="bulk-action-bar"] button')].find((b) => b.innerText.trim() === 'Prompt')`)))
    if (process.env.E2E_SHOT_DIR) {
      const shot = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, 'broadcast-bar.png'), Buffer.from(shot.result.data, 'base64'))
    }

    await click(`[...document.querySelectorAll('[data-testid="bulk-action-bar"] button')].find((b) => b.innerText.trim() === 'Prompt')`, 'Prompt button')
    const title = await waitFor(() => ev(`document.querySelector('[data-broadcast-dialog] h2')?.innerText ?? null`), 5000, 200)
    t.check('the dialog reaches 2 sessions (the Shell one is not counted)', title === 'Send prompt to 2 sessions', String(title))
    const plan = await ev(`document.querySelector('[data-broadcast-plan]')?.innerText ?? ''`)
    t.check('it explains: 1 idle now, 1 busy later, 1 skipped', /1 idle: sent right away/.test(plan) && /1 busy: sent when their turn finishes/.test(plan) && /1 skipped/.test(plan), plan)
    if (process.env.E2E_SHOT_DIR) {
      const shot = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, 'broadcast-dialog.png'), Buffer.from(shot.result.data, 'base64'))
    }
    await click(`document.querySelector('textarea[aria-label="Prompt for the selected sessions"]')`, 'prompt textarea')
    await app.send('Input.insertText', { text: PROMPT })
    await sleep(150)
    await click(`[...document.querySelectorAll('[data-broadcast-dialog] button')].find((b) => b.innerText.trim() === 'Send')`, 'Send')

    t.check('the idle session gets the prompt right away', !!(await waitFor(() => typedFor(idle).includes(PROMPT), 5000, 100)), JSON.stringify(typedFor(idle)))
    t.check('...followed by Enter', !!(await waitFor(() => typedFor(idle).includes('\r'), 3000, 100)))
    await sleep(800)
    t.check('the busy session gets nothing while its turn runs', typedFor(busy).length === 0, JSON.stringify(typedFor(busy)))
    t.check('...the prompt waits in its queue', (await queueOf(busy.id)).map((q) => q.text).join('|') === PROMPT)
    t.check('the Shell session was skipped (no queue)', (await queueOf(shell.id)).length === 0)
    await postHook(busy.id, 'Stop')
    t.check('the busy session gets it when its turn finishes', !!(await waitFor(() => typedFor(busy).includes(PROMPT), 5000, 100)))
    t.check('both queues are empty at the end', (await queueOf(idle.id)).length === 0 && (await queueOf(busy.id)).length === 0)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
