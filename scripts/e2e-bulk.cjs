// E2E: bulk session actions (W4). Real Ctrl/Shift clicks select cards without changing the active
// session, the floating bar sleeps every selected session in view order, Esc clears, the status and
// group menus apply to the whole selection, drag-and-drop still works (D20 guard), and the Hub board
// shares the same selection rules.
// Run: node scripts/e2e-bulk.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9458
const js = (value) => JSON.stringify(value)
const CTRL = 2
const SHIFT = 8

const runtimeOf = async (app, id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)
const storeOf = (app) => app.evaluate('window.api.getStore()')
const activeTab = (app) => app.evaluate(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)
const barCount = (app, scope = '') => app.evaluate(`document.querySelector('${scope}[data-testid="bulk-selection-count"]')?.textContent ?? null`)
const selectedCards = (app, scope = '') => app.evaluate(`document.querySelectorAll('${scope}[data-selected="true"]').length`)

function cardExpr(name, scope = '') {
  return `[...document.querySelectorAll('${scope}[role="treeitem"]')].find((n) => n.innerText.includes(${js(name)}))`
}

/** Real pointer click on a sidebar card with optional Ctrl (2) / Shift (8) modifiers. */
async function clickCard(app, name, modifiers = 0) {
  const rect = await app.evaluate(`(() => {
    const n = ${cardExpr(name)}
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: r.left + 36, y: r.top + r.height / 2 }
  })()`)
  if (rect === null) throw new Error(`session card not found: ${name}`)
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none', modifiers })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1, modifiers })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1, modifiers })
  await sleep(250)
}

function hubCardExpr(name) {
  return `[...document.querySelectorAll('main [role="button"][aria-label]')].find((n) => n.getAttribute('aria-label') === ${js('Open session ' + name)})`
}

async function clickHubCard(app, name, modifiers = 0) {
  const rect = await app.evaluate(`(() => {
    const n = ${hubCardExpr(name)}
    if (!n) return null
    n.scrollIntoView({ block: 'nearest', inline: 'center' })
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (rect === null) throw new Error(`Hub card not found: ${name}`)
  await sleep(220) // let the board settle after the horizontal scroll
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none', modifiers })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1, modifiers })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1, modifiers })
  await sleep(250)
}

/** Real pointer click on a bar button/menu trigger found by its exact text, inside `scope`. */
async function clickBarButton(app, text, scope = '') {
  const rect = await app.evaluate(`(() => {
    const n = [...document.querySelectorAll('${scope}[data-testid="bulk-action-bar"] button')].find((b) => b.textContent.trim() === ${js(text)})
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (rect === null) throw new Error(`bulk bar button not found: ${text}`)
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(300)
}

const clickMenuItem = (app, text) =>
  app.evaluate(`(() => { const i = [...document.querySelectorAll('[role=menuitem]')].find((n) => n.innerText.trim() === ${js(text)}); if (!i) return false; i.click(); return true })()`)

async function pressEscape(app) {
  await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 })
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 })
  await sleep(250)
}

/** One HTML5 drag phase on the sidebar cards; accepts before/after placement by clientY. */
function dragPhase(app, type, name, targetName) {
  return app.evaluate(`(() => {
    window.__bulkDt = window.__bulkDt || new DataTransfer()
    const cards = [...document.querySelectorAll('[role="treeitem"]')]
    const card = cards.find((n) => n.innerText.includes(${js(name)}))
    const target = cards.find((n) => n.innerText.includes(${js(targetName)}))
    if (!card || !target) return 'missing'
    const el = (${js(type)} === 'dragover' || ${js(type)} === 'drop') ? target : card
    const r = target.getBoundingClientRect()
    el.dispatchEvent(new DragEvent(${js(type)}, {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__bulkDt,
      clientY: r.top + 2
    }))
    return 'ok'
  })()`)
}

