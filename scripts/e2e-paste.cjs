// E2E: right-click in the terminal pastes the clipboard exactly ONCE, both in Claude's normal UI and in its fullscreen
// UI (`tui: fullscreen`), where Claude turns on mouse reporting and would paste a reported right-click by itself.
// Run: node scripts/e2e-paste.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, strip, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function rightClick(app, x, y) {
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
  await sleep(1500)
}

/** Opens a Claude session, right-clicks its terminal with `probe` on the clipboard and returns how often the probe shows. */
async function pasteCount(app, name, probe, claudeArgs) {
  const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: ${JSON.stringify(name)}, claudeArgs: ${JSON.stringify(claudeArgs)} })`)
  await sleep(1500)
  await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes(${JSON.stringify(name)}))?.click()`)
  await sleep(10000)
  const replay = async () => (await app.evaluate('window.api.ptyReplay(' + JSON.stringify(s.id) + ')')).data
  const mouseOn = /\x1b\[\?1000h/.test(await replay())
  await app.evaluate(`navigator.clipboard.writeText(${JSON.stringify(probe)})`)
  const rect = await app.evaluate(`(() => { const r = [...document.querySelectorAll('.xterm-screen')].find((n) => n.offsetParent !== null).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await rightClick(app, rect.x, rect.y)
  const shown = strip(await replay()).split(probe).length - 1
  return { mouseOn, shown }
}

async function main() {
  const t = makeChecker()
  let app
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-paste-'))
  try {
    // Flag settings only affect this test session; `/tui fullscreen` would write the user's real settings.json.
    const settings = path.join(dir, 'tui-fullscreen.json')
    fs.writeFileSync(settings, JSON.stringify({ tui: 'fullscreen' }))
    app = await launchApp({ port: 9391 })
    await sleep(1500)

    const normal = await pasteCount(app, 'paste normal', 'PASTEPROBE', [])
    t.check('normal UI: right-click pastes exactly once', normal.shown === 1, JSON.stringify(normal))

    const full = await pasteCount(app, 'paste fullscreen', 'FULLPROBE', ['--settings', settings])
    t.check('fullscreen UI really has mouse reporting on', full.mouseOn, JSON.stringify(full))
    t.check('fullscreen UI: right-click pastes exactly once', full.shown === 1, JSON.stringify(full))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    fs.rmSync(dir, { recursive: true, force: true })
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
