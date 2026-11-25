// E2E (D70): the sessions sidebar's width is adjustable. Drag its edge (live resize, limits), arrows / Home / End on the focused
// handle, double-click resets, the terminal area follows, the width survives a restart, and a small window keeps room for the terminal.
// Run: npx electron-vite build && node scripts/e2e-sidebarwidth.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9502
const js = (value) => JSON.stringify(value)

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-sidebarwidth-'))
  const userData = path.join(root, 'userdata')
  const work = path.join(root, 'work')
  fs.mkdirSync(userData)
  fs.mkdirSync(work)
  let app
  const open = async () => {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    await waitFor(() => app.evaluate('!!document.querySelector("[data-testid=sidebar-resize-handle]") || null'), 10000, 200)
  }
  const close = async () => {
    app.kill()
    await sleep(1200)
  }
  try {
    await open()
    const ev = (expr) => app.evaluate(expr)
    const asideWidth = () => ev('Math.round(document.querySelector("aside").getBoundingClientRect().width)')
    const handleCenter = () => ev('(() => { const r = document.querySelector("[data-testid=sidebar-resize-handle]").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()')
    const mouse = (type, x, y, extra = {}) => app.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' || (type === 'mouseMoved' && !extra.button) ? 0 : 1, clickCount: 1, ...extra })
    const drag = async (deltaX) => {
      const c = await handleCenter()
      await mouse('mouseMoved', c.x, c.y)
      await mouse('mousePressed', c.x, c.y)
      for (let step = 1; step <= 10; step += 1) {
        await mouse('mouseMoved', c.x + Math.round((deltaX * step) / 10), c.y, { button: 'left' })
      }
      await mouse('mouseReleased', c.x + deltaX, c.y)
      await sleep(400)
    }
    const key = async (k, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: { ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }[k], modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: { ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }[k], modifiers })
      await sleep(300)
    }
    const stored = () => ev('localStorage.getItem("sessiondeck.sidebarWidth.v1")')

    // A session, so there is a terminal whose width follows the sidebar.
    const s = await ev(`window.api.createSession({ cwd: ${js(work)}, name: 'width test', agent: 'shell' })`)
    await waitFor(() => ev(`!!document.querySelector('[data-session-card="${s.id}"]') || null`), 10000, 200)
    await ev(`document.querySelector('[data-session-card="${s.id}"]').click()`)
    await waitFor(() => ev('!!document.querySelector(".xterm-screen")'), 15000, 300)
    await sleep(1200)
    const termWidth = () => ev('Math.round([...document.querySelectorAll(".xterm-screen")].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect().width)')

    t.check('the default width is 300', (await asideWidth()) === 300, String(await asideWidth()))
    const handleOnTop = await ev('(() => { const r = document.querySelector("[data-testid=sidebar-resize-handle]").getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e?.getAttribute("data-testid") ?? e?.tagName })()')
    t.check('the handle is on top at the sidebar edge (nothing covers it)', handleOnTop === 'sidebar-resize-handle', String(handleOnTop))
    const term0 = await termWidth()

    // ---- drag wider and narrower
    await drag(100)
    t.check('dragging the edge 100px right makes the sidebar 400px', (await asideWidth()) === 400, String(await asideWidth()))
    t.check('the terminal got narrower by the same amount', Math.abs(term0 - (await termWidth()) - 100) <= 12, `${term0} -> ${await termWidth()}`)
    t.check('the width is stored', (await stored()) === '400', String(await stored()))
    await drag(-60)
    t.check('dragging left makes it 340px', (await asideWidth()) === 340, String(await asideWidth()))

    // ---- limits
    await drag(-900)
    t.check('it stops at the minimum (220px)', (await asideWidth()) === 220, String(await asideWidth()))
    await drag(1500)
    const vw = await ev('window.innerWidth')
    const wide = await asideWidth()
    t.check('it stops at the maximum (640px) or leaves 420px for the terminal in a small window', wide === Math.min(640, vw - 420), `${wide} of window ${vw}`)

    // ---- keyboard on the focused handle
    await ev('document.querySelector("[data-testid=sidebar-resize-handle]").focus()')
    await key('Home')
    t.check('Home goes to the minimum', (await asideWidth()) === 220, String(await asideWidth()))
    await key('ArrowRight')
    t.check('ArrowRight adds 16px', (await asideWidth()) === 236, String(await asideWidth()))
    await key('ArrowRight', 8)
    t.check('Shift+ArrowRight adds 64px', (await asideWidth()) === 300, String(await asideWidth()))
    await key('ArrowLeft')
    t.check('ArrowLeft takes 16px off', (await asideWidth()) === 284, String(await asideWidth()))
    t.check('the handle announces its value (aria-valuenow)', (await ev('document.querySelector("[data-testid=sidebar-resize-handle]").getAttribute("aria-valuenow")')) === '284')

    // ---- double-click resets
    const c = await handleCenter()
    await mouse('mouseMoved', c.x, c.y)
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 2 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 2 })
    await sleep(400)
    t.check('double-clicking the edge resets to 300px', (await asideWidth()) === 300, String(await asideWidth()))

    // ---- survives a restart
    await drag(80)
    t.check('set to 380px', (await asideWidth()) === 380, String(await asideWidth()))
    // A real quit (the user's way out) flushes localStorage to disk; a kill would lose the last writes, which is not what a user does.
    await ev('window.api.quitApp()').catch(() => undefined)
    await sleep(4000)
    await close()
    await open()
    t.check('the width is back after a restart', (await asideWidth()) === 380, String(await asideWidth()))

    // ---- hiding and showing the sidebar keeps the width, and the handle is gone while it is hidden
    await ev(`(() => { const b = document.querySelector('[aria-label="Hide sidebar"], [aria-label="Toggle sidebar"]'); if (b) b.click() })()`)
    await sleep(500)
    const hidden = await ev('!document.querySelector("[data-testid=sidebar-resize-handle]")')
    if (hidden) {
      t.check('with the sidebar hidden there is no handle', true)
      await ev(`(() => { const b = document.querySelector('[aria-label="Show sidebar"]'); if (b) b.click() })()`)
      await sleep(600)
      t.check('showing it again keeps the width', (await asideWidth()) === 380, String(await asideWidth()))
    } else {
      console.log('SKIP  hide/show check (no hide-sidebar button found)')
    }
  } catch (error) {
    t.check('sidebar-width e2e ran without an exception', false, String(error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
