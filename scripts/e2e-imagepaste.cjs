// E2E: pasting an IMAGE from the clipboard attaches it in Claude, and dropping a file pastes its path.
// Run: node scripts/e2e-imagepaste.cjs  (starts one real claude session, no prompt is sent)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

// 8x8 red PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

async function main() {
  const t = makeChecker()
  let app
  try {
    const png = path.join(os.tmpdir(), 'sessiondeck drop test.png')
    fs.writeFileSync(png, Buffer.from(PNG_B64, 'base64'))
    app = await launchApp({ port: 9393 })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'image probe' })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('image probe')).click()`)
    await waitFor(async () => /Try "|❯/.test(strip((await app.evaluate(`window.api.ptyReplay(${JSON.stringify(s.id)})`)).data)), 40000, 1000)
    await sleep(1500)
    const replay = async () => strip((await app.evaluate(`window.api.ptyReplay(${JSON.stringify(s.id)})`)).data)
    const rect = await app.evaluate(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)

    // --- drop a file whose path contains spaces
    const dd = { items: [], files: [png], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop']) await app.send('Input.dispatchDragEvent', { type, x: rect.x, y: rect.y, data: dd })
    const dropped = await waitFor(async () => { const r = await replay(); return r.includes('sessiondeck drop test') || /\[Image ?#1\]/.test(r) }, 8000, 400)
    t.check('dropping a file pastes its path (Claude attaches it as [Image #1])', !!dropped)

    // --- paste an image from the clipboard (right-click, then Paste in the terminal menu, D59)
    await app.evaluate(`navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(new Blob([Uint8Array.from(atob('${PNG_B64}'), (c) => c.charCodeAt(0))], { type: 'image/png' })) })])`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none' })
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'right', buttons: 2, clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'right', buttons: 0, clickCount: 1 })
    await sleep(600)
    const item = await app.evaluate(`(() => { const n = [...document.querySelectorAll('[data-testid=terminal-context-menu] [role=menuitem]')].find((m) => m.innerText.startsWith('Paste')); if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
    t.check('right-click shows the terminal menu with Paste', item !== null)
    if (item !== null) {
      for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) {
        await app.send('Input.dispatchMouseEvent', { type, x: item.x, y: item.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 })
      }
    }
    const attached = await waitFor(async () => /\[Image ?#2\]/.test(await replay()), 10000, 500)
    t.check('pasting an image from the clipboard attaches a second image ([Image #2])', !!attached)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
