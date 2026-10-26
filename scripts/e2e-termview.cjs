// E2E (terminal comfort): Ctrl+= / Ctrl+0 / Ctrl+wheel zoom the real terminal panes live and the profile
// persists (localStorage + restart); the Settings > Terminal page shows the zoom and applies scrollback.
// Run: node scripts/e2e-termview.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9453

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-termview-'))
  const userData = path.join(root, 'userdata')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(userData)
  fs.mkdirSync(proj)
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const js = (value) => JSON.stringify(value)
    const zoomOf = () => ev(`JSON.parse(localStorage.getItem('sessiondeck.termview.v1') ?? '{"zoomPercent":100}').zoomPercent`)
    const screenWidth = () => ev('Math.round(document.querySelector(".xterm-screen")?.getBoundingClientRect().width ?? 0)')

    const s = await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'termview', agent: 'shell' })`)
    await sleep(1500)
    await ev(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('termview')).click()`)
    await waitFor(() => ev('!!document.querySelector(".xterm-screen")'), 15000, 300)
    await sleep(1000)

    // Focus the terminal (the custom key handler only sees focused xterm events).
    const rect = await ev('(() => { const r = document.querySelector(".xterm-screen").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(300)

    const canvasMetric = () => ev('(() => { const c = document.querySelector(".xterm-screen canvas"); return c === null ? null : c.height })()')
    const rowsBefore = await canvasMetric()
    /** The pty's real width as the shell sees it (proves the zoom reached the process through ptyResize). */
    const shellWidth = async () => {
      await ev(`window.api.ptyWrite(${js(s.id)}, 'Write-Host ("W=" + [Console]::WindowWidth)\\r')`)
      await sleep(700)
      const text = await ev(`window.api.ptyReplay(${js(s.id)}).then((r) => r.data)`)
      const matches = [...String(text).matchAll(/W=(\d+)/g)]
      return matches.length === 0 ? null : Number(matches[matches.length - 1][1])
    }
    const widthBefore = await shellWidth()

    const ctrlKey = async (key, code, vk, modifiers) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
      await sleep(250)
    }

    // ---- Ctrl+= x3 → 130%
    await ctrlKey('=', 'Equal', 187, 2)
    await ctrlKey('=', 'Equal', 187, 2)
    await ctrlKey('=', 'Equal', 187, 2)
    const zoomed = await waitFor(async () => ((await zoomOf()) === 130 ? 130 : null), 4000, 200)
    t.check('Ctrl+= x3 zooms to 130% and persists it', !!zoomed, String(await zoomOf()))
    const rowsAfter = await canvasMetric()
    const widthAfter = await shellWidth()
    // A bigger font fits fewer COLUMNS: the pty receives the new size through the existing fit path.
    t.check('zooming refits the pane live (the pty width shrinks)', widthBefore !== null && widthAfter !== null && widthAfter < widthBefore, `${String(widthBefore)} -> ${String(widthAfter)} cols`)

    // ---- Ctrl+0 resets to 100%
    await ctrlKey('0', 'Digit0', 48, 2)
    const reset = await waitFor(async () => ((await zoomOf()) === 100 ? 100 : null), 4000, 200)
    t.check('Ctrl+0 resets to 100%', !!reset, String(await zoomOf()))

    // ---- Terminal search (W3): Ctrl+Shift+F, typed query, count, Enter/Shift+Enter, Esc refocus.
    // Put a known line in the buffer first (twice one word, once another).
    await ev(`window.api.ptyWrite(${js(s.id)}, "Write-Host 'SEARCH-ONE SEARCH-TWO SEARCH-ONE'\\r")`)
    const echoed = await waitFor(
      async () => String(await ev(`window.api.ptyReplay(${js(s.id)}).then((r) => r.data)`)).includes('SEARCH-TWO'),
      6000,
      200
    )
    t.check('the search target line is in the terminal buffer', !!echoed)

    // The custom key handler only sees focused xterm events; click the pane again (same centre as before).
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(250)
    await ctrlKey('F', 'KeyF', 70, 10) // Ctrl (2) + Shift (8)
    const searchOpen = await waitFor(() => ev('!!document.querySelector("[data-testid=terminal-search]")'), 4000, 200)
    const focusedInput = await ev('document.activeElement?.getAttribute("aria-label") ?? null')
    t.check('Ctrl+Shift+F opens the search bar with its input focused', !!searchOpen && focusedInput === 'Find in terminal', String(focusedInput))

    const countText = () => ev('document.querySelector("[data-testid=terminal-search-count]")?.textContent ?? null')
    await app.send('Input.insertText', { text: 'SEARCH-ONE' })
    // Four: the echoed command line has it twice, the command's output twice.
    const firstCount = await waitFor(async () => { const value = await countText(); return value === '1/4' ? value : null }, 5000, 200)
    t.check('typing a query jumps to the first of four matches', firstCount === '1/4', String(await countText()))

    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 0 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 0 })
    const secondCount = await waitFor(async () => { const value = await countText(); return value === '2/4' ? value : null }, 4000, 200)
    t.check('Enter cycles to the next match', secondCount === '2/4', String(await countText()))

    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 })
    const backCount = await waitFor(async () => { const value = await countText(); return value === '1/4' ? value : null }, 4000, 200)
    t.check('Shift+Enter cycles back to the previous match', backCount === '1/4', String(await countText()))

    // Replace the query with one that cannot match: the counter says so.
    await ev(`(() => {
      const i = document.querySelector('[data-testid="terminal-search"] input')
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'NO-SUCH-TEXT')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    const noMatch = await waitFor(async () => { const value = await countText(); return value === 'No matches' ? value : null }, 4000, 200)
    t.check('a query with no match says "No matches"', noMatch === 'No matches', String(await countText()))

    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 })
    const searchClosed = await waitFor(
      () => ev('!document.querySelector("[data-testid=terminal-search]") && document.activeElement?.classList.contains("xterm-helper-textarea") === true'),
      4000,
      200
    )
    t.check('Esc closes the bar and gives the keyboard back to the terminal', !!searchClosed)

    // The built stylesheet is what the window loads: the arrow buttons must be gone.
    const cssDir = path.join(ROOT, 'out', 'renderer', 'assets')
    const cssFile = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).find((name) => name.endsWith('.css')) : undefined
    const cssText = cssFile === undefined ? '' : fs.readFileSync(path.join(cssDir, cssFile), 'utf8')
    t.check('the terminal stylesheet hides the scrollbar arrow buttons', cssText.includes('::-webkit-scrollbar-button'))

    // ---- Ctrl+wheel zooms without scrolling the buffer
    const scrollBefore = await ev('document.querySelector(".xterm-viewport")?.scrollTop ?? null')
    await app.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.x, y: rect.y, deltaX: 0, deltaY: -120, modifiers: 2 })
    await sleep(400)
    const wheelZoom = await waitFor(async () => ((await zoomOf()) === 110 ? 110 : null), 4000, 200)
    const scrollAfter = await ev('document.querySelector(".xterm-viewport")?.scrollTop ?? null')
    t.check('Ctrl+wheel zooms in one step (no buffer scroll)', !!wheelZoom && scrollBefore === scrollAfter, `zoom=${String(await zoomOf())} scroll ${String(scrollBefore)} -> ${String(scrollAfter)}`)

    // ---- Settings > Terminal shows the live zoom and applies scrollback
    await ev(`window.api.updateSettings({})`)
    await ev(`document.querySelector('[aria-label="Settings"], [aria-label="Open Settings"]')?.click()`)
    await sleep(500)
    await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Terminal')?.click()`)
    await sleep(400)
    const shown = await waitFor(() => ev('document.querySelector(\'[data-testid="termview-zoom"]\')?.innerText ?? null'), 4000, 200)
    t.check('the Terminal settings page shows the current zoom', shown === '110%', String(shown))
    await ev(`(() => {
      const i = document.querySelector('[aria-label="Scrollback lines"]')
      // React tracks the input value; the NATIVE setter keeps the input event from being deduped.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, '1000')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(200)
    await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Apply')?.click()`)
    await sleep(400)
    const scrollback = await ev(`JSON.parse(localStorage.getItem('sessiondeck.termview.v1') ?? '{}').scrollbackLines ?? null`)
    t.check('applying a scrollback setting persists it', scrollback === 1000, String(scrollback))
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(400)

    // ---- a graceful restart keeps the zoom
    await app.evaluate('window.api.quitApp()').catch(() => undefined)
    await sleep(6000)
    app.kill()
    await sleep(1500)
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const kept = await ev(`JSON.parse(localStorage.getItem('sessiondeck.termview.v1') ?? '{}').zoomPercent ?? null`)
    t.check('the zoom survives the restart', kept === 110, String(kept))
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
