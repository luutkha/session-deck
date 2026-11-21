// E2E for D73: click a file path in a real terminal -> the side panel's Preview tab shows it (md, png, csv, xlsx, docx),
// the panel resizes by dragging its left edge (and keeps the width), and Detach opens the file in its own window.
// Uses a PowerShell Shell session in a temp folder (nothing is opened on the desktop: only plain clicks, never Ctrl/Shift).
// Run: node scripts/e2e-fileview.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const JSZip = require('jszip')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9411
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'
const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

async function zipTo(file, parts) {
  const zip = new JSZip()
  for (const [name, body] of Object.entries(parts)) zip.file(name, body)
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function makeFixtures(dir) {
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Preview Heading\n\nSome **bold** text.\n')
  fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.from(PNG, 'base64'))
  fs.writeFileSync(path.join(dir, 'data.csv'), 'name,city\nalpha,"Paris, FR"\nbeta,Rome\n')
  await zipTo(path.join(dir, 'sheet.xlsx'), {
    '[Content_Types].xml': CT + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': RELS + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': RELS + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Qty</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Other sheet</t></is></c></row></sheetData></worksheet>'
  })
  await zipTo(path.join(dir, 'doc.docx'), {
    '[Content_Types].xml': CT + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': RELS + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello docx world</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold line</w:t></w:r></w:p></w:body></w:document>'
  })
}

/** Evaluates in another CDP page (the detached viewer window). */
async function evalIn(wsUrl, expression) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  const result = await new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result?.result?.value) }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  ws.close()
  return result
}

