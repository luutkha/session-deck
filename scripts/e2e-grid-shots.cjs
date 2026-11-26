// Grid screenshot regression (D89): launch the built app like e2e-grid.cjs, fill a 2x2 grid with FOUR SHELL
// sessions, mask volatile terminal text / clocks, and compare clipped Page.captureScreenshot PNGs against
// scripts/baselines/grid-*.png. No pngjs dependency: PNG scanlines are inflated with node:zlib and unfiltered here.
//
// Run: node scripts/e2e-grid-shots.cjs
//   UPDATE_BASELINES=1 node scripts/e2e-grid-shots.cjs   (writes the three baselines, then exits)
//   node scripts/e2e-grid-shots.cjs --self-test          (pure codec/compare unit tests, no app, no CDP)
// With no baselines and no UPDATE_BASELINES, every shot prints SKIP and the run exits 0 (nothing to compare yet).
// On failure the actual image and a red-highlight diff land in scripts/baselines/actual/.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const ROOT = path.resolve(__dirname, '..')
const BASE_DIR = path.join(__dirname, 'baselines')
const ACTUAL_DIR = path.join(BASE_DIR, 'actual')
const PORT = 9521 // dedicated: no other e2e suite uses this port
const WIDE = { width: 1400, height: 900 }
const NARROW = { width: 900, height: 900 }
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
/** A shot fails when more than 0.5% of pixels have a >8 difference on any RGB channel. */
const TOLERANCE = { maxFraction: 0.005, perChannel: 8 }
const SHOTS = [
  { name: 'grid-default', width: WIDE.width, height: WIDE.height },
  { name: 'grid-focused', width: WIDE.width, height: WIDE.height },
  { name: 'grid-narrow', width: NARROW.width, height: NARROW.height }
]

/** Terminal glyphs are drawn into canvas/WebGL and clocks are plain text: hide them, keep their layout box. */
const MASK_CSS = `
[data-testid="grid-view"] .xterm,
[data-testid="grid-view"] .xterm-screen,
[data-testid="grid-view"] .xterm-rows,
[data-testid="grid-view"] canvas,
[data-testid="grid-view"] [data-time],
[data-testid="grid-view"] [data-clock],
[data-testid="grid-view"] [data-timestamp],
[data-testid="grid-view"] [data-relative-time],
[data-testid="grid-view"] .relative-time,
[data-testid="grid-view"] time { visibility: hidden !important; }
[data-testid="grid-view"] *,
[data-testid="grid-view"] *::before,
[data-testid="grid-view"] *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
[data-testid="grid-view"] .terminal-pane__viewport { background: #000 !important; }
`

// ---- dependency-free PNG ----------------------------------------------------------------------------

let crcTable = null
function getCrcTable() {
  if (crcTable === null) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      crcTable[n] = c >>> 0
    }
  }
  return crcTable
}

function crc32(buffer) {
  const table = getCrcTable()
  let c = 0xffffffff
  for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Decode 8-bit non-interlaced RGB/RGBA PNG into { width, height, data: RGBA Buffer }. */
function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG file')
  let offset = 8
  let header = null
  const idat = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (offset + 12 + length > buffer.length) throw new Error('truncated PNG chunk: ' + type)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const storedCrc = buffer.readUInt32BE(offset + 8 + length)
    if (crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) !== storedCrc) throw new Error('bad PNG CRC: ' + type)
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('bad IHDR length')
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (header === null || idat.length === 0) throw new Error('PNG has no IHDR/IDAT')
  if (header.depth !== 8 || (header.color !== 2 && header.color !== 6) || header.interlace !== 0) throw new Error('unsupported PNG format (need 8-bit RGB/RGBA, non-interlaced)')
  const { width, height } = header
  const channels = header.color === 6 ? 4 : 3
  const stride = width * channels
  const raw = zlib.inflateSync(Buffer.concat(idat))
  if (raw.length !== (stride + 1) * height) throw new Error('unexpected PNG scanline size')
  const rgba = Buffer.alloc(width * height * 4)
  const row = Buffer.alloc(stride)
  const previous = Buffer.alloc(stride)
  let at = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[at++]
    if (filter > 4) throw new Error('unknown PNG filter: ' + String(filter))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0
      const b = previous[x]
      const c = x >= channels ? previous[x - channels] : 0
      let value = raw[at + x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) value += paeth(a, b, c)
      row[x] = value & 0xff
    }
    for (let x = 0; x < width; x++) {
      const source = x * channels
      const target = (y * width + x) * 4
      rgba[target] = row[source]
      rgba[target + 1] = row[source + 1]
      rgba[target + 2] = row[source + 2]
      rgba[target + 3] = channels === 4 ? row[source + 3] : 255
    }
    row.copy(previous)
    at += stride
  }
  return { width, height, data: rgba }
}

