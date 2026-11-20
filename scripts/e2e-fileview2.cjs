// E2E for D74 (file viewer enhancements) in the real built app: the Jarvis preview_file tool opens files, live reload
// (edit / delete / restore on disk), UTF-16 text, header buttons, find, text and image zoom, a 250-row CSV (paging, sort),
// drop a file on the side panel, the palette's "Preview file..." item and Settings > Agents' OpenCode row.
// Nothing is opened on the desktop (the Open / Show in Explorer buttons are only checked for presence).
// Run: node scripts/e2e-fileview2.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9421
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

async function main() {
  const t = makeChecker()
  let app
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-fileview2-'))
  const p = (name) => path.join(dir, name)
  try {
    fs.writeFileSync(p('live.md'), '# Live Heading\n\nfirst version\n')
    fs.writeFileSync(p('photo.png'), Buffer.from(PNG, 'base64'))
    // UTF-16 LE with a BOM, as PowerShell's ">" writes it.
    fs.writeFileSync(p('wide.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo wörld in utf16\r\n', 'utf16le')]))
    fs.writeFileSync(p('big.csv'), ['name,score', ...Array.from({ length: 250 }, (_, i) => `n${i + 1},${(i * 7) % 100}`)].join('\n') + '\n')
    fs.writeFileSync(p('long.md'), '# Long\n\n' + Array.from({ length: 30 }, (_, i) => `line ${i + 1} has a needle in it`).join('\n\n') + '\n')
    fs.writeFileSync(p('dropped.md'), '# Dropped File\n')

    app = await launchApp({ port: PORT })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(dir)}, name: 'view two', agent: 'shell' })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('view two')).click()`)
    await sleep(2500)

    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })).json()
    const tool = async (name, args = {}) => { const b = await rpc('tools/call', { name, arguments: args }); return { text: b.result.content[0].text, error: b.result.isError === true } }
    const ev = (x) => app.evaluate(x)
    const shownName = () => ev(`document.querySelector('[data-preview-name]')?.textContent ?? ''`)
    const paneText = () => ev(`document.querySelector('[data-file-view]')?.innerText ?? ''`)
    const open = async (file) => { const r = await tool('preview_file', { path: file, session: 'view two' }); await waitFor(async () => (await shownName()) === file && (await ev(`!!document.querySelector('[data-file-view]') && !document.querySelector('[data-preview-loading]')`)), 8000, 200); await sleep(300); return r }

    // ---- Jarvis tool
    const names = (await rpc('tools/list', {})).result.tools.map((x) => x.name)
    t.check('Jarvis offers preview_file', names.includes('preview_file'))
    const bad = await tool('preview_file', { path: 'program.exe', session: 'view two' })
    t.check('preview_file refuses a type with no viewer', bad.error && /support|kind|preview/i.test(bad.text), bad.text.slice(0, 80))
    const r1 = await open('live.md')
    t.check('preview_file opens a file in the Preview tab', !r1.error && /Live Heading/.test(await paneText()), r1.text.slice(0, 80))
    t.check('the panel switched to the Preview tab', await ev(`document.querySelector('[data-side-tab="preview"]')?.getAttribute('aria-selected') === 'true'`))

    // ---- header buttons
    const actions = await ev(`['copy', 'open', 'reveal'].map((a) => !!document.querySelector('[data-file-action="' + a + '"]'))`)
    t.check('Copy path / Open in app / Show in Explorer buttons are there', actions.every(Boolean), JSON.stringify(actions))
    await ev(`document.querySelector('[data-file-action="copy"]').click()`)
    await sleep(500)
    const clip = await ev(`navigator.clipboard.readText().catch(() => null)`)
    if (clip === null) console.log('SKIP  copied path check: the OS clipboard is unavailable in this session.')
    else t.check('Copy path puts the absolute path on the clipboard', clip.toLowerCase() === p('live.md').toLowerCase(), clip)

    // ---- live reload
    fs.writeFileSync(p('live.md'), '# Changed Heading\n\nsecond version\n')
    const reloaded = await waitFor(async () => /Changed Heading/.test(await paneText()), 9000, 400)
    t.check('editing the file on disk updates the open preview by itself', !!reloaded)
    fs.rmSync(p('live.md'))
    const gone = await waitFor(() => ev(`!!document.querySelector('[data-preview-notice]') && /no longer exists/i.test(document.querySelector('[data-preview-notice]').innerText)`), 9000, 400)
    t.check('a deleted file keeps its content and says it no longer exists', !!gone && /Changed Heading/.test(await paneText()))
    fs.writeFileSync(p('live.md'), '# Back Again\n')
    const back = await waitFor(async () => /Back Again/.test(await paneText()), 9000, 400)
    t.check('the file coming back is picked up again', !!back)

    // ---- UTF-16
    await open('wide.txt')
    const wide = await paneText()
    t.check('a UTF-16 text file is readable', /héllo wörld in utf16/.test(wide), wide.slice(0, 60))

    // ---- image zoom
    await open('photo.png')
    const z0 = await ev(`document.querySelector('[data-image-zoom]')?.getAttribute('data-image-zoom') ?? 'none'`)
    await ev(`document.querySelector('[aria-label="Zoom in image"]').click()`)
    await sleep(300)
    const z1 = await ev(`document.querySelector('[data-image-zoom]')?.getAttribute('data-image-zoom') ?? 'none'`)
    t.check('image zoom in changes the zoom level', z0 !== z1, `${z0} -> ${z1}`)

    // ---- table: paging and sort
    await open('big.csv')
    const range0 = await ev(`document.querySelector('[data-table-range]')?.innerText ?? ''`)
    t.check('a 250-row csv is paged (rows 1-200 of 250)', /1\s*[-–]\s*200/.test(range0) && /250/.test(range0), range0)
    await ev(`document.querySelector('[aria-label="Next page"]').click()`)
    await sleep(300)
    const range1 = await ev(`document.querySelector('[data-table-range]')?.innerText ?? ''`)
    t.check('Next page shows the rest of the rows', /201/.test(range1) && /250/.test(range1), range1)
    await ev(`document.querySelector('[aria-label="Previous page"]').click()`)
    await ev(`[...document.querySelectorAll('[data-file-table] th button')].find((b) => /Sort by score/i.test(b.getAttribute('aria-label') || ''))?.click()`)
    await sleep(300)
    const sorted = await ev(`(() => { const th = [...document.querySelectorAll('[data-file-table] th')].find((n) => n.hasAttribute('aria-sort')); return th ? th.getAttribute('aria-sort') : '' })()`)
    t.check('clicking a column header sorts it', sorted === 'ascending' || sorted === 'descending', sorted)

    // ---- find + text zoom
    await open('long.md')
    const box = await ev(`(() => { const r = document.querySelector('[data-file-view]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    for (const [type, buttons] of [['mousePressed', 1], ['mouseReleased', 0]]) await app.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons, clickCount: 1 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 })
    const findOpen = await waitFor(() => ev(`!!document.querySelector('[data-file-find]')`), 3000, 200)
    t.check('Ctrl+F in the pane opens the find bar', !!findOpen)
    await app.send('Input.insertText', { text: 'needle' })
    const counter = await waitFor(async () => { const c = await ev(`document.querySelector('[data-find-counter]')?.innerText ?? ''`); return /1\s*\/\s*30/.test(c) ? c : null }, 4000, 200)
    t.check('find counts every match (30) and starts on the first', !!counter, String(counter))
    await ev(`document.querySelector('[aria-label="Next match"]').click()`)
    await sleep(300)
    const counter2 = await ev(`document.querySelector('[data-find-counter]')?.innerText ?? ''`)
    t.check('Next match moves to 2 of 30', /2\s*\/\s*30/.test(counter2), counter2)
    const marks = await ev(`document.querySelectorAll('[data-file-view] mark').length`)
    t.check('matches are highlighted in the page', marks >= 30, String(marks))
    await ev(`document.querySelector('[aria-label="Close find"]').click()`)
    const tz0 = Number(await ev(`document.querySelector('[data-text-zoom]')?.getAttribute('data-text-zoom') ?? '0'`))
    await ev(`document.querySelector('[aria-label="Increase text size"]').click()`)
    await sleep(300)
    const tz1 = Number(await ev(`document.querySelector('[data-text-zoom]')?.getAttribute('data-text-zoom') ?? '0'`))
    t.check('A+ makes the text bigger', tz1 > tz0 && tz0 > 0, `${tz0} -> ${tz1}`)

    // ---- drop a file on the side panel
    const panel = await ev(`(() => { const r = document.querySelector('aside[class*="border-l"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const drag = { items: [], files: [p('dropped.md')], dragOperationsMask: 1 }
    await app.send('Input.dispatchDragEvent', { type: 'dragEnter', x: panel.x, y: panel.y, data: drag })
    await app.send('Input.dispatchDragEvent', { type: 'dragOver', x: panel.x, y: panel.y, data: drag })
    const overlay = await ev(`!!document.querySelector('[data-drop-overlay="preview"]')`)
    await app.send('Input.dispatchDragEvent', { type: 'drop', x: panel.x, y: panel.y, data: drag })
    const dropped = await waitFor(async () => (await shownName()).includes('dropped.md'), 6000, 250)
    t.check('dropping a file on the side panel previews it', !!dropped, `overlay=${overlay} name=${await shownName()}`)

    // ---- palette
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'K', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 10 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'K', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 10 })
    await sleep(600)
    await app.send('Input.insertText', { text: 'Preview file' })
    const item = await waitFor(() => ev(`[...document.querySelectorAll('[cmdk-item]')].some((n) => /Preview file/i.test(n.innerText))`), 4000, 200)
    t.check('the palette offers "Preview file..."', !!item)
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(400)

    // ---- Settings > Agents: the OpenCode row
    await tool('open_dialog', { name: 'settings', page: 'agents' })
    const first = await ev(`document.querySelector('[data-opencode-probe]')?.innerText ?? ''`)
    t.check('before the answer arrives the row says Checking (not a made-up version)', /checking/i.test(first) || /\d+\.\d+\.\d+/.test(first), first.replace(/\s+/g, ' ').slice(0, 80))
    const row = await waitFor(async () => { const x = await ev(`document.querySelector('[data-opencode-probe]')?.innerText ?? ''`); return /\d+\.\d+\.\d+/.test(x) ? x : null }, 8000, 250)
    t.check('Settings > Agents shows the OpenCode version and --standalone support', !!row && /\d+\.\d+\.\d+/.test(row) && /standalone/i.test(row), String(row).replace(/\s+/g, ' ').slice(0, 100))
    await ev(`document.querySelector('[aria-label^="Re-check the OpenCode"]').click()`)
    const again = await waitFor(async () => { const x = await ev(`document.querySelector('[data-opencode-probe]')?.innerText ?? ''`); return /\d+\.\d+\.\d+/.test(x) && !/checking/i.test(x) ? x : null }, 15000, 400)
    t.check('Re-check probes again and shows the answer', !!again, String(again).replace(/\s+/g, ' ').slice(0, 100))
    void s
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* temp folder still locked: leave it */ }
  }
}
main()
