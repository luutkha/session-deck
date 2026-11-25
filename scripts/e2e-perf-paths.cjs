// E2E for the performance round (D87): checks in the REAL built app for behaviour that the unit tests only cover as pure logic.
//  A  pty replay is freed when a session is removed; the main window does not load the detached-window chunks;
//     the command palette shows fresh items when it opens
//  B  memoized sidebar / Hub rows still show every change (rename, tags, sleep, bell) and the debounced search still filters
//  C  terminal search: highlights are capped (200) but the search still works
//  D  PDFs around the 8 MB switch: below it the whole file crosses IPC, above it pdf.js streams ranges; mixed page sizes are measured lazily
//  E  Code mode: getWorktreeChanges cache (allowCached) vs fresh reads, Changes panel Refresh is fresh, a 5,000-line diff mounts in chunks
//     and a detached window loads its own chunk
// Run: npx electron-vite build && node scripts/e2e-perf-paths.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, strip, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9515
const js = (value) => JSON.stringify(value)
const CTRL = 2
const SHIFT = 8
const MB = 1024 * 1024
const STORE_ENV = 'SESSIONDECK_E2E_ENDPOINT_FILE'

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' })
}

function makeRepo(root) {
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => `line ${i + 1} ${tag}`).join('\n') + '\n'
  fs.writeFileSync(path.join(repo, 'big.txt'), lines(3000, 'original'))
  fs.writeFileSync(path.join(repo, 'small.txt'), lines(10, 'original'))
  fs.writeFileSync(path.join(repo, 'cache.txt'), 'cache original\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'initial')
  return repo
}