/** Encode RGBA back to an 8-bit RGBA PNG (filter 0), used only for the failure artefacts. */
function encodePng(width, height, rgba) {
  const stride = width * 4
  if (rgba.length !== stride * height) throw new Error('RGBA buffer size does not match dimensions')
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

// ---- pixel comparison -------------------------------------------------------------------------------

function comparePng(actual, expected, options = {}) {
  const maxFraction = options.maxFraction ?? TOLERANCE.maxFraction
  const perChannel = options.perChannel ?? TOLERANCE.perChannel
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return { pass: false, reason: 'size', differing: 0, total: actual.width * actual.height, fraction: 1, worst: 0, actualSize: [actual.width, actual.height], expectedSize: [expected.width, expected.height] }
  }
  const total = actual.width * actual.height
  let differing = 0
  let worst = 0
  for (let i = 0; i < total; i++) {
    const at = i * 4
    let changed = false
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(actual.data[at + channel] - expected.data[at + channel])
      if (delta > worst) worst = delta
      if (delta > perChannel) changed = true
    }
    if (changed) differing++
  }
  const fraction = differing / total
  return { pass: fraction <= maxFraction, reason: 'pixels', differing, total, fraction, worst }
}

/** Show exactly which pixels broke the tolerance (red); keep the rest as a dim greyscale hint. */
function makeDiffPng(actual, expected) {
  if (actual.width !== expected.width || actual.height !== expected.height) return encodePng(actual.width, actual.height, actual.data)
  const out = Buffer.alloc(actual.data.length)
  for (let i = 0; i < actual.width * actual.height; i++) {
    const at = i * 4
    const changed = [0, 1, 2].some((channel) => Math.abs(actual.data[at + channel] - expected.data[at + channel]) > TOLERANCE.perChannel)
    if (changed) {
      out[at] = 255
      out[at + 1] = 0
      out[at + 2] = 0
    } else {
      const grey = Math.round((actual.data[at] + actual.data[at + 1] + actual.data[at + 2]) / 6)
      out[at] = grey
      out[at + 1] = grey
      out[at + 2] = grey
    }
    out[at + 3] = 255
  }
  return encodePng(actual.width, actual.height, out)
}

// ---- app driving ------------------------------------------------------------------------------------

const gridBox = (app) => app.evaluate(`(() => {
  const node = document.querySelector('[data-testid="grid-view"]')
  if (!node) return null
  const r = node.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
})()`)

async function waitForSettledGrid(app) {
  let previous = null
  let stable = 0
  for (let attempt = 0; attempt < 20; attempt++) {
    const box = await gridBox(app)
    if (box && box.width > 0 && box.height > 0) {
      stable = previous !== null && JSON.stringify(box) === JSON.stringify(previous) ? stable + 1 : 1
      if (stable >= 3) return box
      previous = box
    } else {
      stable = 0
      previous = null
    }
    await sleep(200)
  }
  throw new Error('the grid bounding box never settled')
}

async function captureShot(app, box) {
  const response = await app.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }
  })
  if (!response.result || typeof response.result.data !== 'string') throw new Error('Page.captureScreenshot returned no PNG data')
  return Buffer.from(response.result.data, 'base64')
}

function writeFailure(name, png, expected) {
  fs.mkdirSync(ACTUAL_DIR, { recursive: true })
  fs.writeFileSync(path.join(ACTUAL_DIR, name + '.actual.png'), png)
  if (expected !== null) fs.writeFileSync(path.join(ACTUAL_DIR, name + '.diff.png'), makeDiffPng(decodePng(png), expected))
}

async function compareShot(app, t, name, box) {
  const png = await captureShot(app, box)
  const baselinePath = path.join(BASE_DIR, name + '.png')
  if (process.env.UPDATE_BASELINES === '1') {
    fs.mkdirSync(BASE_DIR, { recursive: true })
    fs.writeFileSync(baselinePath, png)
    console.log(`WROTE  ${path.relative(ROOT, baselinePath)} (${String(png.length)} bytes)`)
    return
  }
  if (!fs.existsSync(baselinePath)) {
    console.log(`SKIP no baseline: ${name}`)
    return
  }
  try {
    const actual = decodePng(png)
    const expected = decodePng(fs.readFileSync(baselinePath))
    const result = comparePng(actual, expected)
    const detail = result.reason === 'size'
      ? `image sizes ${JSON.stringify(result.actualSize)} vs ${JSON.stringify(result.expectedSize)}`
      : `${String(result.differing)}/${String(result.total)} pixels over ${String(TOLERANCE.perChannel)} (${(result.fraction * 100).toFixed(3)}%, worst ${String(result.worst)})`
    t.check(name, result.pass, detail)
    if (!result.pass) writeFailure(name, png, expected)
  } catch (error) {
    t.check(name, false, String(error && error.message || error))
    writeFailure(name, png, null)
  }
}

