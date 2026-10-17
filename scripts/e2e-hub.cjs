// E2E: the Hub (sessions by status), the Settings dialog (statuses + sound) and the custom sound pipeline.
// Run: node scripts/e2e-hub.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const centerOf = (app, pick) =>
  app.evaluate(`(() => { const el = (${pick}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
async function mouse(app, type, c, button = 'left') {
  await app.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button, buttons: button === 'none' ? 0 : button === 'right' ? 2 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 })
}
async function click(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label}`)
  await mouse(app, 'mouseMoved', c, 'none')
  await mouse(app, 'mousePressed', c)
  await mouse(app, 'mouseReleased', c)
  await sleep(400)
}
async function rightClick(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label}`)
  await mouse(app, 'mouseMoved', c, 'none')
  await mouse(app, 'mousePressed', c, 'right')
  await mouse(app, 'mouseReleased', c, 'right')
  await sleep(500)
}
async function key(app, k) {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k })
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k })
  await sleep(400)
}
const byLabel = (l) => `document.querySelector('[aria-label="${l}"]')`
const byText = (sel, text) => `[...document.querySelectorAll('${sel}')].find((n) => n.innerText.trim().startsWith(${JSON.stringify(text)}))`
// Hub cards live in <main>; the sidebar has its own draggable cards with the same names.
const hubCard = (name) => `[...document.querySelectorAll('main [draggable="true"]')].find((n) => n.innerText.includes(${JSON.stringify(name)}))`
const hubColumn = (statusName) => `[...document.querySelectorAll('main [aria-label]')].find((n) => (n.getAttribute('aria-label') || '').startsWith(${JSON.stringify(statusName + ', ')}))`
const store = (app) => app.evaluate('window.api.getStore()')

/** One HTML5 drag phase dispatched on the element under the pointer (column body) or on the card itself. */
function dragPhase(app, type, cardName, columnName) {
  const body = `(() => {
    window.__dt = window.__dt || new DataTransfer()
    const card = ${hubCard(cardName)}
    const col = ${hubColumn(columnName)}
    let el = card
    if (${JSON.stringify(type)} !== 'dragstart' && ${JSON.stringify(type)} !== 'dragend' && col) {
      col.scrollIntoView({ inline: 'center', block: 'nearest' })
      const r = col.getBoundingClientRect()
      el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height - 24, 170))
    }
    if (!el) return 'missing'
    el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: window.__dt }))
    return 'ok'
  })()`
  return app.evaluate(body)
}

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9369 })
    await sleep(1200)
    // Count real WebAudio oscillators so we can prove the renderer actually played a sound.
    await app.evaluate(`(() => { window.__osc = 0; const P = window.AudioContext.prototype; const orig = P.createOscillator; P.createOscillator = function () { window.__osc += 1; return orig.apply(this, arguments) } })()`)

    const a = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'hub-alpha', statusId: 'working' })`)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'hub-beta', statusId: 'review' })`)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'hub-gamma' })`)
    await sleep(1500)

    // ---------- Hub
    await click(app, byLabel('Open Hub'), 'Hub nav')
    const board = await waitFor(() => app.evaluate(`(() => { const t = document.body.innerText; return ['hub-alpha', 'hub-beta', 'hub-gamma', 'No status', 'Working', 'Review'].every((x) => t.includes(x)) })()`), 8000)
    t.check('Hub shows every status column and all three session cards', !!board)
    const labels = await app.evaluate(`JSON.stringify([...document.querySelectorAll('main [aria-label]')].map((n) => n.getAttribute('aria-label')).filter((l) => /sessions?$/.test(l)))`)
    t.check('columns are labelled with their status and count', /Working, 1 session/.test(labels) && /Review, 1 session/.test(labels) && /No status, 1 session/.test(labels), labels.slice(0, 150))

    // Drag hub-alpha from Working to Done: one phase at a time so React can update state between them.
    const phases = []
    phases.push(await dragPhase(app, 'dragstart', 'hub-alpha', 'Done'))
    await sleep(250)
    phases.push(await dragPhase(app, 'dragenter', 'hub-alpha', 'Done'))
    phases.push(await dragPhase(app, 'dragover', 'hub-alpha', 'Done'))
    await sleep(250)
    phases.push(await dragPhase(app, 'drop', 'hub-alpha', 'Done'))
    await sleep(250)
    phases.push(await dragPhase(app, 'dragend', 'hub-alpha', 'Done'))
    const moved = await waitFor(async () => (await store(app)).data.sessions.find((s) => s.id === a.id)?.statusId === 'done', 6000)
    t.check('dragging a card to another column changes its status', !!moved, phases.join(','))

    // Right-click > Move to status (the no-drag way), after scrolling the card into view.
    await app.evaluate(`${hubCard('hub-beta')}?.scrollIntoView({ inline: 'center', block: 'nearest' })`)
    await sleep(300)
    await rightClick(app, hubCard('hub-beta'), 'hub-beta card')
    const menuText = await app.evaluate('document.querySelector("[role=menu]")?.innerText || ""')
    t.check('card context menu offers Open and Move to status', /Open/.test(menuText) && /Move to status/.test(menuText), menuText.replace(/\n/g, ' | ').slice(0, 100))
    await key(app, 'Escape')

    // Clicking a card opens the session in the terminal view
    await app.evaluate(`${hubCard('hub-gamma')}?.scrollIntoView({ inline: 'center', block: 'nearest' })`)
    await sleep(300)
    await click(app, hubCard('hub-gamma'), 'hub-gamma card')
    const opened = await waitFor(() => app.evaluate(`[...document.querySelectorAll('[role=tab]')].some((n) => n.innerText.includes('hub-gamma')) && !document.body.innerText.includes('No status')`), 8000)
    t.check('clicking a Hub card opens its tab and leaves the Hub', !!opened)

    // ---------- Settings: statuses
    await click(app, byLabel('Settings'), 'Settings gear')
    const settingsOpen = await waitFor(() => app.evaluate('(document.querySelector("[role=dialog]")?.innerText || "").includes("Sound")'), 6000)
    t.check('Settings opens with a Sound section', !!settingsOpen)
    await click(app, byText('[role=dialog] button', 'Statuses'), 'Statuses nav')
    const before = (await store(app)).data.statuses.map((s) => s.id)
    await click(app, byText('[role=dialog] button', 'Add status'), 'Add status')
    const added = await waitFor(async () => (await store(app)).data.statuses.length === before.length + 1, 6000)
    t.check('Settings > Statuses: Add status creates a status', !!added)
    const newId = added ? (await store(app)).data.statuses.map((s) => s.id).find((id) => !before.includes(id)) : null
    await click(app, `document.querySelector('[role=dialog] [aria-label^="Move New status up"]') || document.querySelector('[role=dialog] [aria-label*=" up"]:not([disabled])')`, 'Move up')
    const reordered = await waitFor(async () => { const ids = (await store(app)).data.statuses.map((s) => s.id); return ids.indexOf(newId) === ids.length - 2 }, 6000)
    t.check('Settings > Statuses: move up reorders the statuses', !!reordered)
    await key(app, 'Escape')

    // ---------- Settings: sound
    await click(app, byLabel('Settings'), 'Settings gear (2)')
    await click(app, byText('[role=dialog] button', 'Sound'), 'Sound nav')
    await waitFor(() => app.evaluate('(document.querySelector("[role=dialog]")?.innerText || "").includes("Volume")'), 6000)
    const before1 = await app.evaluate('window.__osc')
    await click(app, `document.querySelector('[role=dialog] [aria-label^="Test"]')`, 'Test sound')
    await sleep(800)
    const after1 = await app.evaluate('window.__osc')
    t.check('Test button plays a built-in sound through WebAudio', after1 > before1, `oscillators ${before1} -> ${after1}`)
    t.check('Settings offers a custom file option for each sound', await app.evaluate('(document.querySelector("[role=dialog]")?.innerText || "").includes("Custom file") || !!document.querySelector("[role=dialog] [role=combobox]")'))
    await key(app, 'Escape')

    // ---------- A quiet background session must NOT ping (only Stop / permission hooks do; real turns cost quota)
    const osc0 = await app.evaluate('window.__osc')
    await app.evaluate('(window.api.setSoundEnabled(true), true)')
    const evt = await app.evaluate(`new Promise((resolve) => { const off = window.api.onAttentionSound((id, reason) => { off(); resolve({ id, reason }) }); setTimeout(() => resolve(null), 25000) })`)
    t.check('an idle background session sends no sound event', !evt, evt ? 'reason=' + evt.reason : '')
    t.check('no sound is played for it', (await app.evaluate('window.__osc')) === osc0)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
