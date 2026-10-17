// Renders build/icon.svg into the app's raster icons. Run with Electron: `npm run icons` (npx electron scripts/make-icons.cjs).
// Outputs: build/icon.png (512), build/icon.ico (multi-resolution, PNG-compressed), build/tray.png (32),
// build/tray-attention.png (32, amber dot bottom-right). Then run `node scripts/check-icons.cjs`.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const BUILD_DIR = path.resolve(__dirname, '..', 'build')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ATTENTION_DOT = '<circle cx="452" cy="452" r="64" fill="#f5a623" stroke="#0a0a0a" stroke-width="22"/>'

function readSvg() {
  return fs.readFileSync(path.join(BUILD_DIR, 'icon.svg'), 'utf8')
}

/** Renders an SVG string to a PNG buffer at `size` px, using the renderer's canvas (hidden window). */
async function renderPngs(win, svgText, sizes) {
  const dataUrls = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(svgText)}
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const out = {}
    for (const size of ${JSON.stringify(sizes)}) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, size, size)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, size, size)
      out[size] = canvas.toDataURL('image/png')
    }
    return out
  })()`)
  const result = {}
  for (const size of sizes) {
    const b64 = dataUrls[size].replace(/^data:image\/png;base64,/, '')
    result[size] = Buffer.from(b64, 'base64')
  }
  return result
}

/** Writes a valid ICO: ICONDIR + ICONDIRENTRY[] + PNG blobs. Width/height byte 0 means 256. */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach((entry, i) => {
    const o = i * 16
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, o)
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, o + 1)
    dir.writeUInt8(0, o + 2) // colour count (0 = true colour)
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // colour planes
    dir.writeUInt16LE(32, o + 6) // bits per pixel
    dir.writeUInt32LE(entry.png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += entry.png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

async function main() {
  const win = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    webPreferences: { offscreen: false, backgroundThrottling: false }
  })
  await win.loadURL('data:text/html,<html><body></body></html>')

  const svg = readSvg()
  const sizes = [...new Set([16, 24, 32, 48, 64, 128, 256, 512, 32])]
  const base = await renderPngs(win, svg, sizes)
  const attention = await renderPngs(win, svg.replace('</svg>', `${ATTENTION_DOT}</svg>`), [32])

  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), base[512])
  fs.writeFileSync(path.join(BUILD_DIR, 'tray.png'), base[32])
  fs.writeFileSync(path.join(BUILD_DIR, 'tray-attention.png'), attention[32])
  const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: base[size] })))
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), ico)

  for (const name of ['icon.png', 'icon.ico', 'tray.png', 'tray-attention.png']) {
    console.log(`wrote build/${name} (${fs.statSync(path.join(BUILD_DIR, name)).size} bytes)`)
  }
  win.destroy()
}

app.whenReady().then(main).then(() => app.exit(0)).catch((error) => {
  console.error('make-icons failed:', error)
  app.exit(1)
})
