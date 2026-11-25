// E2E for D75: clicking a path that has SPACES or ACCENTED letters (unquoted, inside a sentence) opens the Preview.
// Real Shell session in a folder with files named like the user's (Vietnamese names, a folder with a space). The
// folder is made at the drive root (short paths: a printed line must not wrap) and removed at the end.
// Run: node scripts/e2e-fileview-spaces.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9424
const CR = String.fromCharCode(13)
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

function makeRoot() {
  for (const base of ['C:' + path.sep, os.tmpdir()]) {
    try {
      const dir = path.join(base, 'sd-sp')
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
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
    fs.writeFileSync(path.join(root, 'My Report.pdf'), pdf)
    fs.writeFileSync(path.join(root, 'Báo cáo tháng 10.pdf'), pdf)
    fs.mkdirSync(path.join(root, 'Bản vẽ'))
    fs.writeFileSync(path.join(root, 'Bản vẽ', 'plan.pdf'), pdf)
    fs.mkdirSync(path.join(root, 'docs'))
    fs.writeFileSync(path.join(root, 'docs', 'Báo cáo.md'), '# Relative Spaced Doc\n')

    app = await launchApp({ port: PORT })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(root)}, name: 'spaces', agent: 'shell' })`)
    const id = JSON.stringify(s.id)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('spaces')).click()`)
    await waitFor(async () => /PS .*>/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 40000, 500)
    await sleep(800)
    const type = (text) => app.evaluate(`window.api.ptyWrite(${id}, ${JSON.stringify(text + CR)})`)
    await type("function prompt { '> ' }; Clear-Host")
    await sleep(1200)
    await type('"SIZE=" + $Host.UI.RawUI.WindowSize.Width + "x" + $Host.UI.RawUI.WindowSize.Height')
    const size = await waitFor(async () => /SIZE=(\d+)x(\d+)/.exec(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data).split(CR).join(''))?.slice(1, 3) ?? null, 10000, 300)
    const [cols, rows] = (size ?? ['0', '0']).map(Number)
    t.check('the shell reports its size', cols > 20 && rows > 5, `${cols}x${rows}`)
    await type('Clear-Host')
    await sleep(800)
    // Four absolute paths inside a sentence, then one RELATIVE path with a space and accents.
    const cmd = "$a = Get-ChildItem -Recurse -File | ForEach-Object { 'saved ' + $_.FullName + ' ok' }; $b = Get-ChildItem docs -File | ForEach-Object { 'See docs/' + $_.Name + ' for details' }; Clear-Host; $a; $b"
    await type(cmd)
    const printed = await waitFor(async () => /for details/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 15000, 300)
    t.check('the five lines are printed', !!printed)
    await sleep(800)
    const screen = strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)
    t.check('accented names reach the terminal intact', /Báo cáo tháng 10\.pdf/.test(screen) && /Bản vẽ/.test(screen), screen.slice(-200).split(CR).join(' '))

    const geo = () => app.evaluate(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height } })()`)
    const reader = `(() => ({ name: document.querySelector('[data-preview-name]')?.textContent ?? '', text: document.querySelector('[data-preview-name]')?.getAttribute('title') ?? '', kind: document.querySelector('[data-file-view]')?.getAttribute('data-file-view') ?? '' }))()`
    // Output starts on row 1 (row 0 is the command line, then Clear-Host leaves rows 0.. for the output: find rows by hover).
    const results = []
    let previous = ''
    for (let row = 0; row < 8; row += 1) {
      const g = await geo()
      const x = g.left + (14 + 0.5) * (g.w / cols)
      const y = g.top + (row + 0.5) * (g.h / rows)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.left + g.w - 2, y: g.top + g.h - 2, button: 'none' })
      await sleep(150)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      const hot = await waitFor(() => app.evaluate(`!!document.querySelector('.xterm-cursor-pointer')`), 900, 100)
      if (!hot) { results.push({ row, link: false }); continue }
      for (const [kind, buttons] of [['mousePressed', 1], ['mouseReleased', 0]]) await app.send('Input.dispatchMouseEvent', { type: kind, x, y, button: 'left', buttons, clickCount: 1 })
      const got = await waitFor(async () => { const r = await app.evaluate(reader); return r.name && `${r.name}|${r.text}` !== previous ? r : null }, 6000, 250)
      if (got) previous = `${got.name}|${got.text}`
      results.push({ row, link: true, ...(got || { name: '(no preview)' }) })
    }
    console.log('rows:', JSON.stringify(results.map((r) => (r.link ? `${r.row}:${r.name}` : `${r.row}:-`))))
    const names = results.filter((r) => r.link).map((r) => r.name)
    t.check('a path with a space opens its PDF (My Report.pdf)', names.includes('My Report.pdf'))
    t.check('a path with Vietnamese letters and spaces opens its PDF', names.includes('Báo cáo tháng 10.pdf'))
    t.check('a path through a folder with a space and accents opens its PDF', names.includes('plan.pdf'))
    const md = results.filter((r) => r.link && r.name === 'Báo cáo.md')
    t.check('an absolute spaced path to a .md opens it', md.some((r) => /^[A-Za-z]:/.test(r.text)), JSON.stringify(md.map((r) => r.text)))
    t.check('a RELATIVE path with a space and accents opens it (docs/Báo cáo.md)', md.some((r) => !/^[A-Za-z]:/.test(r.text)), JSON.stringify(md.map((r) => r.text)))
    t.check('every opened file is shown in the Preview (no external window needed)', await app.evaluate(`document.querySelector('[data-side-tab="preview"]')?.getAttribute('aria-selected') === 'true'`))
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
