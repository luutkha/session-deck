// E2E (D47): prompt queue through the real UI and the real hook server.
// A fake `claude` on PATH records every byte it receives (no real Claude, the user's ~/.claude is never touched).
// Verifies: the Queue tab adds prompts while a turn runs (nothing typed), a Stop types the first prompt and then a
// separate Enter, an idle session gets a new prompt at once, a second prompt waits for the next turn, "Send now"
// types immediately, the card chip shows the count, and the queue survives an app restart.
// Run: node scripts/e2e-queue.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9431

function writeFakeClaude(binDir) {
  const events = path.join(binDir, 'events.log')
  fs.writeFileSync(events, '')
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n')
  fs.writeFileSync(
    path.join(binDir, 'fake-claude.js'),
    `const fs = require('node:fs')
const events = ${JSON.stringify(events)}
const record = (event, data) => fs.appendFileSync(events, JSON.stringify({ t: Date.now(), pid: process.pid, event, ...(data === undefined ? {} : { data }) }) + '\\n')
record('start', process.argv.slice(2).join(' '))
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
const typed = (file) => eventsOf(file).filter((e) => e.event === 'data').map((e) => e.data)

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-queue-'))
  const binDir = path.join(root, 'bin')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(binDir)
  fs.mkdirSync(proj)
  const eventsFile = writeFakeClaude(binDir)
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.PATH = binDir + path.delimiter + process.env.PATH
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  const js = (value) => JSON.stringify(value)

  try {
    app = await launchApp({ port: PORT })
    const userData = app.userData
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const s = await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'queue-probe' })`)
    await waitFor(() => eventsOf(eventsFile).some((e) => e.event === 'start'), 20000, 300)
    let endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const postHook = async (event) => {
      const res = await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(s.id)}/${event}`, {
        method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}'
      })
      return res.status
    }
    const queueOf = async () => (await ev('window.api.getStore()')).data.sessions.find((x) => x.id === s.id)?.queue ?? []
    const center = (expr) => ev(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label) => {
      const point = await waitFor(() => center(expr), 6000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(300)
    }
    const addThroughUi = async (text) => {
      await click(`document.querySelector('textarea[aria-label="Prompt to queue"]')`, 'queue textarea')
      await app.send('Input.insertText', { text })
      await sleep(150)
      await click(`[...document.querySelectorAll('[data-queue-panel] button')].find((b) => b.innerText.includes('Add to queue'))`, 'Add to queue')
    }

    // ---- open the session and its Queue tab through the UI
    await click(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('queue-probe'))`, 'session card')
    await click(`document.querySelector('[aria-label="Notes and checklist"]')`, 'side panel toggle')
    await click(`document.querySelector('[data-side-tab="queue"]')`, 'Queue tab')
    t.check('the side panel has a Queue tab with an input', !!(await waitFor(() => ev(`!!document.querySelector('textarea[aria-label="Prompt to queue"]')`), 5000, 200)))

    // ---- a turn is running: queued prompts wait
    t.check('UserPromptSubmit is accepted', (await postHook('UserPromptSubmit')) === 204)
    await waitFor(() => ev(`document.querySelector('[data-queue-state]')?.getAttribute('data-queue-state') === 'busy'`), 5000, 200)
    await addThroughUi('first queued prompt')
    await addThroughUi('second queued prompt')
    const two = await waitFor(async () => (await queueOf()).length === 2, 5000, 200)
    t.check('two prompts added through the Queue tab are stored in order', !!two, js(await queueOf()))
    t.check('the card shows a queue chip with 2', !!(await waitFor(() => ev(`!!document.querySelector('[role=treeitem] [data-queue-chip="2"]')`), 4000, 200)))
    if (process.env.E2E_SHOT_DIR) {
      const shot = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, 'queue-panel.png'), Buffer.from(shot.result.data, 'base64'))
    }
    await sleep(800)
    t.check('nothing is typed while the turn is still running', typed(eventsFile).length === 0, js(typed(eventsFile)))

    // ---- Stop: the first prompt is typed, then Enter separately
    await postHook('Stop')
    const firstSent = await waitFor(() => typed(eventsFile).includes('\r'), 5000, 100)
    const afterStop = typed(eventsFile)
    t.check('after Stop the first prompt is typed, then a separate Enter', !!firstSent && afterStop[0] === 'first queued prompt' && afterStop[1] === '\r', js(afterStop))
    t.check('the sent prompt left the queue', (await queueOf()).map((p) => p.text).join('|') === 'second queued prompt', js(await queueOf()))
    await sleep(800)
    t.check('only ONE prompt is sent for one finished turn', typed(eventsFile).length === 2, js(typed(eventsFile)))

    // ---- the sent prompt starts a turn, it finishes: the second goes out
    await postHook('UserPromptSubmit')
    await postHook('Stop')
    const secondSent = await waitFor(() => typed(eventsFile).filter((d) => d === '\r').length === 2, 5000, 100)
    t.check('the next finished turn sends the second prompt', !!secondSent && typed(eventsFile)[2] === 'second queued prompt', js(typed(eventsFile)))
    t.check('the queue is empty and the chip is gone', (await queueOf()).length === 0 && !(await ev(`!!document.querySelector('[role=treeitem] [data-queue-chip]')`)))
    // Real Claude reports the turn the typed prompt started; the fake one cannot, so the hooks are posted here.
    await sleep(500)
    await postHook('UserPromptSubmit')
    await postHook('Stop')

    // ---- idle session: a new prompt goes out at once; one more waits for the next turn
    await waitFor(() => ev(`document.querySelector('[data-queue-state]')?.getAttribute('data-queue-state') === 'idle'`), 5000, 200)
    t.check('the Queue tab says the session is idle', (await ev(`document.querySelector('[data-queue-state]')?.getAttribute('data-queue-state')`)) === 'idle')
    await addThroughUi('idle prompt')
    const idleSent = await waitFor(() => typed(eventsFile).includes('idle prompt'), 5000, 100)
    t.check('an idle session gets a newly added prompt right away', !!idleSent)
    await addThroughUi('waits for next turn')
    await sleep(1200)
    t.check('a second prompt added before the new turn starts is NOT sent yet', !typed(eventsFile).includes('waits for next turn'), js(typed(eventsFile)))
    // The turn of "idle prompt" runs and finishes: the waiting prompt goes out.
    await postHook('UserPromptSubmit')
    await postHook('Stop')
    t.check('it goes out when that turn finishes', !!(await waitFor(() => typed(eventsFile).includes('waits for next turn'), 5000, 100)))

    // ---- Send now while busy (the turn of "waits for next turn" is running)
    await sleep(500)
    await postHook('UserPromptSubmit')
    await addThroughUi('send me now')
    await waitFor(async () => (await queueOf()).length === 1, 4000, 200)
    await click(`document.querySelector('[data-queue-item] [aria-label="Send now"]')`, 'Send now')
    t.check('"Send now" types the prompt immediately during a turn', !!(await waitFor(() => typed(eventsFile).includes('send me now'), 5000, 100)))
    t.check('...and removes it from the queue', (await queueOf()).length === 0)

    // ---- the queue survives a restart
    await addThroughUi('kept across restart')
    await waitFor(async () => (await queueOf()).length === 1, 4000, 200)
    await ev('window.api.quitApp()').catch(() => undefined)
    await sleep(4000)
    app.kill()
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const kept = (await app.evaluate('window.api.getStore()')).data.sessions.find((x) => x.id === s.id)?.queue ?? []
    t.check('the queued prompt is still there after a restart', kept.length === 1 && kept[0].text === 'kept across restart', js(kept))
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
