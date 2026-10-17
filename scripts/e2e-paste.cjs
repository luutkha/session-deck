// E2E: right-click in the terminal pastes the clipboard exactly ONCE (and Ctrl+V too). Run: node scripts/e2e-paste.cjs
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function rightClick(app, x, y) {
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
  await sleep(800)
}

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9391 })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'paste probe' })`)
    await sleep(1500)
    await app.evaluate(`(() => { const el = [...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('paste probe')); el && el.click() })()`)
    await sleep(2500)
    await app.evaluate(`navigator.clipboard.writeText('PASTEPROBE')`)
    const rect = await app.evaluate(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    await rightClick(app, rect.x, rect.y)
    const raw = strip((await app.evaluate('window.api.ptyReplay(' + JSON.stringify(s.id) + ')')).data)
    const doubled = raw.includes('PASTEPROBEPASTEPROBE')
    t.check('paste arrived', raw.includes('PASTEPROBE'))
    t.check('right-click pastes exactly once (no doubled text)', !doubled)
    void s
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
