// E2E (D89): the optional light theme in the built app. Dark is the default and stays; Settings > General > Theme
// switches the whole window (and the open terminals) live and the choice survives a restart. Screenshots of both
// themes go to scripts/visual/ (theme-dark.png, theme-light.png). Run: node scripts/e2e-theme.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9485
const js = (v) => JSON.stringify(v)

async function main() {
  const t = makeChecker()
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-theme-')))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  fs.mkdirSync(path.join(__dirname, 'visual'), { recursive: true })
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (x) => app.evaluate(x)
    const isDark = () => ev(`document.documentElement.classList.contains('dark')`)
    const bodyBg = () => ev(`getComputedStyle(document.body).backgroundColor`)
    const shot = async (name) => {
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(__dirname, 'visual', name), Buffer.from(r.result.data, 'base64'))
    }
    await ev(`window.api.createSession({ cwd: ${js(root)}, name: 'theme check', agent: 'shell' })`)
    await sleep(1500)
    await ev(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('theme check'))?.click()`)
    await sleep(2000)

    t.check('dark is the default', await isDark())
    const darkBg = await bodyBg()
    await shot('theme-dark.png')

    await ev(`document.querySelector('[aria-label="Settings"]').click()`)
    await waitFor(() => ev(`!!document.querySelector('[data-testid="settings-theme"]') || null`), 5000, 200)
    t.check('Settings > General offers Dark and Light, Dark pressed', (await ev(`document.querySelector('[data-theme-choice="dark"]')?.getAttribute('aria-pressed')`)) === 'true' && (await ev(`!!document.querySelector('[data-theme-choice="light"]')`)))
    await ev(`document.querySelector('[data-theme-choice="light"]').click()`)
    await sleep(600)
    t.check('choosing Light removes the dark class at once', !(await isDark()))
    const lightBg = await bodyBg()
    t.check('the page background changed to a light colour', lightBg !== darkBg, `${darkBg} -> ${lightBg}`)
    t.check('the choice is stored', (await ev(`localStorage.getItem('sessiondeck.theme')`)) === 'light')
    await ev(`document.querySelector('[aria-label="Close"], [data-settings-close]')?.click()`)
    await ev(`document.activeElement && document.activeElement.blur(); true`)
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(800)
    const termBg = await ev(`(() => { const n = document.querySelector('.xterm-viewport, .xterm-screen'); return n ? getComputedStyle(n).backgroundColor : '' })()`)
    t.check('the terminal host follows the theme (not black)', termBg !== 'rgb(0, 0, 0)', termBg)
    await shot('theme-light.png')

    // ---- restart: the choice is remembered
    // A normal quit (not a forced kill) so the page's storage is flushed to disk first.
    await ev('window.api.quitApp()').catch(() => undefined)
    await sleep(3000)
    app.kill()
    await sleep(1000)
    app = await launchApp({ port: PORT, userData })
    await sleep(2000)
    t.check('after a restart the app is still light', !(await app.evaluate(`document.documentElement.classList.contains('dark')`)))

    // ---- back to dark
    await app.evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
    await waitFor(() => app.evaluate(`!!document.querySelector('[data-theme-choice="dark"]') || null`), 5000, 200)
    await app.evaluate(`document.querySelector('[data-theme-choice="dark"]').click()`)
    await sleep(600)
    t.check('choosing Dark brings the dark class back', await app.evaluate(`document.documentElement.classList.contains('dark')`))
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
