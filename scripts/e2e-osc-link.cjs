// E2E (D93): a hyperlink an agent prints (OSC 8) opens at once. xterm's own handler used to ask "Do you want to navigate
// to ...? WARNING: This link could potentially be dangerous" (window.confirm); now the click goes straight to the link
// service. A shell session prints one OSC 8 link; the test clicks it and checks that no confirm dialog was asked and the
// URL was handed to the opener (recorded in a file instead of a browser). Run: node scripts/e2e-osc-link.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9487
const js = (v) => JSON.stringify(v)

async function main() {
  const t = makeChecker()
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-osc-')))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const urls = path.join(root, 'opened.txt')
  process.env.SESSIONDECK_E2E_OPENED_URLS_FILE = urls
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (x) => app.evaluate(x)
    const s = await ev(`window.api.createSession({ cwd: ${js(root)}, name: 'osc link', agent: 'shell' })`)
    await sleep(1500)
    await ev(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('osc link'))?.click()`)
    await sleep(2500)
    // Count confirm() calls instead of showing the dialog (a real one would block the page).
    await ev(`window.__confirmCalls = 0; window.confirm = () => { window.__confirmCalls += 1; return false }; true`)
    const esc = String.fromCharCode(27)
    // The typed command line would lose the ESC bytes, so a script prints the sequence.
    const printer = path.join(root, 'print-link.js')
    fs.writeFileSync(printer, `const e = String.fromCharCode(27); const b = String.fromCharCode(92); process.stdout.write(e + ']8;;https://example.com/osc-test' + e + b + 'CLICKME' + e + ']8;;' + e + b + String.fromCharCode(10))`)
    await ev(`window.api.ptyWrite(${js(s.id)}, ${js(`node "${printer}"`)} + String.fromCharCode(13))`)
    await sleep(2500)
    const replay = (await ev(`window.api.ptyReplay(${js(s.id)})`)).data
    t.check('the shell printed the OSC 8 sequence', /\]8;[^;]*;https:\/\/example\.com\/osc-test/.test(replay), js(replay.slice(-300)))
    // The renderer may be canvas/WebGL, so there is no text to find: the link starts at column 0 of the output row, so
    // click 20px in from the left on each of the first rows until one opens it.
    const geo = await ev(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { left: r.left, top: r.top, h: r.height / 30 } })()`)
    let opened = null
    for (let row = 0; row < 12 && opened === null; row += 1) {
      const x = geo.left + 20
      const y = geo.top + geo.h * (row + 0.5)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 2, y, button: 'none' })
      await sleep(150)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      await sleep(150)
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      await sleep(250)
      if (fs.existsSync(urls)) opened = fs.readFileSync(urls, 'utf8').trim()
    }
    t.check('clicking the printed link opened the URL directly', opened === 'https://example.com/osc-test', js(opened))
    t.check('no confirm dialog was asked', (await ev('window.__confirmCalls')) === 0, String(await ev('window.__confirmCalls')))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
