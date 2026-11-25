// E2E: per-session notes + checklist (UI -> store -> survives a restart) and REAL usage numbers from a live Claude turn.
// Sends ONE tiny prompt to claude (costs a few cents of the user's plan). Run: node scripts/e2e-notes-usage.cjs
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const centerOf = (app, pick) =>
  app.evaluate(`(() => { const el = (${pick}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
async function click(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label}`)
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(350)
}
const key = async (app, k) => { await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k }); await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k }); await sleep(300) }
const store = (app) => app.evaluate('window.api.getStore()')
const bodyText = (app) => app.evaluate('document.body.innerText')

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9371 })
    await sleep(1200)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'notes probe' })`)
    const sid = JSON.stringify(s.id)
    await sleep(1500)
    await click(app, `[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('notes probe'))`, 'session card')

    // ---------- Start a real claude turn first (fresh session), like the other e2e suites
    await waitFor(async () => /[A-Za-z]{6,}/.test(strip((await app.evaluate(`window.api.ptyReplay(${sid})`)).data)), 45000, 1000)
    for (let i = 0; i < 3; i += 1) { await app.evaluate(`window.api.ptyWrite(${sid}, '\\r')`); await sleep(2500) }
    await app.evaluate(`window.api.ptyWrite(${sid}, 'Reply with the single word ok')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${sid}, '\\r')`)

    // ---------- Notes panel + checklist through the real UI (while claude answers)
    await click(app, `document.querySelector('[aria-label="Notes and checklist"]')`, 'Notes toggle')
    const panel = await waitFor(() => app.evaluate('(() => { const t = document.body.innerText; return t.includes("Checklist") && t.includes("Notes") })()'), 6000)
    t.check('Notes toggle opens the panel with Checklist and Notes sections', !!panel)

    const addItem = async (text) => {
      await click(app, `document.querySelector('input[placeholder="Add a step and press Enter"]')`, 'add item input')
      await app.send('Input.insertText', { text })
      await key(app, 'Enter')
    }
    await addItem('write the tests')
    await addItem('ship it')
    const two = await waitFor(async () => (await store(app)).data.sessions.find((x) => x.id === s.id)?.checklist?.length === 2, 6000)
    t.check('adding two checklist items saves them to the store', !!two)

    await click(app, `document.querySelector('[role="checkbox"]')`, 'first checkbox')
    const done = await waitFor(async () => (await store(app)).data.sessions.find((x) => x.id === s.id)?.checklist?.[0]?.done === true, 6000)
    t.check('checking an item marks it done in the store', !!done)
    const chips = await waitFor(async () => /1\/2/.test(await bodyText(app)), 6000)
    t.check('progress "1/2" shows on the card and in the tab bar button', !!chips)

    await click(app, `document.querySelector('textarea[placeholder^="Anything worth"]')`, 'notes textarea')
    await app.send('Input.insertText', { text: 'remember: codeword PINEAPPLE' })
    const notesSaved = await waitFor(async () => (await store(app)).data.sessions.find((x) => x.id === s.id)?.notes === 'remember: codeword PINEAPPLE', 8000)
    t.check('typing notes autosaves (debounced) to the store', !!notesSaved)

    // ---------- usage from the REAL claude turn
    const usage = await waitFor(async () => { const u = await app.evaluate('window.api.getUsage()'); return u.account && u.account.fiveHour ? u : null }, 150000, 2000)
    t.check('main received plan usage from Claude Code statusLine (5h window)', !!usage, usage ? `5h=${usage.account.fiveHour.usedPercentage}% week=${usage.account.sevenDay?.usedPercentage}%` : 'no usage within 150s')
    // The plan usage can arrive before the session's own context percent (it is null until the first answer is counted): wait for the full record.
    const sess = usage && (await waitFor(async () => { const u = await app.evaluate('window.api.getUsage()'); const x = u.sessions.find((y) => y.sessionId === s.id); return x && typeof x.contextPercent === 'number' ? x : null }, 90000, 2000)) || (usage && usage.sessions.find((x) => x.sessionId === s.id))
    t.check('per-session model, context and cost arrived too', !!sess && !!sess.model && typeof sess.contextPercent === 'number' && typeof sess.costUsd === 'number', sess ? `${sess.model} ctx ${sess.contextPercent}% $${sess.costUsd}` : '')
    await app.evaluate(`window.api.setActiveSession(${sid})`)
    const shown = await waitFor(async () => { const b = await bodyText(app); return /5h\s*\d+%/.test(b) && /Week\s*\d+%/.test(b) ? b : null }, 15000)
    t.check('status bar shows the 5h and Week usage bars', !!shown)
    const sessionShown = await waitFor(async () => { const b = await bodyText(app); return /Sonnet|Opus|Haiku/i.test(b) && /ctx \d+%/.test(b) }, 15000)
    t.check('status bar shows the active session model and context fill', !!sessionShown)

    // Screenshot for visual review (notes panel + usage bars together)
    const shot = await app.send('Page.captureScreenshot', { format: 'png' })
    require('node:fs').mkdirSync(require('node:path').join(ROOT, 'scripts', 'visual'), { recursive: true })
    require('node:fs').writeFileSync(require('node:path').join(ROOT, 'scripts', 'visual', 'notes-usage.png'), Buffer.from(shot.result.data, 'base64'))

    // ---------- survives a restart (graceful close like a user)
    await app.evaluate('window.api.quitApp()').catch(() => undefined) // graceful quit, like the tray's Quit: lets Chromium commit localStorage
    await sleep(6000)
    app.kill()
    await sleep(1500)
    app = await launchApp({ port: 9371, userData: app.userData })
    const after = (await store(app)).data.sessions.find((x) => x.id === s.id)
    t.check('notes and checklist are still there after restarting the app', !!after && after.notes === 'remember: codeword PINEAPPLE' && after.checklist?.length === 2 && after.checklist[0].done === true)
    const cached = await waitFor(async () => /5h\s*\d+%/.test(await bodyText(app)), 8000)
    t.check('the last known usage is shown right after a restart (cached, marked stale)', !!cached)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
