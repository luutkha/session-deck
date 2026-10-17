// E2E: the Keep awake flag persists, shows a badge on the card, and the context menu toggles it.
// Run: node scripts/e2e-keepawake.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')
const flag = async (app, id) => (await app.evaluate('window.api.getStore()')).data.sessions.find((s) => s.id === id)?.keepAwake === true
async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9395 })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'ka session' })`)
    await sleep(1200)
    const card = `[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('ka session'))`
    const rect = await app.evaluate(`(() => { const r = ${card}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const rightClick = async () => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none' })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'right', buttons: 2, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'right', buttons: 0, clickCount: 1 })
      await sleep(500)
    }
    const clickItem = (text) => app.evaluate(`[...document.querySelectorAll('[role=menuitem]')].find((n) => n.innerText.trim() === ${JSON.stringify(text)})?.click()`)
    await rightClick()
    await clickItem('Keep awake')
    t.check('"Keep awake" menu item sets the flag', !!(await waitFor(() => flag(app, s.id), 5000, 300)))
    t.check('card shows the Keep awake badge', !!(await waitFor(() => app.evaluate(`!!${card}?.querySelector('[aria-label="Keep awake"]')`), 5000, 300)))
    await rightClick()
    await clickItem('Allow auto-sleep')
    t.check('"Allow auto-sleep" clears it', !!(await waitFor(async () => !(await flag(app, s.id)), 5000, 300)))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