async function main() {
  const t = makeChecker()
  let app
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-fileview-'))
  try {
    await makeFixtures(dir)
    app = await launchApp({ port: PORT })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(dir)}, name: 'view probe', agent: 'shell' })`)
    const id = JSON.stringify(s.id)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('view probe')).click()`)
    await waitFor(async () => /PS .*>/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 40000, 500)
    await sleep(1000)

    // ---- main process: the reader behind the panel
    const direct = await app.evaluate(`window.api.readFileView(${id}, 'data.csv')`)
    t.check('readFileView parses a csv with a quoted comma', direct.ok && direct.view.sheets[0].rows[1][1] === 'Paris, FR', JSON.stringify(direct.view?.sheets?.[0]?.rows))
    const bad = await app.evaluate(`window.api.readFileView(${id}, 'no-such-file.md')`)
    t.check('a missing file is refused politely', bad.ok === false && typeof bad.error === 'string')
    const exe = await app.evaluate(`window.api.readFileView(${id}, 'C:\\\\Windows\\\\System32\\\\notepad.exe')`)
    t.check('an executable has no viewer', exe.ok === false)

    // ---- terminal: a short prompt (the default one holds a folder link), the window height in rows (for exact click
    // positions), then the five names printed by a SHORT command so the rows are the same with the panel open or closed.
    const names = ['notes.md', 'photo.png', 'data.csv', 'sheet.xlsx', 'doc.docx']
    const type = async (text) => app.evaluate(`window.api.ptyWrite(${id}, ${JSON.stringify(text + '\r')})`)
    await type("function prompt { '> ' }; Clear-Host")
    await sleep(1200)
    await type('"ROWS=" + $Host.UI.RawUI.WindowSize.Height')
    const rowsText = await waitFor(async () => /ROWS=(\d+)/.exec(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data).replace(/\r/g, ''))?.[1] ?? null, 10000, 300)
    const rows = Number(rowsText)
    t.check('the shell reports its row count', rows > 5, String(rowsText))
    const resolvedAll = await app.evaluate(`window.api.resolveLinks(${id}, ${JSON.stringify(names)})`)
    t.check('main resolves all five names as files', resolvedAll.every((r) => r?.kind === 'file'), JSON.stringify(resolvedAll.map((r) => r && r.kind)))
    await type("$f = " + names.map((n) => `'${n}'`).join(',') + '; Clear-Host')
    await sleep(1200)
    await type('$f')
    const printed = await waitFor(async () => /doc\.docx\s*\r?\n> $/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 15000, 300)
    t.check('the five names are printed', !!printed)
    await sleep(500)
    const geo = () => app.evaluate(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height } })()`)
    const seen = {}
    const reader = `(() => {
      const root = document.querySelector('[data-file-view]'); if (!root) return null
      const kind = root.getAttribute('data-file-view')
      const text = root.innerText
      const img = document.querySelector('[data-testid="file-view-image"] img')
      return { name: document.querySelector('[data-preview-name]')?.textContent ?? '', kind, text, img: img ? (img.getAttribute('src') || '').slice(0, 22) : '', tabs: [...document.querySelectorAll('[data-sheet-tab]')].map((n) => n.innerText) }
    })()`
    // Row 0 is the "> $f" line; the names are on rows 1..5. Click each one in the middle of its row, near the left edge.
    for (let i = 0; i < names.length; i += 1) {
      const g = await geo()
      const x = g.left + 25
      const y = g.top + (i + 1.5) * (g.h / rows)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.left + g.w - 2, y: g.top + g.h - 2, button: 'none' })
      await sleep(150)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      await waitFor(() => app.evaluate(`!!document.querySelector('.xterm-cursor-pointer')`), 1500, 100)
      for (const [kind, buttons] of [['mousePressed', 1], ['mouseReleased', 0]]) {
        await app.send('Input.dispatchMouseEvent', { type: kind, x, y, button: 'left', buttons, clickCount: 1 })
      }
      const got = await waitFor(async () => { const r = await app.evaluate(reader); return r && r.name === names[i] ? r : null }, 6000, 250)
      if (got && got.name === 'photo.png') {
        // The size label starts as "Loading image..." and must become the natural size once the image has loaded.
        const label = await waitFor(async () => { const l = await app.evaluate(`document.querySelector('[data-image-size]')?.textContent ?? ''`); return l && !/loading/i.test(l) ? l : null }, 5000, 250)
        t.check('the image size label settles to the natural size', !!label, String(label))
      }
      if (got) {
        seen[got.name] = got
        // A screenshot per file type, to look at (scripts/visual is where the other e2e suites keep theirs).
        const shot = await app.send('Page.captureScreenshot', { format: 'png' })
        fs.mkdirSync(path.join(__dirname, 'visual'), { recursive: true })
        fs.writeFileSync(path.join(__dirname, 'visual', `fileview-${got.name.replace(/[^a-z0-9]+/gi, '-')}.png`), Buffer.from(shot.result.data, 'base64'))
      }
    }
    t.check('a plain click on a path opens the Preview tab', await app.evaluate(`document.querySelector('[data-side-tab="preview"]')?.getAttribute('aria-selected') === 'true'`))
    t.check('every viewable path was reachable by clicking', Object.keys(seen).length === names.length, Object.keys(seen).join(', '))
    t.check('markdown renders its heading', /Preview Heading/.test(seen['notes.md']?.text ?? '') && seen['notes.md']?.kind === 'markdown')
    t.check('image renders as a data URL', seen['photo.png']?.kind === 'image' && seen['photo.png']?.img.startsWith('data:image/png'))
    t.check('csv renders its table', seen['data.csv']?.kind === 'csv' && /Paris, FR/.test(seen['data.csv'].text))
    t.check('xlsx renders sheet 1 with two sheet tabs', seen['sheet.xlsx']?.kind === 'sheet' && /Widget/.test(seen['sheet.xlsx'].text) && seen['sheet.xlsx'].tabs.length === 2, JSON.stringify(seen['sheet.xlsx']?.tabs))
    t.check('docx renders its text', seen['doc.docx']?.kind === 'docx' && /Hello docx world/.test(seen['doc.docx'].text))

    // ---- xlsx: second sheet tab
    await app.evaluate(`window.api.getStore()`)
    // ---- resize: drag the panel's left edge 120px to the left
    const widthOf = () => app.evaluate(`document.querySelector('[data-testid="side-panel-resize-handle"]').parentElement.getBoundingClientRect().width`)
    const before = await widthOf()
    const hp = await app.evaluate(`(() => { const r = document.querySelector('[data-testid="side-panel-resize-handle"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp.x, y: hp.y, button: 'none' })
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hp.x, y: hp.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 6; i += 1) await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp.x - i * 20, y: hp.y, button: 'left', buttons: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hp.x - 120, y: hp.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(500)
    const after = await widthOf()
    // The panel may grow by the drag, but never past the room that leaves the terminal its minimum (window - sidebar - 420).
    const room = await app.evaluate(`window.innerWidth - (document.querySelector('[class*="border-r"]')?.getBoundingClientRect().width ?? 0) - 420`)
    const expectedWidth = Math.min(before + 120, room)
    t.check('dragging the left edge widens the panel by the drag, held to the room the terminal keeps', after - before > 25 && Math.abs(after - expectedWidth) <= 3, `${before} -> ${after} (room ${room})`)
    const stored = await app.evaluate(`window.localStorage.getItem('sessiondeck.sidePanelWidth.v1')`)
    t.check('the new width is saved', Number(stored) === Math.round(after), String(stored))

    // ---- detach: the same file in its own window (a CDP target's title is the page <title>, so find it as the new page)
    const mainIds = new Set((await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === 'page').map((x) => x.id))
    const lastName = await app.evaluate(`document.querySelector('[data-preview-name]')?.textContent ?? ''`)
    await app.evaluate(`document.querySelector('[data-preview-detach]').click()`)
    const viewer = await waitFor(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      return targets.find((x) => x.type === 'page' && !x.url.startsWith('devtools') && !mainIds.has(x.id)) ?? null
    }, 15000, 500)
    t.check('Detach opens a second window', !!viewer, viewer?.url)
    if (viewer) {
      const body = await waitFor(async () => evalIn(viewer.webSocketDebuggerUrl, `document.querySelector('[data-file-view]')?.getAttribute('data-file-view') ?? ''`), 15000, 500)
      t.check('the detached window shows the file (and not the app shell)', body === seen[lastName]?.kind && (await evalIn(viewer.webSocketDebuggerUrl, `!document.querySelector('[role="treeitem"]')`)) === true, String(body))
    }

    // ---- close preview goes back to Notes
    await app.evaluate(`document.querySelector('[data-preview-close]').click()`)
    await sleep(500)
    t.check('closing the preview returns to the Notes tab', await app.evaluate(`document.querySelector('[data-side-tab="preview"]') === null && document.querySelector('[data-side-tab="notes"]')?.getAttribute('aria-selected') === 'true'`))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main()