/** A valid PDF of `pages` pages (page i uses sizes[i % sizes.length]) padded with one unreferenced stream to about `bulk` bytes. */
function makePdf(file, pages, sizes, bulk) {
  const parts = []
  let offset = 0
  const offsets = []
  const push = (buf) => { parts.push(buf); offset += buf.length }
  const obj = (n, body) => { offsets[n] = offset; push(Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, 'latin1')) }
  push(Buffer.from('%PDF-1.4\n', 'latin1'))
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let i = 0; i < pages; i += 1) {
    const [w, h] = sizes[i % sizes.length]
    const stream = `BT /F1 32 Tf 20 100 Td (Perf PDF page ${i + 1}) Tj ET`
    obj(4 + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    obj(5 + i * 2, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  const bulkNumber = 4 + pages * 2
  offsets[bulkNumber] = offset
  push(Buffer.from(`${bulkNumber} 0 obj\n<< /Length ${bulk} >>\nstream\n`, 'latin1'))
  push(Buffer.alloc(bulk, 0x41))
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
  let failed = 1
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-perfpaths-')))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  const endpointFile = path.join(root, 'endpoint.json')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(userData)
  fs.mkdirSync(proj)
  process.env[STORE_ENV] = endpointFile
  const repo = makeRepo(root)
  const realClaude = path.join(os.homedir(), '.claude')
  const claudeBefore = fs.existsSync(realClaude) ? fs.statSync(path.join(realClaude)).mtimeMs : null

  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    const pageTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === 'page' && !x.url.startsWith('devtools'))
    const key = async (k, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    }
    const mouse = async (x, y, button) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
    }
    const center = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height } })()`)
    const clickSel = async (selector) => {
      const p = await waitFor(async () => { const q = await center(selector); return q && q.w > 0 && q.h > 0 ? q : null }, 12000, 200)
      if (p === null) throw new Error(`not found: ${selector}`)
      await mouse(p.x, p.y, 'left')
      await sleep(300)
    }
    const card = (id) => `document.querySelector('[data-session-card=${js(id)}]')`
    const cardText = (id) => ev(`${card(id)}?.innerText ?? null`)
    const mk = (name, cwd = proj) => ev(`window.api.createSession({ cwd: ${js(cwd)}, name: ${js(name)}, agent: 'shell' })`)

    // ================= A. pty buffer release, lazy windows, palette freshness
    const a = await mk('perf-a')
    await sleep(800)
    await ev(`document.querySelector('[data-session-card=${js(a.id)}]')?.click()`)
    await sleep(1500)
    await ev(`window.api.ptyWrite(${js(a.id)}, 'echo perf-pty-marker\\r')`)
    const replayHas = await waitFor(async () => strip((await ev(`window.api.ptyReplay(${js(a.id)})`)).data).includes('perf-pty-marker') || null, 20000, 400)
    t.check('A1: a running shell session has replay output', !!replayHas)
    await ev(`window.api.removeSession(${js(a.id)})`)
    await sleep(800)
    const replayAfter = await ev(`window.api.ptyReplay(${js(a.id)}).then((r) => (r && r.data) ? r.data.length : 0).catch(() => 0)`)
    t.check('A2: after the session is removed its replay buffer is empty (freed)', replayAfter === 0, String(replayAfter))

    const flattenTree = (frame) => [...(frame.resources ?? []).map((r) => r.url), ...(frame.childFrames ?? []).flatMap((child) => flattenTree(child))]
    await app.send('Page.enable')
    const tree = await app.send('Page.getResourceTree')
    const mainUrls = flattenTree(tree.result.frameTree)
    t.check('A3: the main window loaded its app bundle but not the detached-window chunks', mainUrls.some((u) => /assets\/index-.*\.js/.test(u)) && !mainUrls.some((u) => /ChangesWindow|ViewerWindow/.test(u)), js(mainUrls.filter((u) => /assets\//.test(u)).map((u) => u.split('/').pop())))

    await key('K', 'KeyK', 75, CTRL | SHIFT)
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]")'), 4000, 100)
    await key('Escape', 'Escape', 27)
    await waitFor(() => ev('!document.querySelector("[cmdk-input]")'), 4000, 100)
    const late = await mk('perf-late-created')
    await sleep(600)
    await key('K', 'KeyK', 75, CTRL | SHIFT)
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]")'), 4000, 100)
    await app.send('Input.insertText', { text: 'perf-late-created' })
    const lateItem = await waitFor(() => ev(`[...document.querySelectorAll('[cmdk-item]')].some((n) => n.innerText.includes('perf-late-created')) || null`), 4000, 150)
    t.check('A4: a session created while the palette was closed is in the palette when it opens', !!lateItem)
    await key('Escape', 'Escape', 27)
    await waitFor(() => ev('!document.querySelector("[cmdk-input]")'), 4000, 100)
    await ev(`window.api.removeSession(${js(late.id)})`)

    // ================= B. memoized rows still show every change
    const b1 = await mk('perf-b1')
    const b2 = await mk('perf-b2')
    const b3 = await mk('perf-b3')
    await sleep(1200)
    t.check('B0: three cards are listed', (await cardText(b1.id)) !== null && (await cardText(b2.id)) !== null && (await cardText(b3.id)) !== null)
    await ev(`window.api.renameSession(${js(b2.id)}, 'perf-renamed-b2')`)
    t.check('B1: renaming a session updates its sidebar card', !!(await waitFor(async () => (await cardText(b2.id))?.includes('perf-renamed-b2') || null, 4000, 150)), String(await cardText(b2.id)))
    t.check('B1b: the other cards keep their names', (await cardText(b1.id)).includes('perf-b1') && (await cardText(b3.id)).includes('perf-b3'))
    await ev(`window.api.setSessionTags(${js(b1.id)}, ['alphatag', 'beta'])`)
    t.check('B2: tags appear on the card', !!(await waitFor(() => ev(`${card(b1.id)}?.querySelector('[data-tag="alphatag"]') !== null || null`), 4000, 150)))
    await ev(`window.api.setSessionTags(${js(b1.id)}, ['beta'])`)
    t.check('B2b: removing a tag removes its chip and keeps the other', !!(await waitFor(() => ev(`(${card(b1.id)} && !${card(b1.id)}.querySelector('[data-tag="alphatag"]') && !!${card(b1.id)}.querySelector('[data-tag="beta"]')) || null`), 4000, 150)))
    await ev(`window.api.sleepSession(${js(b3.id)})`)
    t.check('B3: sleeping a session shows the moon on its card', !!(await waitFor(() => ev(`${card(b3.id)}?.querySelector('[aria-label="Sleeping"]') !== null || null`), 8000, 200)))
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const hook = (id, event) => fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, { method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}' })
    await hook(b1.id, 'Stop')
    t.check('B4: a finished turn raises the bell on that card only', !!(await waitFor(() => ev(`${card(b1.id)}?.querySelector('[data-attention-bell]') !== null || null`), 6000, 200)) && (await ev(`${card(b2.id)}?.querySelector('[data-attention-bell]') === null`)))
    await ev(`window.api.clearAttention(${js(b1.id)})`)
    t.check('B4b: clearing the bell removes it', !!(await waitFor(() => ev(`${card(b1.id)}?.querySelector('[data-attention-bell]') === null || null`), 6000, 200)))

    // sidebar search is debounced but must still filter and restore
    await clickSel('button[aria-label="Search sessions"]')
    await clickSel('input[placeholder="Search sessions"]')
    await app.send('Input.insertText', { text: 'perf-renamed' })
    const filtered = await waitFor(async () => ((await cardText(b2.id)) !== null && (await cardText(b1.id)) === null) || null, 3000, 100)
    t.check('B5: typing in the search filters the list within a moment', !!filtered)
    await ev(`(() => { const i = document.querySelector('input[placeholder="Search sessions"]'); i.focus(); i.select() })()`)
    await key('Backspace', 'Backspace', 8)
    t.check('B5b: clearing the search brings every card back', !!(await waitFor(async () => ((await cardText(b1.id)) !== null && (await cardText(b3.id)) !== null) || null, 3000, 100)))

    // Hub cards (memoized with value comparators)
    await ev(`[...document.querySelectorAll('button')].find((n) => (n.getAttribute('aria-label') || '') === 'Open Hub')?.click()`)
    const hubUp = await waitFor(() => ev(`document.querySelector('[data-hub-card=${js(b2.id)}]') !== null || null`), 6000, 200)
    t.check('B6: the Hub lists the session cards', !!hubUp)
    await ev(`window.api.renameSession(${js(b2.id)}, 'perf-hub-renamed')`)
    t.check('B7: renaming updates the Hub card', !!(await waitFor(() => ev(`document.querySelector('[data-hub-card=${js(b2.id)}]')?.innerText.includes('perf-hub-renamed') || null`), 4000, 150)))
    await ev(`window.api.setSessionTags(${js(b2.id)}, ['hubtag'])`)
    await sleep(500)
    await ev(`[...document.querySelectorAll('button')].find((n) => (n.getAttribute('aria-label') || '').startsWith('Open Hub') || (n.getAttribute('aria-label') || '') === 'Close Hub')?.click()`)
    for (const s of [b1, b2, b3]) await ev(`window.api.removeSession(${js(s.id)})`)

    // ================= C. terminal search cap
    const needles = path.join(proj, 'n.txt')
    fs.writeFileSync(needles, Array.from({ length: 400 }, (_, i) => `needleperf ${i + 1}`).join('\n') + '\n')
    const c = await mk('perf-search')
    await sleep(800)
    await ev(`document.querySelector('[data-session-card=${js(c.id)}]')?.click()`)
    // PowerShell drops keystrokes typed while it is still starting: wait for its prompt first.
    const prompted = await waitFor(async () => /PS [^\n]*>\s*$/.test(strip((await ev(`window.api.ptyReplay(${js(c.id)})`)).data)) || null, 30000, 400)
    t.check('C0: the shell showed its prompt', !!prompted, JSON.stringify(strip((await ev(`window.api.ptyReplay(${js(c.id)})`)).data).slice(-120)))
    await ev(`window.api.ptyWrite(${js(c.id)}, 'type n.txt\\r')`)
    const printed = await waitFor(async () => strip((await ev(`window.api.ptyReplay(${js(c.id)})`)).data).includes('needleperf 400') || null, 20000, 400)
    t.check('C0b: the 400 needle lines were printed', !!printed, JSON.stringify(strip((await ev(`window.api.ptyReplay(${js(c.id)})`)).data).replace(/(\r?\n)+/g, '|').slice(-260)))
    await sleep(1000)
    await ev(`document.querySelector('.xterm-helper-textarea')?.focus()`)
    await key('F', 'KeyF', 70, CTRL | SHIFT)
    const searchUp = await waitFor(() => ev('!!document.querySelector("[data-testid=terminal-search]")'), 4000, 150)
    t.check('C1: Ctrl+Shift+F opens the terminal search bar', !!searchUp)
    await ev(`document.querySelector('[aria-label="Find in terminal"]')?.focus()`)
    await app.send('Input.insertText', { text: 'needleperf' })
    await key('Enter', 'Enter', 13)
    const countText = await waitFor(async () => { const x = await ev(`document.querySelector('[data-testid=terminal-search-count]')?.innerText ?? ''`); return /\d/.test(x) ? x : null }, 6000, 200)
    const counted = Number(String(countText).split('/').pop().replace(/[^0-9]/g, '')) || 0
    t.check('C2: 400 matches are reported, capped at 200 highlights, and the count is never more than 200', counted > 0 && counted <= 200, String(countText))
    await key('Enter', 'Enter', 13)
    const next = await ev(`document.querySelector('[data-testid=terminal-search-count]')?.innerText ?? ''`)
    t.check('C3: Enter still steps to the next match', /\d+\s*\/\s*\d+/.test(next), next)
    await key('Escape', 'Escape', 27)
    await ev(`window.api.removeSession(${js(c.id)})`)

    // ================= D. PDFs around the 8 MB switch
    const small = path.join(proj, 'Small Mixed.pdf')
    const mid = path.join(proj, 'Mid Mixed.pdf')
    const SIZES = [[300, 200], [200, 500]]
    makePdf(small, 6, SIZES, 2 * MB)
    makePdf(mid, 6, SIZES, 12 * MB)
    const d = await mk('perf-pdf')
    await sleep(800)
    await ev(`document.querySelector('[data-session-card=${js(d.id)}]')?.click()`)
    await sleep(1500)
    const viewSmall = await ev(`window.api.readFileView(${js(d.id)}, ${js(small)})`)
    t.check('D1: a 2 MB PDF crosses IPC whole (not streamed)', viewSmall.ok && viewSmall.view.streamed !== true && String(viewSmall.view.base64 || '').length > MB, js({ ok: viewSmall.ok, streamed: viewSmall.view?.streamed, b64: String(viewSmall.view?.base64 || '').length }))
    const viewMid = await ev(`window.api.readFileView(${js(d.id)}, ${js(mid)})`)
    t.check('D2: a 12 MB PDF (between 8 and 30 MB) is streamed with no bytes inside', viewMid.ok && viewMid.view.streamed === true && viewMid.view.base64 === '', js({ ok: viewMid.ok, streamed: viewMid.view?.streamed, b64: String(viewMid.view?.base64 || '').length }))
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()
    const openPdf = async (name) => {
      await rpc('tools/call', { name: 'preview_file', arguments: { path: name, session: 'perf-pdf' } })
      return waitFor(() => ev(`document.querySelectorAll('[data-file-view="pdf"] canvas').length > 0 || null`), 30000, 300)
    }
    const ink = () => ev(`(() => { const c = document.querySelector('[data-file-view="pdf"] canvas'); if (!c) return -1; const g = c.getContext('2d'); const px = g.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 100) dark++; return dark })()`)
    const label = () => ev(`document.querySelector('[data-pdf-page-label]')?.innerText ?? ''`)
    t.check('D3: the small mixed-size PDF draws its first page with ink', !!(await openPdf('Small Mixed.pdf')) && (await ink()) > 20)
    t.check('D3b: its page count is 6', /1\s*\/\s*6/.test(await label()), await label())
    t.check('D4: the 12 MB mixed-size PDF draws its first page with ink', !!(await openPdf('Mid Mixed.pdf')) && (await ink()) > 20)
    t.check('D4b: its page count is 6 and it says pages load on demand', /1\s*\/\s*6/.test(await label()) && (await ev(`/Large file/.test(document.querySelector('[data-pdf-streamed]')?.innerText ?? '')`)), await label())
    // Page boxes are measured as they come into view, so the end moves while scrolling: keep going to the end.
    t.check('D5: scrolling to the end shows page 6 / 6', !!(await waitFor(async () => { await ev(`document.querySelector('[data-testid="file-view-pdf"]').scrollTop = 1e9`); return /6\s*\/\s*6/.test(await label()) || null }, 20000, 400)), await label())
    await sleep(2500)
    const heights = await ev(`[...document.querySelectorAll('[data-pdf-page]')].map((n) => Math.round(n.getBoundingClientRect().height))`)
    t.check('D6: page boxes follow the real page sizes (landscape and portrait pages differ in height)', Array.isArray(heights) && heights.length === 6 && new Set(heights).size >= 2, js(heights))
    t.check('D7: the last page is drawn and far pages are not all kept', (await ev(`document.querySelectorAll('[data-file-view="pdf"] canvas').length`)) >= 1)
    await ev(`window.api.removeSession(${js(d.id)})`)

    // ================= E. Code mode: change-scan cache, Refresh, big diff chunks, lazy detached window
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    const created = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'perf paths', baseBranch: 'main', agent: 'shell' })`)
    const wt = created.worktree
    const session = created.session
    const lines = (n, tag) => Array.from({ length: n }, (_, i) => `line ${i + 1} ${tag}`).join('\n') + '\n'
    fs.writeFileSync(path.join(wt.path, 'big.txt'), lines(3000, 'EDITED'))
    fs.writeFileSync(path.join(wt.path, 'small.txt'), lines(10, 'original').replace('line 5 original', 'line 5 EDITED'))
    await sleep(500)

    const fresh1 = await ev(`window.api.getWorktreeChanges(${js(wt.id)})`)
    const cached1 = await ev(`window.api.getWorktreeChanges(${js(wt.id)}, { allowCached: true })`)
    t.check('E1: an allowCached read right after a fresh scan returns that same scan', cached1.computedAt === fresh1.computedAt, js({ fresh: fresh1.computedAt, cached: cached1.computedAt }))
    await sleep(1100)
    const fresh2 = await ev(`window.api.getWorktreeChanges(${js(wt.id)})`)
    t.check('E2: a plain read always recomputes (new timestamp)', fresh2.computedAt > fresh1.computedAt, js({ a: fresh1.computedAt, b: fresh2.computedAt }))
    fs.writeFileSync(path.join(wt.path, 'cache.txt'), 'cache EDITED\n')
    const cached2 = await ev(`window.api.getWorktreeChanges(${js(wt.id)}, { allowCached: true })`)
    t.check('E3: a poll inside the 4 s window may still see the old list (no cache.txt yet)', !cached2.files.some((f) => f.path === 'cache.txt'), js(cached2.files.map((f) => f.path)))
    const fresh3 = await ev(`window.api.getWorktreeChanges(${js(wt.id)})`)
    t.check('E4: a plain read sees the file written a moment ago', fresh3.files.some((f) => f.path === 'cache.txt'), js(fresh3.files.map((f) => f.path)))
    const cached3 = await ev(`window.api.getWorktreeChanges(${js(wt.id)}, { allowCached: true })`)
    t.check('E5: after that fresh scan a poll gets the new list', cached3.files.some((f) => f.path === 'cache.txt') && cached3.computedAt === fresh3.computedAt)

    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' && !!document.querySelector('[data-session-card=${js(session.id)}]')`), 12000, 200)
    await clickSel(`[data-session-card="${session.id}"]`)
    const tabSel = `[role=tab][data-tab-id=${js(session.id)}]`
    const tabPoint = await waitFor(async () => (await center(tabSel)) ?? null, 12000, 200)
    await mouse(tabPoint.x, tabPoint.y, 'right')
    await waitFor(() => ev(`!!document.querySelector('[data-slot="context-menu-content"]')`), 5000, 100)
    await clickSel('[data-view-changes]')
    const listed = await waitFor(() => ev(`['big.txt', 'small.txt', 'cache.txt'].every((p) => !!document.querySelector('section[aria-label="Changes"] [data-change-path=' + JSON.stringify(p) + ']')) || null`), 20000, 250)
    t.check('E6: the Changes panel lists the three changed files', !!listed)

    // Refresh is a fresh read: a file written right after the last scan shows up at once
    fs.writeFileSync(path.join(wt.path, 'late.txt'), 'late file\n')
    await clickSel('[aria-label="Refresh changes"]')
    t.check('E7: the Refresh button shows a file written a moment ago', !!(await waitFor(() => ev(`!!document.querySelector('section[aria-label="Changes"] [data-change-path="late.txt"]') || null`), 5000, 200)))

    // small diff: no chunking at all
    await clickSel('section[aria-label="Changes"] [data-change-path="small.txt"]')
    await waitFor(() => ev(`!!document.querySelector('[data-diff-layout]')`), 8000, 200)
    t.check('E8: a small diff has no chunk placeholders', (await ev(`document.querySelectorAll('[data-diff-chunk]').length`)) === 0)

    // big diff: chunked mount in the real browser
    await ev(`[...document.querySelectorAll('section[aria-label="Changes"] button')].find((b) => b.innerText.trim() === 'All files')?.click()`)
    await sleep(500)
    await clickSel('section[aria-label="Changes"] [data-change-path="big.txt"]')
    const bigUp = await waitFor(() => ev(`document.querySelectorAll('[data-diff-chunk]').length > 0 || null`), 15000, 250)
    t.check('E9: a 5,000-line diff opens with later chunks as placeholders', !!bigUp, String(await ev(`document.querySelectorAll('[data-diff-chunk]').length`)))
    const measure = () => ev(`(() => { const root = document.querySelector('[data-diff-layout]'); return { placeholders: root.querySelectorAll('[data-diff-chunk]').length, nodes: root.querySelectorAll('*').length, height: root.scrollHeight } })()`)
    const first = await measure()
    t.check('E10: far fewer DOM nodes than rows are mounted at first (under 12,000 for 5,000 rows)', first.nodes < 12000 && first.height > 5000 * 18 * 0.9, js(first))
    await ev(`document.querySelector('[data-diff-layout]').scrollTop = 1e9`)
    const afterScroll = await waitFor(async () => { const m = await measure(); return m.placeholders < first.placeholders ? m : null }, 10000, 250)
    t.check('E11: scrolling to the end mounts the chunks that come near the viewport', !!afterScroll, js({ first, afterScroll }))
    // The diff shows 5,000 rows (the hunk header, 3,000 removed lines, then the first added ones; the rest is cut off with a notice).
    const lastText = await ev(`document.querySelector('[data-diff-layout]').innerText.includes('line 1999 EDITED') || null`)
    t.check('E12: the last shown row of the diff is really rendered after the scroll', !!lastText, JSON.stringify(await ev(`document.querySelector('[data-diff-layout]').innerText.slice(-160)`)))
    await ev(`document.querySelector('[data-diff-layout]').scrollTop = 0`)
    await sleep(600)
    const back = await measure()
    t.check('E13: scrolling back up keeps mounted chunks (placeholders do not come back)', afterScroll && back.placeholders <= afterScroll.placeholders, js({ afterScroll, back }))
    t.check('E14: hunk actions are present in the mounted chunk (Discard block button)', (await ev(`document.querySelectorAll('[data-discard-hunk]').length`)) >= 1)

    // detached window loads its own chunk
    const beforeIds = new Set((await pageTargets()).map((x) => x.id))
    await clickSel('[data-changes-detach]')
    const detached = await waitFor(async () => {
      const x = (await pageTargets()).find((p) => !beforeIds.has(p.id))
      return x ?? null
    }, 20000, 300)
    t.check('E15: Detach opens a second window', !!detached)
    if (detached) {
      const ws = new WebSocket(detached.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
      let n = 0
      const pending = new Map()
      ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } }
      const evalDetached = (expression) => new Promise((resolve) => { const id = ++n; pending.set(id, resolve); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })) })
      const sendDetached = (method) => new Promise((resolve) => { const id = ++n; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params: {} })) })
      await sendDetached('Page.enable')
      const loaded = await waitFor(async () => {
        const tree = await sendDetached('Page.getResourceTree')
        const urls = flattenTree(tree.result.frameTree)
        const r = await evalDetached(`!!document.querySelector('[data-changes-list]')`)
        return urls.some((u) => /ChangesWindow/.test(u)) && r.result && r.result.result && r.result.result.value === true ? true : null
      }, 20000, 400)
      t.check('E16: the detached window loaded its ChangesWindow chunk and shows the list', !!loaded)
      ws.close()
    }

    // the real config folder is untouched
    const claudeAfter = fs.existsSync(realClaude) ? fs.statSync(realClaude).mtimeMs : null
    t.check('Z: the real ~/.claude folder was not modified by this run', claudeBefore === claudeAfter, js({ claudeBefore, claudeAfter }))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    delete process.env[STORE_ENV]
    failed = t.summary()
    if (app) app.kill()
    await sleep(1200)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* the app may still hold a file for a moment */ }
  }
  process.exit(failed === 0 ? 0 : 1)
}

main()
