// E2E (D59): the terminal right-click menu, like Orca. Real mouse events over CDP on the built app: right-click opens
// the menu (it is never sent to the program), Paste pastes once, Select All + Copy fill the clipboard, Find opens the
// search bar, Split Right / Close Pane change the layout, Copy Folder Path, Clear Screen, Escape gives focus back,
// and the Settings > Terminal choice "Copy / paste" brings back the quick right-click (Ctrl+right-click = menu).
// Shell sessions only. Run: node scripts/e2e-termmenu.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9476

async function main() {
  const t = makeChecker()
  let app
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-termmenu-')))
  const userData = path.join(root, 'userdata')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(userData)
  fs.mkdirSync(proj)
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const js = (value) => JSON.stringify(value)
    const mouse = async (x, y, button, modifiers = 0) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1, modifiers })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1, modifiers })
    }
    const paneCenter = (id) => ev(`(() => { const r = document.querySelector('[data-session-id=${js(id)}] .xterm-screen').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    const menuOpen = () => ev('!!document.querySelector("[data-testid=terminal-context-menu]")')
    const menuItems = () => ev('[...document.querySelectorAll("[data-testid=terminal-context-menu] [role=menuitem]")].map((n) => n.innerText.split("\\n")[0].trim() + (n.hasAttribute("data-disabled") ? " (disabled)" : ""))')
    const clickItem = async (label) => {
      const r = await ev(`(() => { const n = [...document.querySelectorAll('[data-testid=terminal-context-menu] [role=menuitem]')].find((m) => m.innerText.split('\\n')[0].trim() === ${js(label)}); if (!n) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
      if (r === null) throw new Error(`menu item ${label} not found: ${js(await menuItems())}`)
      await mouse(r.x, r.y, 'left')
      await sleep(400)
    }
    const openMenu = async (id, modifiers = 0) => {
      const c = await paneCenter(id)
      await mouse(c.x, c.y, 'right', modifiers)
      return waitFor(menuOpen, 3000, 100)
    }
    const replay = async (id) => strip(String(await ev(`window.api.ptyReplay(${js(id)}).then((r) => r.data)`)))
    const escape = async () => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(400)
    }
    const clipboard = () => ev('navigator.clipboard.readText().catch(() => null)')

    const clipboardWorks = await ev(`navigator.clipboard.writeText('sd-probe').then(() => navigator.clipboard.readText()).then((x) => x === 'sd-probe', () => false)`)
    if (!clipboardWorks) {
      console.log('SKIP  the OS clipboard is unavailable in this session; the menu clipboard checks cannot run.')
      return
    }

    const a = await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'menu alpha', agent: 'shell' })`)
    const b = await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'menu beta', agent: 'shell' })`)
    await sleep(1500)
    await ev(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('menu beta')).click()`)
    await sleep(600)
    await ev(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('menu alpha')).click()`)
    await waitFor(() => ev(`!!document.querySelector('[data-session-id=${js(a.id)}] .xterm-screen')`), 15000, 300)
    await sleep(1500)

    // ---- right-click opens Orca's menu (the default)
    t.check('right-click opens the terminal menu', !!(await openMenu(a.id)))
    const items = await menuItems()
    const expected = ['Copy (disabled)', 'Select All', 'Paste', 'Find…', 'Split Terminal Right', 'Split Terminal Down', 'Copy Folder Path', 'Clear Screen']
    t.check('the menu has Copy (off without a selection), Select All, Paste, Find, Split, Copy Folder Path, Clear Screen', expected.every((x) => items.includes(x)) && !items.includes('Close Pane') && !items.includes('Fork Session'), js(items))

    // ---- Paste pastes exactly once
    await ev(`navigator.clipboard.writeText('echo MENUPASTE59')`)
    await clickItem('Paste')
    await sleep(800)
    const pasted = (await replay(a.id)).split('MENUPASTE59').length - 1
    t.check('Paste closes the menu and pastes the clipboard once', !(await menuOpen()) && pasted === 1, `shown ${pasted}`)
    const focused = await ev(`document.activeElement === document.querySelector('[data-session-id=${js(a.id)}] .xterm-helper-textarea')`)
    t.check('...and the terminal has the focus again', focused)
    await ev(`window.api.ptyWrite(${js(a.id)}, '\\r')`)
    await sleep(800)

    // ---- Select All, then Copy (enabled now) fills the clipboard
    await openMenu(a.id)
    await clickItem('Select All')
    await openMenu(a.id)
    const withSelection = await menuItems()
    t.check('after Select All, Copy is enabled', withSelection.includes('Copy'), js(withSelection))
    await ev(`navigator.clipboard.writeText('')`)
    await clickItem('Copy')
    const copied = await waitFor(async () => { const text = await clipboard(); return text && text.includes('MENUPASTE59') ? text : null }, 3000, 200)
    t.check('Copy puts the selected terminal text on the clipboard', !!copied, String(await clipboard()).slice(0, 80))

    // ---- Copy Folder Path
    await openMenu(a.id)
    await clickItem('Copy Folder Path')
    t.check('Copy Folder Path copies the session folder', (await waitFor(async () => ((await clipboard()) === proj ? true : null), 3000, 200)) === true, String(await clipboard()))

    // ---- Find opens the search bar
    await openMenu(a.id)
    await clickItem('Find…')
    t.check('Find opens the terminal search bar', !!(await waitFor(() => ev('!!document.querySelector("[data-testid=terminal-search]") || null'), 3000, 200)))
    await ev('document.querySelector("[aria-label=\\"Find in terminal\\"]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await sleep(400)

    // ---- Escape closes the menu without doing anything
    await openMenu(a.id)
    const replayBefore = String(await ev(`window.api.ptyReplay(${js(a.id)}).then((r) => r.data)`)).length
    await escape()
    const escFocus = await ev(`document.activeElement === document.querySelector('[data-session-id=${js(a.id)}] .xterm-helper-textarea') ? 'terminal' : String(document.activeElement?.tagName) + ' ' + String(document.activeElement?.getAttribute('aria-label'))`)
    t.check('Escape closes the menu and gives the terminal its focus back', !(await menuOpen()) && escFocus === 'terminal', `open=${await menuOpen()} focus=${escFocus}`)
    await sleep(500)
    const replayAfter = String(await ev(`window.api.ptyReplay(${js(a.id)}).then((r) => r.data)`)).length
    t.check('...and the Escape is not sent to the program', replayAfter === replayBefore, `${replayBefore} -> ${replayAfter}`)

    // ---- Split Terminal Right, then Close Pane
    const paneCount = () => ev('[...document.querySelectorAll(".terminal-pane")].filter((n) => n.offsetParent !== null).length')
    await openMenu(a.id)
    await clickItem('Split Terminal Right')
    t.check('Split Terminal Right shows two panes', (await waitFor(async () => ((await paneCount()) === 2 ? true : null), 4000, 200)) === true, String(await paneCount()))
    await sleep(800)
    await openMenu(b.id)
    const splitItems = await menuItems()
    t.check('in a split, the menu offers Close Pane', splitItems.includes('Close Pane'), js(splitItems))
    await clickItem('Close Pane')
    t.check('Close Pane goes back to one pane', (await waitFor(async () => ((await paneCount()) === 1 ? true : null), 4000, 200)) === true, String(await paneCount()))
    await sleep(600)

    // ---- Clear Screen
    const visibleId = await ev('[...document.querySelectorAll(".terminal-pane")].find((n) => n.offsetParent !== null).querySelector("[data-session-id]").getAttribute("data-session-id")')
    await ev(`window.api.ptyWrite(${js(visibleId)}, 'echo CLEARME59\\r')`)
    await sleep(1000)
    // WebGL draws the screen (no DOM text): read the buffer with the menu's own Select All + Copy.
    const bufferText = async () => {
      await openMenu(visibleId)
      await clickItem('Select All')
      await openMenu(visibleId)
      await ev("navigator.clipboard.writeText('')")
      await clickItem('Copy')
      await sleep(300)
      return String(await clipboard())
    }
    const before = await bufferText()
    await openMenu(visibleId)
    await clickItem('Clear Screen')
    await sleep(500)
    const after = await bufferText()
    t.check('Clear Screen clears the terminal', before.includes('CLEARME59') && !after.includes('CLEARME59'), `${before.includes('CLEARME59')} -> ${after.includes('CLEARME59')}`)

    // ---- Settings > Terminal: "Copy / paste" brings back the quick right-click; Ctrl+right-click still shows the menu
    await ev(`window.api.ptyWrite(${js(visibleId)}, '\\u0003')`)
    await sleep(500)
    await ev("localStorage.setItem('sessiondeck.rightclick.v1', 'paste')")
    await ev(`navigator.clipboard.writeText('echo QUICKPASTE59')`)
    const c = await paneCenter(visibleId)
    await mouse(c.x, c.y, 'right')
    await sleep(1000)
    const quick = (await replay(visibleId)).split('QUICKPASTE59').length - 1
    t.check('"Copy / paste" mode: right-click pastes once and shows no menu', quick === 1 && !(await menuOpen()), `shown ${quick}`)
    t.check('"Copy / paste" mode: Ctrl+right-click still shows the menu', !!(await openMenu(visibleId, 2)))
    await escape()
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
