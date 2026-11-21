// E2E for D75: a PDF over 30 MB is not loaded whole: main says `streamed`, pdf.js reads byte ranges, the first page
// draws, and a page far down the file loads when it is scrolled to. A 60 MB, 12-page PDF is made at run time (the bulk
// is one unreferenced stream object, so pdf.js has to find the page tree through the xref at the END of the file).
// Run: node scripts/e2e-fileview-bigpdf.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9425
const PAGES = 12
const BULK = 60 * 1024 * 1024

function makeBigPdf(file) {
  const parts = []
  let offset = 0
  const offsets = []
  const push = (buf) => { parts.push(buf); offset += buf.length }
  const obj = (n, body) => { offsets[n] = offset; push(Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, 'latin1')) }
  push(Buffer.from('%PDF-1.4\n', 'latin1'))
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  const kids = Array.from({ length: PAGES }, (_, i) => `${4 + i * 2} 0 R`).join(' ')
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${PAGES} >>`)
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let i = 0; i < PAGES; i += 1) {
    const stream = `BT /F1 32 Tf 20 100 Td (Big PDF page ${i + 1}) Tj ET`
    obj(4 + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    obj(5 + i * 2, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  const bulkNumber = 4 + PAGES * 2
  offsets[bulkNumber] = offset
  push(Buffer.from(`${bulkNumber} 0 obj\n<< /Length ${BULK} >>\nstream\n`, 'latin1'))
  push(Buffer.alloc(BULK, 0x41))
  push(Buffer.from('\nendstream\nendobj\n', 'latin1'))
  const xref = offset
  const count = bulkNumber + 1
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n += 1) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(Buffer.from(`${table}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'))
  fs.writeFileSync(file, Buffer.concat(parts))
}

async function main() {
  const t = makeChecker()
  let app
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-bigpdf-'))
  const pdf = path.join(dir, 'Big Book.pdf')
  try {
    makeBigPdf(pdf)
    const size = fs.statSync(pdf).size
    t.check('the test PDF is over 30 MB', size > 30 * 1024 * 1024, `${Math.round(size / 1048576)} MB`)

    app = await launchApp({ port: PORT })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(dir)}, name: 'big pdf', agent: 'shell' })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('big pdf')).click()`)
    await sleep(2500)

    // ---- main: streamed, no bytes
    const view = await app.evaluate(`window.api.readFileView(${JSON.stringify(s.id)}, ${JSON.stringify(pdf)})`)
    t.check('main answers streamed with no bytes inside', view.ok && view.view.streamed === true && view.view.base64 === '' && view.view.size === size, JSON.stringify({ ok: view.ok, streamed: view.view?.streamed, b64: (view.view?.base64 || '').length }))
    const range = await app.evaluate(`window.api.readFileViewRange(${JSON.stringify(s.id)}, ${JSON.stringify(pdf)}, 0, 8)`)
    t.check('a byte range comes back (the PDF header)', range.ok && Buffer.from(range.base64, 'base64').toString('latin1').startsWith('%PDF-1.4'), JSON.stringify(range).slice(0, 80))
    const tooBig = await app.evaluate(`window.api.readFileViewRange(${JSON.stringify(s.id)}, ${JSON.stringify(pdf)}, 0, ${9 * 1024 * 1024})`)
    t.check('a range over 8 MB is refused', tooBig.ok === false, JSON.stringify(tooBig).slice(0, 80))
    const notPdf = await app.evaluate(`window.api.readFileViewRange(${JSON.stringify(s.id)}, 'C:\\\\Windows\\\\win.ini', 0, 10)`)
    t.check('a range of a file that is not a PDF is refused', notPdf.ok === false, JSON.stringify(notPdf).slice(0, 80))

    // ---- the viewer
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()
    const started = Date.now()
    await rpc('tools/call', { name: 'preview_file', arguments: { path: 'Big Book.pdf', session: 'big pdf' } })
    const drawn = await waitFor(() => app.evaluate(`document.querySelectorAll('[data-file-view="pdf"] canvas').length > 0 || null`), 30000, 300)
    const ms = Date.now() - started
    t.check('the first page of a 60 MB PDF draws', !!drawn, `${ms} ms`)
    t.check('it says the file is large and pages load on demand', await app.evaluate(`/Large file/.test(document.querySelector('[data-pdf-streamed]')?.innerText ?? '')`), await app.evaluate(`document.querySelector('[data-pdf-streamed]')?.innerText ?? 'no note'`))
    t.check('the page count is right (1 / 12)', await app.evaluate(`/1\\s*\\/\\s*12/.test(document.querySelector('[data-pdf-page-label]')?.innerText ?? '')`), await app.evaluate(`document.querySelector('[data-pdf-page-label]')?.innerText ?? ''`))
    const ink = () => app.evaluate(`(() => { const c = document.querySelector('[data-file-view="pdf"] canvas'); if (!c) return -1; const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 100) dark += 1; return dark })()`)
    t.check('the first page really has ink (not a blank canvas)', (await ink()) > 20, String(await ink()))

    // ---- scroll to the last page: it loads on demand
    const lastLoaded = await (async () => {
      await app.evaluate(`document.querySelector('[data-testid="file-view-pdf"]').scrollTop = 1e9`)
      return waitFor(() => app.evaluate(`(() => { const label = document.querySelector('[data-pdf-page-label]')?.innerText ?? ''; return /12\\s*\\/\\s*12/.test(label) || null })()`), 15000, 300)
    })()
    t.check('scrolling to the end shows page 12 / 12', !!lastLoaded, await app.evaluate(`document.querySelector('[data-pdf-page-label]')?.innerText ?? ''`))
    await sleep(2500)
    const pagesDrawn = await app.evaluate(`document.querySelectorAll('[data-file-view="pdf"] canvas').length`)
    t.check('the last page is drawn and far pages are not all kept', pagesDrawn >= 1 && pagesDrawn < 12, `canvases=${pagesDrawn}`)
    const shot = await app.send('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(path.join(__dirname, 'visual'), { recursive: true })
    fs.writeFileSync(path.join(__dirname, 'visual', 'fileview-bigpdf.png'), Buffer.from(shot.result.data, 'base64'))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* the file may still be held for a moment */ }
  }
}
main()
