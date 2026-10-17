// Verifies the generated icons in build/: PNG signature, IHDR size, chunk CRCs, and the ICO header and entries.
// Run: node scripts/check-icons.cjs   (exit code 1 on any problem)
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const BUILD_DIR = path.resolve(__dirname, '..', 'build')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Parses a PNG buffer; returns { width, height, colorType, bitDepth } or throws. Walks every chunk and checks its CRC. */
function parsePng(buf, label) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${label}: bad PNG signature`)
  let pos = 8
  let ihdr = null
  let sawIend = false
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1')
    const data = buf.subarray(pos + 8, pos + 8 + len)
    const crc = buf.readUInt32BE(pos + 8 + len)
    if (zlib.crc32(buf.subarray(pos + 4, pos + 8 + len)) !== crc) throw new Error(`${label}: CRC mismatch in ${type} chunk`)
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9] }
    }
    if (type === 'IEND') sawIend = true
    pos += 12 + len
  }
  if (!ihdr) throw new Error(`${label}: no IHDR chunk`)
  if (!sawIend) throw new Error(`${label}: no IEND chunk`)
  return ihdr
}

function checkPngFile(name, expectedSize) {
  const file = path.join(BUILD_DIR, name)
  const buf = fs.readFileSync(file)
  const { width, height, colorType, bitDepth } = parsePng(buf, name)
  if (width !== expectedSize || height !== expectedSize) throw new Error(`${name}: expected ${expectedSize}x${expectedSize}, got ${width}x${height}`)
  if (bitDepth !== 8 || ![4, 6].includes(colorType)) throw new Error(`${name}: expected 8-bit RGBA, got depth ${bitDepth} type ${colorType}`)
  return { name, width, height, bytes: buf.length }
}

function checkIco(name) {
  const buf = fs.readFileSync(path.join(BUILD_DIR, name))
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error(`${name}: ICONDIR is not an icon (reserved/type)`)
  const count = buf.readUInt16LE(4)
  if (count !== ICO_SIZES.length) throw new Error(`${name}: ${count} entries, expected ${ICO_SIZES.length}`)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    const o = 6 + i * 16
    const w = buf.readUInt8(o) || 256
    const h = buf.readUInt8(o + 1) || 256
    const planes = buf.readUInt16LE(o + 4)
    const bpp = buf.readUInt16LE(o + 6)
    const size = buf.readUInt32LE(o + 8)
    const offset = buf.readUInt32LE(o + 12)
    if (w !== h) throw new Error(`${name}: entry ${i} not square (${w}x${h})`)
    if (offset + size > buf.length) throw new Error(`${name}: entry ${i} points past end of file`)
    const png = buf.subarray(offset, offset + size)
    const parsed = parsePng(png, `${name} entry ${w}px`)
    if (parsed.width !== w || parsed.height !== h) throw new Error(`${name}: entry ${w}px embeds a ${parsed.width}x${parsed.height} PNG`)
    entries.push({ size: w, bpp, planes, bytes: size })
  }
  const sizes = entries.map((e) => e.size).sort((a, b) => a - b)
  if (sizes.join(',') !== ICO_SIZES.join(',')) throw new Error(`${name}: sizes ${sizes.join(',')} != ${ICO_SIZES.join(',')}`)
  return entries
}

let failed = 0
function run(label, fn) {
  try {
    const result = fn()
    console.log(`PASS  ${label}  ${result}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${label}  -> ${error.message}`)
  }
}

run('icon.png', () => { const r = checkPngFile('icon.png', 512); return `${r.width}x${r.height}, ${r.bytes} bytes` })
run('tray.png', () => { const r = checkPngFile('tray.png', 32); return `${r.width}x${r.height}, ${r.bytes} bytes` })
run('tray-attention.png', () => { const r = checkPngFile('tray-attention.png', 32); return `${r.width}x${r.height}, ${r.bytes} bytes` })
run('icon.ico', () => {
  const entries = checkIco('icon.ico')
  return entries.map((e) => `${e.size}(${e.bytes}B)`).join(' ')
})

if (failed) {
  console.log(`\n${failed} icon check(s) failed`)
  process.exit(1)
}
console.log('\nall icon checks passed')
