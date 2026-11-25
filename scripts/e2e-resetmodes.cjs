// E2E: "Reset Terminal Modes" in the terminal right-click menu. A program that leaves the alternate screen / mouse reporting
// on (Claude's fullscreen UI after failing to start) takes away scrollback, the wheel and text selection; the menu row
// switches them off again without erasing anything.
// Run: npx electron-vite build && node scripts/e2e-resetmodes.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9500
const js = (value) => JSON.stringify(value)

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-resetmodes-'))
  const userData = path.join(root, 'userdata')
  const work = path.join(root, 'work')
  fs.mkdirSync(userData)
  fs.mkdirSync(work)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    const mouse = async (x, y, button) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
    }
    const s = await ev(`window.api.createSession({ cwd: ${js(work)}, name: 'reset-modes', agent: 'shell' })`)
    await waitFor(() => ev(`!!document.querySelector('[data-session-card="${s.id}"]')`), 10000, 200)
    await ev(`document.querySelector('[data-session-card="${s.id}"]').click()`)
    await waitFor(() => ev(`!!document.querySelector('[data-session-id=${js(s.id)}] .xterm-screen')`), 15000, 300)
    await sleep(1500)
    await ev(`window.api.ptyWrite(${js(s.id)}, "1..300 | ForEach-Object { 'LINE-' + $_ }\\r")`)
    await sleep(3000)
    const scrollInfo = () => ev(`(() => { const v = document.querySelector('[data-session-id=${js(s.id)}] .xterm-viewport'); return { scrollHeight: v.scrollHeight, clientHeight: v.clientHeight } })()`)
    const before = await scrollInfo()
    t.check('before: the terminal has scrollback', before.scrollHeight > before.clientHeight * 2, js(before))

    // ---- the program leaves the alternate screen switched on (what a failed full-screen start does)
    const enter = "[Console]::Write(([char]27)+'[?1049h'+([char]27)+'[?1000h'+([char]27)+'[?1006h')"
    await ev(`window.api.ptyWrite(${js(s.id)}, ${js(enter + String.fromCharCode(13))})`)
    await sleep(1500)
    const stuck = await scrollInfo()
    t.check('stuck: the alternate screen has no scrollback', stuck.scrollHeight <= stuck.clientHeight, js(stuck))

    // ---- right-click > Reset Terminal Modes
    const c = await ev(`(() => { const r = document.querySelector('[data-session-id=${js(s.id)}] .xterm-screen').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    await mouse(c.x, c.y, 'right')
    const open = await waitFor(() => ev('!!document.querySelector("[data-testid=terminal-context-menu]")'), 3000, 100)
    t.check('the right-click menu opens even while mouse reporting is on', !!open)
    const items = await ev('[...document.querySelectorAll("[data-testid=terminal-context-menu] [role=menuitem]")].map((n) => n.innerText.split("\\n")[0].trim())')
    t.check('the menu has Reset Terminal Modes', items.includes('Reset Terminal Modes'), js(items))
    const r = await ev(`(() => { const n = [...document.querySelectorAll('[data-testid=terminal-context-menu] [role=menuitem]')].find((m) => m.innerText.split('\\n')[0].trim() === 'Reset Terminal Modes'); if (!n) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
    if (r !== null) await mouse(r.x, r.y, 'left')
    await sleep(800)
    const after = await scrollInfo()
    t.check('after: the scrollback is back (nothing was erased)', after.scrollHeight > after.clientHeight * 2, js(after))

    // ---- and the wheel scrolls it again
    await app.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -600 })
    await sleep(500)
    const top = await ev(`document.querySelector('[data-session-id=${js(s.id)}] .xterm-viewport').scrollTop`)
    t.check('the wheel scrolls back up through the old output', top < after.scrollHeight - after.clientHeight - 100, `${top} of ${after.scrollHeight - after.clientHeight}`)
  } catch (error) {
    t.check('reset-modes e2e ran without an exception', false, String(error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
