// E2E for D76: right-click on a path in a terminal -> the menu starts with link rows (Open in Side Panel, Open in
// Default App, Show in Explorer, Copy Path; folders and URLs get their own rows), then the usual terminal rows.
// A right-click on plain text has no link rows. Only "Open in Side Panel" and "Copy Path" are clicked (nothing is opened
// on the desktop). Real Shell session in a short folder at the drive root (a printed line must not wrap).
// Run: node scripts/e2e-fileview-menu.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9426
const BS = String.fromCharCode(92)
const CR = String.fromCharCode(13)

function makeRoot() {
  for (const base of ['C:' + BS, os.tmpdir()]) {
    try {
      const dir = path.join(base, 'sd-mn')
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })
      return dir
    } catch { /* try the next base */ }
  }
  throw new Error('no writable folder')
}

async function main() {
  const t = makeChecker()
  let app
  const root = makeRoot()
  try {
    fs.writeFileSync(path.join(root, 'notes.md'), '# Menu Notes\n')
    fs.writeFileSync(path.join(root, 'My Report.pdf'), '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
    fs.mkdirSync(path.join(root, 'docs'))
    app = await launchApp({ port: PORT })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(root)}, name: 'menu', agent: 'shell' })`)
    const id = JSON.stringify(s.id)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('menu')).click()`)
    await waitFor(async () => /PS .*>/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 40000, 500)
    await sleep(800)
    const type = (text) => app.evaluate(`window.api.ptyWrite(${id}, ${JSON.stringify(text + CR)})`)
    await type("function prompt { '> ' }; Clear-Host")
    await sleep(1200)
    await type('"SIZE=" + $Host.UI.RawUI.WindowSize.Width + "x" + $Host.UI.RawUI.WindowSize.Height')
    const size = await waitFor(async () => /SIZE=(\d+)x(\d+)/.exec(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data).split(CR).join(''))?.slice(1, 3) ?? null, 10000, 300)
    const [cols, rows] = (size ?? ['0', '0']).map(Number)
    t.check('the shell reports its size', cols > 20 && rows > 5, `${cols}x${rows}`)

    const abs = (name) => root + BS + name
    const lines = [
      'see notes.md here',
      'saved ' + abs('My Report.pdf') + ' ok',
      'dir ' + abs('docs') + ' ok',
      'go https://example.com/page now',
      'plain words only'
    ]
    await type('$f = ' + lines.map((l) => `'${l}'`).join(',') + '; Clear-Host; $f')
    const printed = await waitFor(async () => /plain words only/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 15000, 300)
    t.check('the five lines are printed', !!printed)
    await sleep(800)

    const geo = () => app.evaluate(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height } })()`)
    // The cell size is measured ONCE: opening the side panel later narrows the terminal, but a cell stays the same size.
    const first = await geo()
    const cellW = first.w / cols
    const cellH = first.h / rows
    const point = async (row, col) => { const g = await geo(); return { x: g.left + (col + 0.5) * cellW, y: g.top + (row + 0.5) * cellH, g } }
    const closeMenu = async () => {
      await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(300)
    }
    // Hover (so the link is "hovered"), then a real right button press/release, then read the menu.
    const rightClick = async (row, col) => {
      const p = await point(row, col)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.g.left + p.g.w - 2, y: p.g.top + p.g.h - 2, button: 'none' })
      await sleep(150)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' })
      await waitFor(() => app.evaluate(`!!document.querySelector('.xterm-cursor-pointer')`), 900, 100)
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 })
      await waitFor(() => app.evaluate(`!!document.querySelector('[data-testid="terminal-context-menu"]')`), 4000, 150)
      await sleep(250)
      return app.evaluate(`({ link: [...document.querySelectorAll('[data-link-menu-row]')].map((n) => n.getAttribute('data-link-menu-row')), items: [...document.querySelectorAll('[data-testid="terminal-context-menu"] [role=menuitem]')].map((n) => n.innerText.trim()) })`)
    }
    const clickRow = async (rowId) => {
      const box = await app.evaluate(`(() => { const n = document.querySelector('[data-link-menu-row="${rowId}"]'); if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
      if (!box) return false
      for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) {
        await app.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 })
      }
      return true
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

    // ---- a viewable file
    let m = await rightClick(0, 8)
    { const shot = await app.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.join(__dirname, 'visual'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'visual', 'fileview-linkmenu.png'), Buffer.from(shot.result.data, 'base64')) }
    t.check('file: the menu offers Open in Side Panel, Open in Default App, Show in Explorer, Copy Path', same(m.link, ['preview', 'open', 'reveal', 'copyPath']), JSON.stringify(m.link))
    t.check('file: the usual terminal rows are still there', ['Copy', 'Paste'].every((x) => m.items.some((i) => i.startsWith(x))) && m.items.some((i) => /Find/.test(i)), JSON.stringify(m.items.slice(0, 12)))
    t.check('file: the link rows come FIRST', m.items.length > 4 && /Side Panel/.test(m.items[0]), JSON.stringify(m.items.slice(0, 3)))
    await clickRow('preview')
    const shown = await waitFor(() => app.evaluate(`document.querySelector('[data-preview-name]')?.textContent === 'notes.md' && /Menu Notes/.test(document.querySelector('[data-file-view]')?.innerText ?? '') || null`), 8000, 250)
    t.check('Open in Side Panel previews the file', !!shown, await app.evaluate(`document.querySelector('[data-preview-name]')?.textContent ?? 'no preview'`))
    await sleep(500)

    // ---- a path with a space (the pdf): Copy Path puts the absolute path on the clipboard
    m = await rightClick(1, 12)
    t.check('spaced path: viewable-file rows', same(m.link, ['preview', 'open', 'reveal', 'copyPath']), JSON.stringify(m.link))
    await clickRow('copyPath')
    await sleep(500)
    const clip = await app.evaluate(`navigator.clipboard.readText().catch(() => null)`)
    if (clip === null) console.log('SKIP  clipboard check: the OS clipboard is unavailable in this session.')
    else t.check('Copy Path copies the absolute path (with the space)', clip.toLowerCase() === abs('My Report.pdf').toLowerCase(), clip)
    await sleep(300)

    // ---- a folder
    m = await rightClick(2, 8)
    t.check('folder: Open Folder and Copy Path (no side panel row)', same(m.link, ['openFolder', 'copyPath']), JSON.stringify(m.link))
    await closeMenu()

    // ---- a URL
    m = await rightClick(3, 10)
    t.check('url: Open in Browser and Copy Link', same(m.link, ['openUrl', 'copyUrl']), JSON.stringify(m.link))
    await closeMenu()

    // ---- plain text: no link rows, the normal menu
    m = await rightClick(4, 3)
    t.check('plain text: no link rows', m.link.length === 0, JSON.stringify(m.link))
    t.check('plain text: the normal terminal menu opens', m.items.some((i) => i.startsWith('Paste')) && m.items.some((i) => /Clear Screen/.test(i)), JSON.stringify(m.items.slice(0, 6)))
    await closeMenu()
    // ---- no stale rows: hover a link, leave it, right-click plain text again
    await rightClick(0, 8)
    await closeMenu()
    m = await rightClick(4, 3)
    t.check('no stale link rows after the pointer left the link', m.link.length === 0, JSON.stringify(m.link))
    await closeMenu()
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
}
main()
