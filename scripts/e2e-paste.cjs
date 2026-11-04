// E2E: right-click in the terminal pastes the clipboard exactly ONCE, both in Claude's normal UI and in its fullscreen
// UI (`tui: fullscreen`), where Claude turns on mouse reporting and would paste a reported right-click by itself.
// D59: with the "Copy / paste" right-click choice (quick paste), and with the default menu (right-click, then Paste).
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

async function leftClick(app, x, y) {
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(1500)
}

/**
 * Opens a Claude session, right-clicks its terminal with `probe` on the clipboard and returns how often the probe shows.
 * mode 'paste': the right-click pastes; mode 'menu': the right-click opens the menu and its Paste row is clicked.
 */
async function pasteCount(app, name, probe, claudeArgs, mode = 'paste') {
  await app.evaluate(`localStorage.setItem('sessiondeck.rightclick.v1', ${JSON.stringify(mode)})`)
  const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: ${JSON.stringify(name)}, claudeArgs: ${JSON.stringify(claudeArgs)} })`)
  await sleep(1500)
  await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes(${JSON.stringify(name)}))?.click()`)
  await sleep(10000)
  const replay = async () => (await app.evaluate('window.api.ptyReplay(' + JSON.stringify(s.id) + ')')).data
  const mouseOn = /\x1b\[\?1000h/.test(await replay())
  await app.evaluate(`navigator.clipboard.writeText(${JSON.stringify(probe)})`)
  const rect = await app.evaluate(`(() => { const r = [...document.querySelectorAll('.xterm-screen')].find((n) => n.offsetParent !== null).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await rightClick(app, rect.x, rect.y)
  let menuShown = false
  if (mode === 'menu') {
    const item = await app.evaluate(`(() => { const n = [...document.querySelectorAll('[data-testid=terminal-context-menu] [role=menuitem]')].find((m) => m.innerText.startsWith('Paste')); if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
    menuShown = item !== null
    if (item !== null) await leftClick(app, item.x, item.y)
  }
  const shown = strip(await replay()).split(probe).length - 1
  return { mouseOn, shown, menuShown }
}

async function main() {
  const t = makeChecker()
  let app
  // realpathSync.native: on Windows os.tmpdir() can be the 8.3 short form (KHALT_~1); `~` is not a safe claude arg
  // and the settings file path is passed as one, so resolve the long path first.
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-paste-')))
  try {
    // Flag settings only affect this test session; `/tui fullscreen` would write the user's real settings.json.
    const settings = path.join(dir, 'tui-fullscreen.json')
    fs.writeFileSync(settings, JSON.stringify({ tui: 'fullscreen' }))
    app = await launchApp({ port: 9391 })
    await sleep(1500)

    // The paste probes need a working OS clipboard. In some remote/headless Windows sessions the clipboard API
    // returns an empty string (and even PowerShell's Get-Clipboard fails), so report a real SKIP instead of a red run.
    const clipboardWorks = await app.evaluate(`navigator.clipboard.writeText('sessiondeck-clipboard-probe').then(() => navigator.clipboard.readText()).then((text) => text === 'sessiondeck-clipboard-probe', () => false)`)
    if (!clipboardWorks) {
      console.log('SKIP  the OS clipboard is unavailable in this session (write/read stays empty); the paste probes cannot run.')
      return
    }

    const normal = await pasteCount(app, 'paste normal', 'PASTEPROBE', [])
    t.check('normal UI: right-click pastes exactly once', normal.shown === 1, JSON.stringify(normal))

    const full = await pasteCount(app, 'paste fullscreen', 'FULLPROBE', ['--settings', settings])
    t.check('fullscreen UI really has mouse reporting on', full.mouseOn, JSON.stringify(full))
    t.check('fullscreen UI: right-click pastes exactly once', full.shown === 1, JSON.stringify(full))

    const menu = await pasteCount(app, 'paste menu fullscreen', 'MENUPROBE', ['--settings', settings], 'menu')
    t.check('fullscreen UI, default menu: right-click shows the menu and its Paste pastes exactly once', menu.menuShown && menu.shown === 1, JSON.stringify(menu))
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