const groupOrder = async (app, groupId) => (await storeOf(app)).data.sessions
  .filter((s) => s.groupId === groupId)
  .sort((a, b) => a.order - b.order)
  .map((s) => s.id)

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: PORT })
    await sleep(1500)
    const one = await app.evaluate(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'bulk-one', agent: 'shell' })`)
    const two = await app.evaluate(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'bulk-two', agent: 'shell' })`)
    const three = await app.evaluate(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'bulk-three', agent: 'shell' })`)
    const running = await waitFor(async () => {
      const store = await storeOf(app)
      return [one.id, two.id, three.id].every((id) => store.runtime.find((r) => r.sessionId === id)?.run === 'running')
    }, 15000, 300)
    t.check('three Shell sessions are running', !!running)

    // ---- plain click opens; Ctrl+click adds without touching the active session
    await clickCard(app, 'bulk-one')
    const opened = await waitFor(async () => (await activeTab(app)) === one.id, 6000, 200)
    t.check('a plain click still opens the session', !!opened, String(await activeTab(app)))
    await clickCard(app, 'bulk-two', CTRL)
    const twoSelected = await waitFor(async () => (await barCount(app)) === '2 selected', 5000, 200)
    t.check('Ctrl+click selects a second session (bar says "2 selected")', !!twoSelected, String(await barCount(app)))
    t.check('Ctrl+click leaves the active session unchanged', (await activeTab(app)) === one.id, String(await activeTab(app)))

    // ---- Shift+click ranges from the Ctrl-clicked anchor (bulk-two -> bulk-three), replacing the set
    await clickCard(app, 'bulk-three', SHIFT)
    const range = await waitFor(async () => (await barCount(app)) === '2 selected' && (await selectedCards(app)) === 2, 5000, 200)
    const rangeNames = await app.evaluate(`JSON.stringify([...document.querySelectorAll('[role="treeitem"][data-selected="true"]')].map((n) => n.innerText.split('\\n')[0]))`)
    t.check('Shift+click range-selects bulk-two..bulk-three and drops bulk-one', !!range, rangeNames)

    // ---- Esc clears the selection
    await pressEscape(app)
    const cleared = await waitFor(async () => (await barCount(app)) === null && (await selectedCards(app)) === 0, 5000, 200)
    t.check('Esc clears the selection and hides the bar', !!cleared)

    // ---- bulk sleep applies to exactly the selected sessions
    await clickCard(app, 'bulk-one')
    await clickCard(app, 'bulk-two', CTRL)
    await clickBarButton(app, 'Sleep')
    const slept = await waitFor(async () => {
      const a = await runtimeOf(app, one.id)
      const b = await runtimeOf(app, two.id)
      return a?.sleeping === true && b?.sleeping === true
    }, 10000, 300)
    t.check('bulk Sleep puts both selected sessions to sleep', !!slept)
    t.check('the unselected session keeps running', (await runtimeOf(app, three.id))?.sleeping !== true && (await runtimeOf(app, three.id))?.run === 'running')

    const buttons = await app.evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid="bulk-action-bar"] button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })))`)
    const sleepBtn = JSON.parse(buttons).find((b) => b.text === 'Sleep')
    const wakeBtn = JSON.parse(buttons).find((b) => b.text === 'Wake')
    t.check('Sleep is disabled and Wake enabled once the selection is asleep', sleepBtn?.disabled === true && wakeBtn?.disabled === false, buttons)

    // ---- bulk Set status through the real menu
    await clickBarButton(app, 'Set status')
    const menuOpen = await waitFor(() => app.evaluate(`[...document.querySelectorAll('[role=menuitem]')].some((n) => n.innerText.trim() === 'Done')`), 5000, 200)
    await clickMenuItem(app, 'Done')
    const statused = await waitFor(async () => {
      const store = await storeOf(app)
      return [one.id, two.id].every((id) => store.data.sessions.find((s) => s.id === id)?.statusId === 'done')
    }, 6000, 250)
    t.check('bulk Set status applies the chosen status to every selected session', !!menuOpen && !!statused)

    // ---- bulk Move to group through the real menu
    const group = await app.evaluate(`window.api.createGroup('Bulk group')`)
    await sleep(500)
    await clickBarButton(app, 'Move to group')
    const groupMenu = await waitFor(() => app.evaluate(`[...document.querySelectorAll('[role=menuitem]')].some((n) => n.innerText.trim() === 'Bulk group')`), 5000, 200)
    await clickMenuItem(app, 'Bulk group')
    const moved = await waitFor(async () => {
      const store = await storeOf(app)
      return [one.id, two.id].every((id) => store.data.sessions.find((s) => s.id === id)?.groupId === group.id)
    }, 6000, 250)
    t.check('bulk Move to group moves every selected session', !!groupMenu && !!moved)
    t.check('the bulk bar keeps its selection after an action', (await barCount(app)) === '2 selected', String(await barCount(app)))

    // ---- D20 guard: selecting must not break drag-and-drop
    await pressEscape(app)
    const before = await groupOrder(app, group.id)
    await dragPhase(app, 'dragstart', 'bulk-two', 'bulk-one')
    await sleep(250)
    await dragPhase(app, 'dragover', 'bulk-two', 'bulk-one')
    await sleep(250)
    await dragPhase(app, 'drop', 'bulk-two', 'bulk-one')
    await sleep(250)
    await dragPhase(app, 'dragend', 'bulk-two', 'bulk-one')
    const reordered = await waitFor(async () => {
      const after = await groupOrder(app, group.id)
      return after[0] === two.id && after[1] === one.id
    }, 6000, 250)
    t.check('drag-and-drop still reorders sessions after multi-select', !!reordered, `${before.join(',')} -> ${(await groupOrder(app, group.id)).join(',')}`)

    // ---- Hub board rows share the same Ctrl/Shift/Esc rules and the same bar
    await pressEscape(app) // the drag may have auto-scrolled; make sure no stale selection remains
    const hub = await app.evaluate(`(() => { const b = document.querySelector('[aria-label="Open Hub"]'); if (!b) return false; b.click(); return true })()`)
    const board = await waitFor(() => app.evaluate(`[...document.querySelectorAll('main [role="button"][aria-label]')].length >= 3`), 8000, 250)
    t.check('the Hub opens with every session card', !!hub && !!board)
    await clickHubCard(app, 'bulk-one', CTRL)
    await clickHubCard(app, 'bulk-three', CTRL)
    const hubSelected = await waitFor(async () => (await barCount(app, 'main ')) === '2 selected', 5000, 200)
    t.check('Ctrl+click selects two Hub cards without opening them', !!hubSelected, String(await barCount(app, 'main ')))
    t.check('the Hub selection is separate from the sidebar bar', (await app.evaluate(`!!document.querySelector('aside [data-testid="bulk-action-bar"]')`)) === false)

    await clickBarButton(app, 'Sleep', 'main ')
    const hubSlept = await waitFor(async () => (await runtimeOf(app, three.id))?.sleeping === true, 10000, 300)
    t.check('bulk Sleep on the Hub sleeps the awake selected card only', !!hubSlept && (await runtimeOf(app, one.id))?.sleeping === true)

    await pressEscape(app)
    const hubCleared = await waitFor(async () => (await barCount(app, 'main ')) === null, 5000, 200)
    t.check('Esc clears the Hub selection', !!hubCleared)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
