// E2E for D75: the side-panel file viewer against REALISTIC files of every kind it claims to show: Markdown with
// a script-injection file, six real image formats, a styled Word document, a workbook with shared strings,
// styles, dates and formulas, European CSVs, a hand-built 2-page PDF and the plain-text kinds. Every check
// states the DESIRED behaviour, so a missing feature fails that check and the rest of the run goes on.
// Files are opened with the Jarvis MCP tool preview_file (like e2e-fileview2.cjs); nothing touches the desktop.
// Run: node scripts/e2e-fileview-types.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const JSZip = require('jszip')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9423
// Well-known tiny 1x1 payloads (checked against a Skia decoder while writing this); the app check also proves
// each one by naturalWidth > 0, so a broken string would fail loudly instead of passing on a guess.
const JPG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const WEBP = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'
const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

// ---- tiny binary fixtures -------------------------------------------------------------------------

let crcTable = null
function crc32(buffer) {
  if (crcTable === null) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** A real 4x4 RGB PNG, built from zlib + crc32 so no PNG base64 has to be trusted. */
function makePng() {
  const width = 4
  const height = 4
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * (width * 3 + 1) + 1 + x * 3
      raw[at] = 220
      raw[at + 1] = 40
      raw[at + 2] = 40
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** 54-byte BITMAPFILEHEADER + BITMAPINFOHEADER + one 24-bit pixel padded to 4 bytes. */
function makeBmp() {
  const bmp = Buffer.alloc(58)
  bmp.write('BM', 0)
  bmp.writeUInt32LE(58, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(1, 18)
  bmp.writeInt32LE(1, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(4, 34)
  bmp[54] = 30
  bmp[55] = 80
  bmp[56] = 220
  return bmp
}

/** 6-byte ICONDIR + 16-byte entry + the PNG payload (the Vista+ ICO form browsers accept). */
function makeIco(png) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 4
  entry[1] = 4
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([head, entry, png])
}

/** A valid 2-page PDF with a Helvetica font, real xref offsets and a trailer: what a PDF reader must accept. */
function makePdf(texts) {
  const n = texts.length
  const fontId = 3 + 2 * n
  const objects = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${texts.map((_text, i) => `${3 + i} 0 R`).join(' ')}] /Count ${n} >>`
  texts.forEach((text, i) => {
    objects[3 + i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${3 + n + i} 0 R >>`
    const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`
    objects[3 + n + i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let body = '%PDF-1.4\n'
  const offsets = []
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, 'latin1')
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xrefAt = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function zipTo(file, parts) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(parts)) zip.file(name, content)
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
}

// ---- Word and Excel fixtures (real packages, not one-paragraph toys) ------------------------------

async function makeDocx(file) {
  const run = (text, props = '') => `<w:r>${props === '' ? '' : `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
  const bullet = (text) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`
  const body = [
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run('Quarterly Report')}</w:p>`,
    `<w:p>${run('This is a ')}${run('bold', '<w:b/>')}${run(' word and an ')}${run('italic', '<w:i/>')}${run(' word in one sentence.')}</w:p>`,
    bullet('First bullet'),
    bullet('Second bullet'),
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>${cell('Region')}${cell('Revenue')}</w:tr><w:tr>${cell('North')}${cell('1200')}</w:tr></w:tbl>`,
    `<w:p>${run('See ')}<w:hyperlink r:id="rId9">${run('our website', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${run(' for the numbers.')}</w:p>`
  ].join('')
  await zipTo(file, {
    '[Content_Types].xml': `${CT}<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
    '_rels/.rels': `${RELS}<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`,
    'word/numbering.xml': `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    'word/_rels/document.xml.rels': `${RELS}<Relationship Id="rId9" Type="${REL}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`
  })
}

const XLSX_WB = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const XLSM_WB = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'

async function makeXlsx(file, workbookType) {
  const c = (ref, attrs, inner) => `<c r="${ref}"${attrs}>${inner}</c>`
  const str = (ref, index, style = '') => c(ref, ` t="s"${style}`, `<v>${index}</v>`)
  const inline = (ref, text) => c(ref, ' t="inlineStr"', `<is><t>${text}</t></is>`)
  const sheet = (rows, extra = '') => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SML}"><sheetData>${rows.join('')}</sheetData>${extra}</worksheet>`
  const data = [
    `<row r="1">${str('A1', 0, ' s="1"')}${str('B1', 1, ' s="1"')}${str('C1', 2, ' s="1"')}</row>`,
    `<row r="2">${str('A2', 3)}${c('B2', '', '<v>10</v>')}${c('C2', ' s="2"', '<v>45366</v>')}</row>`,
    `<row r="3">${str('A3', 4)}${c('B3', '', '<v>20</v>')}${c('C3', '', '<f>SUM(B2:B3)</f><v>30</v>')}</row>`,
    `<row r="4">${str('A4', 5)}${c('B4', ' t="b"', '<v>1</v>')}</row>`,
    `<row r="5">${str('A5', 6)}${inline('C5', 'tail')}</row>`
  ]
  await zipTo(file, {
    '[Content_Types].xml': `${CT}<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${workbookType}"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `${RELS}<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${SML}" xmlns:r="${REL}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/><sheet name="Secrets" sheetId="3" state="hidden" r:id="rId3"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${RELS}<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId5" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${SML}" count="7" uniqueCount="7"><si><t>Product</t></si><si><t>Qty</t></si><si><t>Price</t></si><si><t>Widget</t></si><si><t>Gadget</t></si><si><t>Active</t></si><si><t>Merged note</t></si></sst>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${SML}"><numFmts count="0"/><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': sheet(data, '<mergeCells count="1"><mergeCell ref="A5:B5"/></mergeCells>'),
    'xl/worksheets/sheet2.xml': sheet([`<row r="1">${inline('A1', 'Notes')}</row>`, `<row r="2">${inline('A2', 'Second sheet')}</row>`]),
    'xl/worksheets/sheet3.xml': sheet([`<row r="1">${inline('A1', 'Hidden data')}</row>`])
  })
}

async function makeFixtures(dir) {
  const p = (name) => path.join(dir, name)
  const png = makePng()
  fs.writeFileSync(p('pic.png'), png)
  fs.writeFileSync(p('readme.md'), [
    '# Realistic Readme', '',
    'A paragraph with **bold** text, `inline code` and a [link](https://example.com).', '',
    '- first bullet', '- second bullet', '', '- [x] done', '- [ ] not done', '',
    '```js', 'const answer = 42', '```', '',
    '| Name | Value |', '| --- | --- |', '| alpha | 1 |', '| beta | 2 |', '',
    '![pic](./pic.png)', '',
    '![remote](https://example.com/remote.png)', '',
    '![gone](./nope.png)', '',
    '[guide](./docs/guide.md)', ''
  ].join('\n'))
  fs.mkdirSync(p('docs'), { recursive: true })
  fs.writeFileSync(p('docs/guide.md'), '# Guide Page' + '\n\n' + 'Reached through a relative link.' + '\n')
  fs.copyFileSync(p('readme.md'), p('other.markdown'))
  fs.writeFileSync(p('evil.md'), '# Evil\n\n<script>window.__pwned=1</script>\n<img src=x onerror="window.__pwned=2">\n\n[x](javascript:window.__pwned=3)\n')
  fs.writeFileSync(p('a.png'), png)
  fs.writeFileSync(p('a.jpg'), Buffer.from(JPG, 'base64'))
  fs.copyFileSync(p('a.jpg'), p('a.jpeg'))
  fs.writeFileSync(p('a.gif'), Buffer.from(GIF, 'base64'))
  fs.writeFileSync(p('a.webp'), Buffer.from(WEBP, 'base64'))
  fs.writeFileSync(p('a.bmp'), makeBmp())
  fs.writeFileSync(p('icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#dd2222"/><script>window.__pwned_svg=1</script></svg>')
  fs.writeFileSync(p('favicon.ico'), makeIco(png))
  await makeDocx(p('report.docx'))
  for (const ext of ['docm', 'dotx']) fs.copyFileSync(p('report.docx'), p(`report.${ext}`))
  await makeXlsx(p('book.xlsx'), XLSX_WB)
  await makeXlsx(p('macro.xlsm'), XLSM_WB)
  fs.writeFileSync(p('old.xls'), Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 0)]))
  fs.writeFileSync(p('comma.csv'), 'name,note,score\r\nalpha,"Paris, FR",10\r\nbeta,"line one\r\nline two",20\r\n')
  fs.writeFileSync(p('semi.csv'), 'name;price;note\r\napple;1,5;red\r\npear;2,25;green\r\n')
  fs.writeFileSync(p('pipe.csv'), 'name|kind|size\r\nalpha|fruit|3\r\nbeta|root|9\r\n')
  fs.writeFileSync(p('bom.csv'), '\ufeffname,city\r\nZoë,Zürich\r\n')
  fs.writeFileSync(p('ansi.csv'), Buffer.concat([Buffer.from('name,note\r\ncaf'), Buffer.from([0xe9]), Buffer.from(',tr\xe8s bien\r\n')]))
  fs.writeFileSync(p('data.tsv'), 'name\tscore\tnote\r\nalpha\t10\ttabbed\r\nbeta\t20\tplain\r\n')

  fs.writeFileSync(p('doc.pdf'), makePdf(['Hello PDF page one', 'Hello PDF page two']))
  fs.writeFileSync(p('broken.pdf'), 'This is a plain text file that was renamed to .pdf.\n')
  fs.writeFileSync(p('notes.txt'), 'A plain text file.\nmarker: plain text here\n')
  fs.writeFileSync(p('data.json'), '{\n  "marker": "json value",\n  "items": [1, 2, 3]\n}\n')
  fs.writeFileSync(p('conf.yaml'), 'name: config\nmarker: yaml value\nlist:\n  - one\n')
  fs.writeFileSync(p('run.log'), '[info] started\nlog marker: all good\n')
  fs.writeFileSync(p('program.exe'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(126, 0)]))
  const zip = new JSZip()
  zip.file('readme.txt', 'inside the archive')
  fs.writeFileSync(p('archive.zip'), await zip.generateAsync({ type: 'nodebuffer' }))
}