async function main() {
  const update = process.env.UPDATE_BASELINES === '1'
  const missing = SHOTS.filter((shot) => !fs.existsSync(path.join(BASE_DIR, shot.name + '.png'))).map((shot) => shot.name)
  if (!update && missing.length === SHOTS.length) {
    console.log('SKIP no baseline: ' + missing.join(', '))
    console.log('Generate them with UPDATE_BASELINES=1 node scripts/e2e-grid-shots.cjs on a machine that can launch the built app.')
    return
  }
  const t = makeChecker()
  let app = null
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-grid-shots-'))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  try {
    app = await launchApp({ port: PORT, userData })
    const js = (value) => JSON.stringify(value)
    const ev = (expression) => app.evaluate(expression)
    const click = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return false; n.click(); return true })()`)
    // Radix menus need pointer events, not just a synthetic .click() (same as e2e-grid.cjs).
    const pointerClick = (selector) => ev(`(() => {
      const n = document.querySelector(${js(selector)})
      if (!n) return false
      const r = n.getBoundingClientRect()
      const fire = (type) => n.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: r.x + 2, clientY: r.y + 2, isPrimary: true }))
      fire('pointerdown')
      fire('pointerup')
      return true
    })()`)

    await app.send('Emulation.setDeviceMetricsOverride', { width: WIDE.width, height: WIDE.height, deviceScaleFactor: 1, mobile: false })
    await sleep(800)

    // Four shell sessions only: no external agent, no worktree, no real user config.
    for (let i = 1; i <= 4; i++) {
      await ev(`window.api.createSession({ cwd: ${js(root)}, name: ${js('shot-' + String(i))}, agent: 'shell' })`)
    }
    await sleep(1200)
    await ev(`(() => { const n = [...document.querySelectorAll('[role="treeitem"]')].find((x) => x.innerText.includes('shot-1')); if (n) n.click(); return !!n })()`)
    await sleep(300)

    await pointerClick('[aria-label="Grid view"]')
    await sleep(300)
    await click('[data-grid-preset="2x2"]')
    await waitFor(() => ev(`document.querySelector('[data-testid="grid-view"]')?.getAttribute('data-grid-preset') === '2x2'`), 6000, 200)
    const pickCell = async (index, name) => {
      await waitFor(async () => {
        const shown = await ev(`document.querySelector('[data-grid-cell="${String(index)}"] [aria-label="Choose the session for this cell"]')?.innerText ?? ''`)
        if (shown.includes(name)) return true
        await click(`[data-grid-cell="${String(index)}"] [aria-label="Choose the session for this cell"]`)
        await sleep(200)
        await ev(`(() => {
          const n = [...document.querySelectorAll('[data-cell-choice-id]')].find((x) => x.innerText.includes(${js(name)}))
          if (!n) return false
          n.click()
          return true
        })()`)
        await sleep(250)
        return null
      }, 12000, 300)
    }
    for (let i = 0; i < 4; i++) await pickCell(i, 'shot-' + String(i + 1))
    const panesReady = await waitFor(() => ev(`(() => {
      const views = [...document.querySelectorAll('[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport')]
      return views.length === 4 && views.every((v) => { const r = v.querySelector('.xterm')?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0 })
    })()`), 10000, 300)
    t.check('four shell panes rendered in the 2x2 grid', !!panesReady)

    await ev(`(() => {
      let style = document.getElementById('grid-shot-mask')
      if (!style) { style = document.createElement('style'); style.id = 'grid-shot-mask'; document.head.appendChild(style) }
      style.textContent = ${js(MASK_CSS)}
      return true
    })()`)

    const focusCell = async (index) => {
      const fired = await ev(`(() => {
        const pane = document.querySelector('[data-testid="grid-view"] .terminal-pane[data-grid-cell="${String(index)}"]')
        if (!pane) return false
        pane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
        return true
      })()`)
      await waitFor(() => ev(`!!document.querySelector('[data-testid="grid-view"] .terminal-pane--active[data-grid-cell="${String(index)}"]')`), 4000, 100)
      return fired
    }

    await focusCell(0)
    let box = await waitForSettledGrid(app)
    await compareShot(app, t, SHOTS[0].name, box)

    const focused = await focusCell(1)
    t.check('a grid cell can take the focus ring', !!focused)
    box = await waitForSettledGrid(app)
    await compareShot(app, t, SHOTS[1].name, box)

    await app.send('Emulation.setDeviceMetricsOverride', { width: NARROW.width, height: NARROW.height, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    box = await waitForSettledGrid(app)
    await compareShot(app, t, SHOTS[2].name, box)
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) {
      try { app.evaluate('window.api.quitApp()').catch(() => undefined) } catch { /* already gone */ }
      await sleep(400)
      app.kill()
    }
    await sleep(300)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell may still hold the folder */ }
    const failedCount = t.summary()
    process.exitCode = failedCount > 0 ? 1 : 0
  }
}

// ---- unit tests (pure; run with --self-test, no app) -------------------------------------------------

/** Handcraft a PNG with a chosen filter so all five scanline filters are exercised by the decoder. */
function encodeTestPng(width, height, channels, pixels, filter) {
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x
      const a = x >= channels ? pixels[index - channels] : 0
      const b = y > 0 ? pixels[index - stride] : 0
      const c = y > 0 && x >= channels ? pixels[index - stride - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = a
      else if (filter === 2) predictor = b
      else if (filter === 3) predictor = (a + b) >> 1
      else if (filter === 4) predictor = paeth(a, b, c)
      raw[y * (stride + 1) + 1 + x] = (pixels[index] - predictor) & 0xff
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = channels === 4 ? 6 : 2
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

function selfTest() {
  assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082, 'CRC matches the PNG IEND chunk')
  const width = 4
  const height = 3
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i * 37) & 0xff
    rgba[i * 4 + 1] = (i * 91) & 0xff
    rgba[i * 4 + 2] = (i * 13) & 0xff
    rgba[i * 4 + 3] = 200
  }
  for (const filter of [0, 1, 2, 3, 4]) {
    assert.deepEqual(decodePng(encodeTestPng(width, height, 4, rgba, filter)), { width, height, data: rgba }, 'RGBA scanline filter ' + String(filter))
  }
  const rgb = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90])
  const decodedRgb = decodePng(encodeTestPng(3, 1, 3, rgb, 4))
  assert.deepEqual(Array.from(decodedRgb.data), [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255], 'RGB PNG gets opaque alpha')
  assert.deepEqual(decodePng(encodePng(width, height, rgba)).data, rgba, 'encoder/decoder round trip')
  assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/, 'bad input is rejected')

  const base = Buffer.alloc(200 * 200 * 4, 12)
  const identical = { width: 200, height: 200, data: Buffer.from(base) }
  assert.equal(comparePng(identical, identical).pass, true, 'identical images pass')
  const withinTolerance = { width: 200, height: 200, data: Buffer.from(base) }
  withinTolerance.data[0] = 20 // exactly 8: allowed
  assert.equal(comparePng(withinTolerance, identical).pass, true, 'an 8-channel delta is within tolerance')
  withinTolerance.data[0] = 21
  const onePixel = comparePng(withinTolerance, identical)
  assert.equal(onePixel.pass, true, '1 of 40,000 pixels (0.0025%) is within the 0.5% budget')
  const overBudget = { width: 200, height: 200, data: Buffer.from(base) }
  for (let i = 0; i < 201; i++) overBudget.data[i * 4] = 30
  const failed = comparePng(overBudget, identical)
  assert.equal(failed.pass, false, '201 of 40,000 pixels (0.5025%) fails')
  assert.equal(failed.differing, 201, 'differing pixel count is exact')
  assert.equal(comparePng({ width: 3, height: 3, data: Buffer.alloc(36) }, identical).reason, 'size', 'size mismatch is reported')
  const diff = decodePng(makeDiffPng(overBudget, identical))
  assert.equal(diff.width, 200, 'diff image keeps the size')
  assert.equal(diff.data[0], 255, 'the differing pixel is red in the diff image')
  assert.equal(diff.data[250 * 4], 6, 'an unchanged pixel is a dim grey')
  assert.ok(MASK_CSS.includes('.xterm') && MASK_CSS.includes('[data-time]') && MASK_CSS.includes('canvas'), 'volatile regions are masked')
  assert.equal(SHOTS.length, 3, 'default, focused and narrow shots exist')
  console.log('PASS  PNG codec / comparison / masking self-tests (crc, 5 filters, RGB, tolerance, diff)')
}

module.exports = { decodePng, encodePng, comparePng, makeDiffPng, maskCss: MASK_CSS, shots: SHOTS, selfTest }

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch((error) => { console.error(error); process.exitCode = 1 })
}
