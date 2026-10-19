// E2E: opening the Hub scrolls the board to the status column with the most sessions (Settings > General switch,
// on by default); a busiest column that is already visible does not move the board; switched off = no scroll.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const js = (value) => JSON.stringify(value)
const board = `document.querySelector('[data-hub-board]')`
const column = (name) => `[...${board}.children].find((n) => (n.getAttribute('aria-label') || '').startsWith(${js(name + ', ')}))`

async function openHub(app) {
  await app.evaluate(`document.querySelector('[aria-label="Open Hub"]').click()`)
  await waitFor(() => app.evaluate(`!!${board}`), 4000, 100)
  await sleep(400)
  return app.evaluate(`(() => {
    const b = ${board}.getBoundingClientRect()
    const c = ${column('Done')}.getBoundingClientRect()
    return { scrollLeft: ${board}.scrollLeft, doneVisible: c.left >= b.left && c.right <= b.right }
  })()`)
}

async function leaveHub(app, sessionName) {
  await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(sessionName)}))?.click()`)
  await waitFor(async () => !(await app.evaluate(`!!${board}`)), 4000, 100)
}

async function main() {
  const t = makeChecker()
  let app
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-hubscroll-'))
  try {
    app = await launchApp({ port: 9396 })
    await sleep(1200)
    const mk = async (name, statusId) => {
      const s = await app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)} })`)
      await app.evaluate(`window.api.setSessionStatus(${js(s.id)}, ${js(statusId)})`)
      return s
    }
    await mk('todo-1', 'todo')
    const d1 = await mk('done-1', 'done')
    const d2 = await mk('done-2', 'done')
    await mk('done-3', 'done')
    await sleep(600)

    const settings = await app.evaluate('window.api.getStore().then((s) => s.data.settings ?? null)')
    t.check('the setting is on by default', settings === null || settings.hub === undefined || settings.hub.scrollToBusiest === true, JSON.stringify(settings))

    const first = await openHub(app)
    t.check('opening the Hub scrolls to the busiest column (Done, off-screen at first)', first.scrollLeft > 0 && first.doneVisible, JSON.stringify(first))
    await app.evaluate(`${board}.scrollLeft = 0`)
    await leaveHub(app, 'todo-1')
    const again = await openHub(app)
    t.check('it happens again each time the Hub is opened', again.scrollLeft > 0 && again.doneVisible, JSON.stringify(again))
    await leaveHub(app, 'todo-1')

    // A busiest column already in view: the board stays where it is.
    await app.evaluate(`window.api.setSessionStatus(${js(d1.id)}, 'todo')`)
    await app.evaluate(`window.api.setSessionStatus(${js(d2.id)}, 'todo')`)
    await sleep(400)
    const visible = await openHub(app)
    t.check('a busiest column that is already visible does not scroll the board', visible.scrollLeft === 0, JSON.stringify(visible))
    await leaveHub(app, 'todo-1')
    await app.evaluate(`window.api.setSessionStatus(${js(d1.id)}, 'done')`)
    await app.evaluate(`window.api.setSessionStatus(${js(d2.id)}, 'done')`)

    // Switch it off in the real Settings dialog.
    await app.evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
    const sw = await waitFor(() => app.evaluate(`(() => { const s = document.getElementById('general-hub-scroll'); return s ? s.getAttribute('aria-checked') : null })()`), 4000, 200)
    t.check('Settings > General shows the switch, on', sw === 'true', String(sw))
    await app.evaluate(`document.getElementById('general-hub-scroll').click()`)
    const saved = await waitFor(async () => (await app.evaluate('window.api.getStore()')).data.settings?.hub?.scrollToBusiest === false, 4000, 200)
    t.check('turning it off is saved', !!saved)
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(500)
    const off = await openHub(app)
    t.check('switched off, opening the Hub does not scroll', off.scrollLeft === 0 && !off.doneVisible, JSON.stringify(off))

    await app.evaluate('window.api.quitApp()').catch(() => undefined)
    await sleep(1500)
  } catch (error) {
    t.check('no exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary())
}

main()