// ---- the run --------------------------------------------------------------------------------------

async function main() {
  const t = makeChecker()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-fileview-types-'))
  const p = (name) => path.join(dir, name)
  const SESSION = 'types probe'
  let app
  try {
    await makeFixtures(dir)
    app = await launchApp({ port: PORT })
    await sleep(1500)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(dir)}, name: ${JSON.stringify(SESSION)}, agent: 'shell' })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes(${JSON.stringify(SESSION)})).click()`)
    await sleep(2500)

    const cfg = await waitFor(() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
      } catch {
        return null
      }
    }, 15000, 300)
    if (!cfg) throw new Error('the Jarvis MCP endpoint was never written')
    let rpcId = 0
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: (rpcId += 1), method, params }) })).json()
    const tool = async (name, args = {}) => {
      const body = await rpc('tools/call', { name, arguments: args })
      const result = body.result ?? {}
      return { text: result.content?.[0]?.text ?? JSON.stringify(body), error: result.isError === true }
    }
    const ev = (code) => app.evaluate(code)
    const info = (text) => console.log(`INFO  ${text}`)
    const read = () => ev(`(() => {
      const root = document.querySelector('[data-file-view]')
      const img = root ? root.querySelector('[data-testid="file-view-image"] img') : null
      return { present: !!root, kind: root?.getAttribute('data-file-view') || '', text: root?.innerText ?? '',
        name: document.querySelector('[data-preview-name]')?.textContent ?? '',
        img: img ? { complete: img.complete, width: img.naturalWidth } : null,
        tabs: [...document.querySelectorAll('[data-sheet-tab]')].map((n) => n.innerText.trim()),
        scripts: root?.querySelectorAll('script').length ?? 0, onerror: root?.querySelectorAll('[onerror]').length ?? 0,
        error: document.querySelector('[data-preview-error]')?.innerText ?? '' }
    })()`)
    const count = (selector) => ev(`document.querySelectorAll('[data-file-view] ${selector}').length`)
    const shot = async (file) => {
      const result = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(path.join(__dirname, 'visual'), { recursive: true })
      fs.writeFileSync(path.join(__dirname, 'visual', `types-${file.replace(/[^a-z0-9]+/gi, '-')}.png`), Buffer.from(result.result.data, 'base64'))
    }
    const openFile = async (file) => {
      const result = await tool('preview_file', { path: p(file), session: SESSION })
      await waitFor(async () => {
        const view = await read()
        const loading = await ev(`!!document.querySelector('[data-preview-loading]')`)
        return view.name === file && view.present && !loading ? view : null
      }, 8000, 200)
      await sleep(250)
      return result
    }
    const tableOf = () => ev(`(() => {
      const table = document.querySelector('[data-file-view] [data-file-table]')
      if (table === null) return null
      const first = table.querySelector('tbody tr')
      return { cols: Math.max(0, (first ? first.querySelectorAll('td').length : 0) - 1), text: table.innerText }
    })()`)
    const cell = (row, col) => ev(`(() => {
      const rows = document.querySelectorAll('[data-file-view] [data-file-table] tbody tr')
      const td = rows[${row}] ? rows[${row}].querySelectorAll('td')[${col + 1}] : null
      return td ? td.innerText.trim() : ''
    })()`)
    const section = async (title, type, run) => {
      console.log(`--- ${title} ---`)
      try { await run() } catch (error) { t.check(`${type}: section completed`, false, String((error && error.message) || error)) }
    }

    await section('Markdown', 'markdown', async () => {
      const r = await openFile('readme.md')
      await shot('readme.md')
      const view = await read()
      t.check('md: renders its h1', !r.error && view.kind === 'markdown' && (await count('h1')) >= 1, `kind=${view.kind} h1=${await count('h1')}`)
      t.check('md: renders its bullet list', (await count('li')) >= 4, String(await count('li')))
      t.check('md: renders the task list as list items', (await ev(`[...document.querySelectorAll('[data-file-view] li')].some((n) => /\\bdone\\b/.test(n.innerText))`)) === true)
      t.check('md: renders the fenced code block', (await count('pre code')) >= 1, String(await count('pre code')))
      t.check('md: renders the pipe table', (await count('table')) >= 1, String(await count('table')))
      t.check('md: bold is strong and inline code is code', (await count('strong')) >= 1 && (await count('p code')) >= 1)
      t.check('md: the link is an anchor to example.com', (await ev(`[...document.querySelectorAll('[data-file-view] a')].some((a) => /example\\.com/.test(a.getAttribute('href') || ''))`)) === true)
      // D75: relative images are loaded through main (data URLs); remote images stay blocked; a missing one is marked.
      const imgState = () => ev(`(() => { const by = (name) => [...document.querySelectorAll('[data-file-view] img')].find((i) => (i.getAttribute('alt') || '') === name); const d = (i) => i ? { src: (i.getAttribute('src') || '').slice(0, 24), width: i.naturalWidth, title: i.getAttribute('title') || '', cls: i.className } : null; return { pic: d(by('pic')), remote: d(by('remote')), gone: d(by('gone')) } })()`)
      const loaded = await waitFor(async () => { const st = await imgState(); return st.pic && st.pic.width > 0 && st.pic.src.startsWith('data:') ? st : null }, 8000, 250)
      t.check('md: a relative image next to the file is shown', !!loaded, JSON.stringify(await imgState()))
      const st2 = await imgState()
      t.check('md: a remote http image stays blocked (src untouched)', !!st2.remote && st2.remote.src.startsWith('https://') && st2.remote.width === 0, JSON.stringify(st2.remote))
      t.check('md: a missing relative image is marked as missing', !!st2.gone && /nope/.test(st2.gone.title) && /dashed/.test(st2.gone.cls), JSON.stringify(st2.gone))
      await ev(`[...document.querySelectorAll('[data-file-view] a')].find((a) => /guide/.test(a.getAttribute('href') || ''))?.click()`)
      const followed = await waitFor(async () => (await ev(`document.querySelector('[data-preview-name]')?.textContent ?? ''`)) === 'guide.md' && /Reached through a relative link/.test(await ev(`document.querySelector('[data-file-view]')?.innerText ?? ''`)), 8000, 250)
      t.check('md: a relative link to another .md opens it in the viewer', !!followed, await ev(`document.querySelector('[data-preview-name]')?.textContent ?? ''`))
      await openFile('readme.md')

      const copy = await openFile('other.markdown')
      await shot('other.markdown')
      const other = await read()
      t.check('md: a .markdown file renders too', !copy.error && other.name === 'other.markdown' && other.kind === 'markdown' && (await count('h1')) >= 1, `kind=${other.kind}`)

      await openFile('evil.md')
      await shot('evil.md')
      const evil = await read()
      t.check('md: injected scripts never run', typeof (await ev('window.__pwned')) === 'undefined', String(await ev('window.__pwned')))
      t.check('md: the pane has no script element', evil.scripts === 0, String(evil.scripts))
      t.check('md: the pane has no onerror attribute', evil.onerror === 0, String(evil.onerror))
    })
    await section('Images', 'images', async () => {
      for (const file of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp']) {
        const r = await openFile(file)
        await shot(file)
        const view = await read()
        const ok = !r.error && view.name === file && view.kind === 'image' && view.img !== null && view.img.complete && view.img.width > 0
        t.check(`images: ${file} loads as an image`, ok, `${r.error ? r.text.slice(0, 60) : ''} kind=${view.kind} img=${JSON.stringify(view.img)}`)
      }
      const svg = await openFile('icon.svg')
      await shot('icon.svg')
      const svgView = await read()
      t.check('images: an svg shows as a picture', !svg.error && svgView.name === 'icon.svg' && svgView.kind === 'image' && svgView.img !== null && svgView.img.width > 0, `${svg.error ? svg.text.slice(0, 70) : ''} kind=${svgView.kind}`)
      t.check('images: an svg script never runs', typeof (await ev('window.__pwned_svg')) === 'undefined', String(await ev('window.__pwned_svg')))
      const ico = await openFile('favicon.ico')
      await shot('favicon.ico')
      const icoView = await read()
      t.check('images: an ico shows as a picture', !ico.error && icoView.name === 'favicon.ico' && icoView.kind === 'image' && icoView.img !== null && icoView.img.width > 0, `${ico.error ? ico.text.slice(0, 70) : ''} kind=${icoView.kind}`)
    })
    await section('Word', 'word', async () => {
      const r = await openFile('report.docx')
      await shot('report.docx')
      const view = await read()
      t.check('word: the heading style is an h1', !r.error && view.kind === 'docx' && (await count('h1')) >= 1, `kind=${view.kind} h1=${await count('h1')}`)
      t.check('word: bold and italic runs keep their emphasis', (await count('strong')) + (await count('b')) >= 1 && (await count('em')) + (await count('i')) >= 1)
      t.check('word: the numbered paragraphs are a two-item list', (await count('ul > li')) >= 2, String(await count('ul > li')))
      t.check('word: the table keeps its four cells', (await count('table td')) >= 4, String(await count('table td')))
      t.check('word: the hyperlink keeps its text', (await ev(`[...document.querySelectorAll('[data-file-view] a')].some((a) => /our website/i.test(a.textContent || ''))`)) === true)
      t.check('word: no image is rendered', (await count('img')) === 0, String(await count('img')))
      for (const file of ['report.docm', 'report.dotx']) {
        const copy = await tool('preview_file', { path: p(file), session: SESSION })
        info(`${file}: ${copy.error ? `refused (${copy.text.slice(0, 70)})` : 'opened by the viewer'}`)
      }
    })
    await section('Excel', 'excel', async () => {
      const r = await openFile('book.xlsx')
      await shot('book.xlsx')
      const view = await read()
      t.check('xlsx: shared strings show as text', !r.error && view.kind === 'sheet' && (await cell(0, 0)) === 'Product', `kind=${view.kind} A1=${await cell(0, 0)}`)
      t.check('xlsx: the numeric cell keeps its number', (await cell(1, 1)) === '10', await cell(1, 1))
      t.check('xlsx: the date cell shows an ISO date, not the serial', /^2024-03-15/.test(await cell(1, 2)), await cell(1, 2))
      t.check('xlsx: the formula cell shows its cached value', (await cell(2, 2)) === '30', await cell(2, 2))
      t.check('xlsx: the boolean cell reads true', /^(true|TRUE)$/.test(await cell(3, 1)), await cell(3, 1))
      t.check('xlsx: there are two or three sheet tabs', view.tabs.length === 2 || view.tabs.length === 3, JSON.stringify(view.tabs))
      info(`sheet tabs: ${JSON.stringify(view.tabs)}`)
      const macro = await openFile('macro.xlsm')
      await shot('macro.xlsm')
      const macroView = await read()
      t.check('xlsx: the macro-enabled .xlsm opens like the xlsx', !macro.error && macroView.name === 'macro.xlsm' && macroView.kind === 'sheet' && (await cell(0, 0)) === 'Product', `${macro.error ? macro.text.slice(0, 60) : ''} kind=${macroView.kind}`)

      const legacy = await tool('preview_file', { path: p('old.xls'), session: SESSION })
      info(`old.xls: ${legacy.text.slice(0, 120)}`)
      t.check('xls: the legacy format is refused with a clear message', legacy.error && legacy.text.length > 10, legacy.text.slice(0, 100))
      t.check('xls: the viewer is still alive after the refusal', (await ev(`typeof window.api.getStore === 'function'`)) === true)
    })
    await section('CSV and TSV', 'csv', async () => {
      const load = async (file) => {
        const r = await openFile(file)
        await shot(file)
        return { r, view: await read(), table: await tableOf() }
      }
      const comma = await load('comma.csv')
      t.check('csv: a quoted comma stays inside one cell', !comma.r.error && comma.table !== null && comma.table.cols === 3 && /Paris, FR/.test(comma.table.text), `cols=${comma.table ? comma.table.cols : 0}`)
      t.check('csv: a quoted newline stays inside one cell', comma.table !== null && /line one[\s\S]*line two/.test(comma.table.text), comma.table ? comma.table.text.replace(/\s+/g, ' ').slice(0, 60) : 'no table')
      for (const [file, expected, marker] of [['semi.csv', 3, /apple/], ['pipe.csv', 3, /alpha/], ['bom.csv', 2, /Zoë/], ['ansi.csv', 2, /café/], ['data.tsv', 3, /tabbed/]]) {
        const got = await load(file)
        const cols = got.table ? got.table.cols : 0
        t.check(`csv: ${file} shows ${expected} columns and keeps its text`, !got.r.error && got.view.kind === 'csv' && cols === expected && got.table !== null && marker.test(got.table.text), `cols=${cols}`)
      }
    })
    await section('PDF', 'pdf', async () => {
      const r = await openFile('doc.pdf')
      await shot('doc.pdf')
      const view = await read()
      t.check('pdf: the pane reports the pdf kind', !r.error && view.kind === 'pdf', `kind=${view.kind} ${r.error ? r.text.slice(0, 60) : ''}`)
      const indicator = await waitFor(async () => {
        const text = (await read()).text
        const match = /(\d+)\s*\/\s*(\d+)/.exec(text)
        return match ? match[0] : null
      }, 10000, 500)
      t.check('pdf: a 1 / 2 page indicator appears within 10 s', indicator !== null && /^1\s*\/\s*2$/.test(indicator), String(indicator))
      const painted = await waitFor(() => ev(`(() => {
        const canvas = document.querySelector('[data-file-view] canvas')
        if (canvas === null || canvas.width === 0) return null
        const sample = document.createElement('canvas')
        sample.width = Math.min(300, canvas.width)
        sample.height = Math.min(200, canvas.height)
        const ctx = sample.getContext('2d')
        ctx.drawImage(canvas, 0, 0, sample.width, sample.height)
        const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data
        let ink = 0
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 200 || pixels[i + 1] < 200 || pixels[i + 2] < 200) ink += 1
        return ink > 20 ? { ink, width: canvas.width, height: canvas.height } : null
      })()`), 10000, 500)
      t.check('pdf: a canvas draws the page (not all white)', painted !== null, JSON.stringify(painted))

      const broken = await tool('preview_file', { path: p('broken.pdf'), session: SESSION })
      const paneError = await waitFor(async () => (await read()).error || null, 8000, 300)
      t.check('pdf: a fake .pdf shows an error (tool or pane)', broken.error || paneError !== null, `${broken.text.slice(0, 70)} | ${String(paneError ?? '')}`)
      t.check('pdf: the app still answers after the fake pdf', (await ev(`typeof window.api.getStore === 'function'`)) === true)
    })
    await section('Plain text', 'text', async () => {
      for (const [file, marker] of [['notes.txt', 'plain text here'], ['data.json', 'json value'], ['conf.yaml', 'yaml value'], ['run.log', 'log marker']]) {
        const r = await openFile(file)
        await shot(file)
        const view = await read()
        t.check(`text: ${file} opens as text with its marker`, !r.error && view.name === file && view.kind === 'text' && view.text.includes(marker), `kind=${view.kind} ${view.text.replace(/\s+/g, ' ').slice(0, 50)}`)
      }
    })
    await section('Unsupported', 'unsupported', async () => {
      for (const file of ['program.exe', 'archive.zip']) {
        const r = await tool('preview_file', { path: p(file), session: SESSION })
        t.check(`unsupported: ${file} is refused and the message lists the supported kinds`, r.error && /Supported:/i.test(r.text) && /Markdown/.test(r.text) && /PDF/.test(r.text), r.text.slice(0, 120))
      }
    })
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* a locked temp folder stays behind; it is under %TEMP% */
    }
  }
}

main()
