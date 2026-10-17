// E2E: the New session and Statuses dialogs really open and work through real mouse/keyboard events.
// Run: node scripts/e2e-dialogs.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

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
const byText = (sel, t) => `[...document.querySelectorAll('${sel}')].find((n) => n.innerText.trim().startsWith(${JSON.stringify(t)}))`
// Inputs of the open dialog by position (Folder, Name, Extra args); placeholders contain backslashes that CSS selectors mangle.
const dialogInput = (i) => `document.querySelectorAll('[role=dialog] input')[${i}]`
const byLabel = (l) => `document.querySelector('[aria-label="${l}"]')`
const type = (app, text) => app.send('Input.insertText', { text })

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9365 })
    await sleep(1500)

    // ---- New session dialog
    await click(app, byText('button', 'New session'), 'New session nav')
    const opened = await waitFor(() => app.evaluate('document.querySelector("[role=dialog]") !== null'), 6000)
    t.check('New session opens a dialog', !!opened)

    await click(app, dialogInput(0), 'folder input')
    await type(app, ROOT)
    await click(app, dialogInput(1), 'name input')
    await type(app, 'dialog made')
    const enabled = await app.evaluate(`!${byText('button', 'Create session')}.disabled`)
    t.check('Create session becomes enabled once a folder is typed', enabled)
    await click(app, byText('button', 'Create session'), 'Create session')

    const created = await waitFor(async () => (await app.evaluate('window.api.getStore()')).data.sessions.find((s) => s.name === 'dialog made'), 15000)
    t.check('session created through the dialog with the typed name and folder', !!created && created.cwd === ROOT)
    const tab = await waitFor(() => app.evaluate(`[...document.querySelectorAll('[role=tab]')].some((n) => n.innerText.includes('dialog made'))`), 8000)
    t.check('its tab is opened and the dialog is closed', !!tab && (await app.evaluate('document.querySelector("[role=dialog]") === null')))

    // ---- Validation: an unsafe argument is rejected and the dialog stays open
    await click(app, byText('button', 'New session'), 'New session nav (2)')
    await waitFor(() => app.evaluate('document.querySelector("[role=dialog]") !== null'), 6000)
    await click(app, dialogInput(0), 'folder input (2)')
    await type(app, ROOT)
    await click(app, dialogInput(2), 'args input')
    await type(app, 'bad&arg')
    await click(app, byText('button', 'Create session'), 'Create session (2)')
    await sleep(800)
    const stillOpen = await app.evaluate('document.querySelector("[role=dialog]") !== null')
    const errorShown = await app.evaluate('!!document.querySelector("[role=dialog] [role=alert]")')
    t.check('unsafe claude args are rejected: dialog stays open with an error', stillOpen && errorShown)
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(500)
    t.check('Esc closes the dialog', await app.evaluate('document.querySelector("[role=dialog]") === null'))

    // ---- Statuses dialog
    const before = (await app.evaluate('window.api.getStore()')).data.statuses.length
    await click(app, byLabel('Edit statuses'), 'Statuses button')
    const statusesOpen = await waitFor(() => app.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("Statuses") === true'), 6000)
    t.check('Statuses button opens Settings on the Statuses section', !!statusesOpen)
    await click(app, byText('button', 'Add status'), 'Add status')
    const added = await waitFor(async () => (await app.evaluate('window.api.getStore()')).data.statuses.length === before + 1, 6000)
    t.check('Add status creates a new status in the store', !!added)
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(500)
    t.check('Esc closes the Settings dialog', await app.evaluate('document.querySelector("[role=dialog]") === null'))
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
