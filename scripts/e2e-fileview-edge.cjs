// E2E for D73-D75 hardening: broken, empty, hostile and huge files, rapid clicks, a session removed mid-preview, a
// detached window. Every case must end in a readable result or a clear message (never a blank pane or an endless
// "Loading"), the app must stay responsive, and the page must not log an uncaught exception or an unhandled rejection.
// Opens files through the Jarvis `preview_file` tool. Run: node scripts/e2e-fileview-edge.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const JSZip = require('jszip')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9427
const NL = String.fromCharCode(10)

async function makeSparseXlsx(file, rows) {
  const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CT)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  // Two cells per row, in column A and in column XFD (16384): the parser pads every row to 16384 cells.
  let xml = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
  for (let r = 1; r <= rows; r += 1) xml += `<row r="${r}"><c r="A${r}"><v>1</v></c><c r="XFD${r}"><v>2</v></c></row>`
  xml += '</sheetData></worksheet>'
  zip.file('xl/worksheets/sheet1.xml', xml)
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function main() {
  const t = makeChecker()
  let app
  let cws
  const issues = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-edge-'))
  const p = (name) => path.join(dir, name)
  try {
    // ---- fixtures: broken, empty, hostile, huge
    fs.writeFileSync(p('empty.md'), '')
    fs.writeFileSync(p('empty.csv'), '')
    fs.writeFileSync(p('empty.xlsx'), '')
    fs.writeFileSync(p('bad.xlsx'), 'this is not a zip file')
    fs.writeFileSync(p('bad.docx'), 'this is not a zip file either')
    fs.writeFileSync(p('bad.png'), 'not a png')
    fs.writeFileSync(p('bad.pdf'), 'not a pdf')
    fs.writeFileSync(p('empty.pdf'), '')
    fs.writeFileSync(p('bad.svg'), 'plain text, no svg tag')
    // A decompression bomb: a tiny zip whose one part inflates to 80 MB (main must refuse it BEFORE parsing).
    for (const name of ['bomb.xlsx', 'bomb.docx']) {
      const zip = new JSZip()
      zip.file(name.endsWith('xlsx') ? 'xl/worksheets/sheet1.xml' : 'word/document.xml', Buffer.alloc(80 * 1024 * 1024, 0x41))
      fs.writeFileSync(p(name), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    }
    // The review's crash input: a ~240 KB workbook that made the old parser run the main process out of memory.
    await makeSparseXlsx(p('sparse.xlsx'), 30000)
    // A European Excel export: semicolon separated, decimal commas inside quotes.
    fs.writeFileSync(p('euro.csv'), 'name;price' + NL + 'tea;"1,5"' + NL + 'cake;"2,25"' + NL)
    const bin = Buffer.alloc(200000)
    for (let i = 0; i < bin.length; i += 1) bin[i] = (i * 7919) % 256
    fs.writeFileSync(p('binary.txt'), bin)
    fs.writeFileSync(p('big.txt'), Array.from({ length: 60000 }, (_, i) => `line number ${i} with some padding text`).join(NL))
    fs.writeFileSync(p('big.csv'), 'a,b,c' + NL + Array.from({ length: 300000 }, (_, i) => `${i},row${i},${i * 2}`).join(NL))
    fs.writeFileSync(p('wide.csv'), Array.from({ length: 5 }, (_, r) => Array.from({ length: 500 }, (_, c) => `r${r}c${c}`).join(',')).join(NL))
    fs.writeFileSync(p('one-long-line.txt'), 'x'.repeat(3 * 1024 * 1024))
    fs.writeFileSync(p('smile \u{1F600}.md'), '# Emoji file name')
    fs.writeFileSync(p('quotes \'single\' and &amp; amp.md'), '# Odd characters in the name')
    for (let i = 1; i <= 5; i += 1) fs.writeFileSync(p(`rapid${i}.md`), `# Rapid ${i}`)
    fs.writeFileSync(p('later.md'), '# Created later')

    app = await launchApp({ port: PORT })
    await sleep(1500)
    // Console errors and uncaught exceptions of the page.
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    const page = targets.find((x) => x.type === 'page' && !x.url.startsWith('devtools'))
    cws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve) => { cws.onopen = resolve })
    cws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.method === 'Runtime.exceptionThrown') issues.push('EXCEPTION ' + JSON.stringify(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text).slice(0, 220))
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') issues.push('console.error ' + d.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 220))
    }
    cws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
    await sleep(300)

    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(dir)}, name: 'edge', agent: 'shell' })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('edge')).click()`)
    await sleep(2500)
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })).json()
    const tool = async (name, args = {}) => { const b = await rpc('tools/call', { name, arguments: args }); return { text: b.result.content[0].text, error: b.result.isError === true } }
    const ev = (x) => app.evaluate(x)
    const state = () => ev(`(() => ({ name: document.querySelector('[data-preview-name]')?.textContent ?? '', loading: !!document.querySelector('[data-preview-loading]') || !!document.querySelector('[data-pdf-loading]'), error: document.querySelector('[data-preview-error]')?.innerText ?? '', kind: document.querySelector('[data-file-view]')?.getAttribute('data-file-view') ?? '', text: (document.querySelector('[data-file-view]')?.innerText ?? '').slice(0, 160), alive: true }))()`)
    // Open one file and wait until it settled: a view or an error, never an endless "Loading".
    const open = async (file, ms = 12000) => {
      await tool('preview_file', { path: file, session: 'edge' })
      const settled = await waitFor(async () => { const st = await state(); return st.name === file && !st.loading && (st.error !== '' || st.kind !== '') ? st : null }, ms, 250)
      return settled ?? { ...(await state()), settled: false }
    }
    const responsive = async () => (await ev('1 + 1')) === 2

    // ---- broken / empty files: a clear message or an empty view, never a hang
    for (const [file, expectError] of [['empty.xlsx', true], ['bad.xlsx', true], ['bad.docx', true], ['bad.png', false], ['bad.pdf', true], ['empty.pdf', true], ['bad.svg', true], ['bomb.xlsx', true], ['bomb.docx', true]]) {
      const st = await open(file)
      t.check(`${file}: ends in a message or view (no endless loading)`, st.settled !== false && (st.error !== '' || st.kind !== ''), JSON.stringify({ error: st.error.slice(0, 80), kind: st.kind }))
      if (expectError) t.check(`${file}: says so clearly`, st.error !== '' && st.error.length < 200, st.error.slice(0, 100))
      t.check(`${file}: the app stays responsive`, await responsive())
    }
    // ---- D75 review fixes
    await open('bomb.xlsx')
    t.check('bomb.xlsx: refused as too large, not an out-of-memory crash', /expands to more than 64 MB/.test((await state()).error), (await state()).error.slice(0, 120))
    await open('bad.docx')
    const docxError = (await state()).error
    t.check('bad.docx: one plain sentence, no library link', /^(Could not read this Word document|Not a valid zip-based file)/.test(docxError) && !/http/.test(docxError), docxError.slice(0, 140))
    await open('bad.png')
    const pngLabel = await waitFor(() => ev(`document.querySelector('[data-image-size]')?.textContent === 'Cannot draw image' || null`), 6000, 250)
    t.check('bad.png: a damaged image says so instead of Loading forever', !!pngLabel && /damaged/.test((await ev(`document.querySelector('[data-file-view]')?.innerText ?? ''`))), await ev(`document.querySelector('[data-image-size]')?.textContent ?? ''`))
    const sparseStart = Date.now()
    const sparse = await open('sparse.xlsx', 40000)
    t.check('sparse.xlsx (30000 rows, cells A and XFD): a view or a clear limit message, never a crash', sparse.settled !== false && (sparse.kind === 'sheet' || /more memory or time|too (large|complex)/.test(sparse.error)), JSON.stringify({ kind: sparse.kind, error: (sparse.error || '').slice(0, 90), ms: Date.now() - sparseStart }))
    t.check('sparse.xlsx: the app is still alive and responsive afterwards', await responsive())
    await open('euro.csv')
    const euro = await ev(`[...document.querySelectorAll('[data-file-table] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()).filter((x, i) => i > 0))`)
    t.check('euro.csv: semicolon file with quoted decimal commas has 2 columns', euro.length >= 2 && euro.every((r) => r.length === 2) && euro.some((r) => r.includes('1,5')), JSON.stringify(euro))

    for (const file of ['empty.md', 'empty.csv']) {
      const st = await open(file)
      t.check(`${file}: an empty file opens without an error`, st.settled !== false && st.error === '', JSON.stringify({ error: st.error, kind: st.kind }))
    }
    // ---- hostile content shown as text
    const bt = await open('binary.txt')
    t.check('binary.txt: shown as text without crashing', bt.settled !== false && (bt.kind === 'text' || bt.error !== ''), JSON.stringify({ kind: bt.kind, error: bt.error.slice(0, 60) }))
    t.check('binary.txt: the app stays responsive', await responsive())
    // ---- huge files are cut, not frozen
    const t0 = Date.now()
    const bg = await open('big.txt', 20000)
    t.check('big.txt (2.5 MB): opens, cut at the cap with a notice', bg.settled !== false && bg.kind === 'text' && (await ev(`!!document.querySelector('[data-file-truncated]')`)), `${Date.now() - t0} ms`)
    const t1 = Date.now()
    const bc = await open('big.csv', 20000)
    t.check('big.csv (300k rows): opens, rows capped with a notice', bc.settled !== false && bc.kind === 'csv' && (await ev(`!!document.querySelector('[data-table-truncated]')`)), `${Date.now() - t1} ms`)
    const rowsShown = await ev(`document.querySelectorAll('[data-file-table] tbody tr').length`)
    t.check('big.csv: never more than one page of rows in the DOM', rowsShown > 0 && rowsShown <= 201, String(rowsShown))
    const wd = await open('wide.csv')
    t.check('wide.csv (500 columns): opens, columns capped with a notice', wd.settled !== false && wd.kind === 'csv' && (await ev(`!!document.querySelector('[data-table-truncated]')`)))
    const ll = await open('one-long-line.txt', 20000)
    t.check('one 3 MB line: opens without freezing', ll.settled !== false && ll.kind === 'text' && (await responsive()))
    // ---- odd file names
    for (const name of ['smile \u{1F600}.md', "quotes 'single' and &amp; amp.md"]) {
      const st = await open(name)
      t.check(`odd name ${JSON.stringify(name)} opens`, st.settled !== false && st.kind === 'markdown', JSON.stringify({ kind: st.kind, error: st.error.slice(0, 60) }))
    }
    // ---- rapid requests: the last one wins, nothing stale overwrites it
    for (let i = 1; i <= 5; i += 1) await tool('preview_file', { path: `rapid${i}.md`, session: 'edge' })
    const lastShown = await waitFor(async () => { const st = await state(); return st.name === 'rapid5.md' && /Rapid 5/.test(st.text) && !st.loading ? st : null }, 10000, 250)
    await sleep(1500)
    const finalState = await state()
    t.check('five quick requests: the LAST file stays on screen', !!lastShown && finalState.name === 'rapid5.md' && /Rapid 5/.test(finalState.text), JSON.stringify({ name: finalState.name, text: finalState.text.slice(0, 30) }))
    // ---- a file that appears after a failed open
    const missing = await open('later.md')
    t.check('later.md exists: opens', missing.kind === 'markdown')
    fs.rmSync(p('later.md'))
    await tool('preview_file', { path: 'later.md', session: 'edge' }).catch(() => undefined)
    // ---- detached window: live reload there too, then closing everything
    await ev(`document.querySelector('[data-preview-detach]')?.click()`)
    const viewerPage = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page' && x.id !== page.id && !x.url.startsWith('devtools')) ?? null, 15000, 400)
    t.check('Detach opens a second window', !!viewerPage)
    // ---- remove the session while its preview is open: no crash, no uncaught error
    await ev(`window.api.removeSession(${JSON.stringify(s.id)})`).catch((e) => issues.push('removeSession rejected ' + String(e).slice(0, 100)))
    await sleep(3000)
    t.check('the app is still responsive after the session was removed', await responsive())
    t.check('the panel does not show a loading state forever after the session was removed', await waitFor(async () => { const st = await state(); return !st.loading ? st : null }, 8000, 300) !== null)
    await sleep(1000)
    t.check('the page logged no uncaught exception or error', issues.length === 0, issues.slice(0, 4).join(' | '))
    if (issues.length > 0) for (const i of issues.slice(0, 12)) console.log('ISSUE', i)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    t.summary()
    try { cws?.close() } catch { /* closed */ }
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* a handle may still be open */ }
  }
}
main()
