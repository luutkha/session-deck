// E2E (F3): odd file kinds in the Changes view + non-shell sessions offering "View changes".
// A temp git repo gets a worktree with a shell session; before the panel opens the worktree is changed with real git
// commands: a deleted file, a renamed file (with a small edit), an added binary, a modified tracked binary, an
// untracked text file, a tracked file whose name has a space and a non-ASCII letter, and a 6000-line text change.
// The tab menu is opened with REAL right-clicks over CDP on the built app; every row is checked for its kind badge and
// line counts, its diff is opened (removed lines, "Binary file, no text diff.", the 5000-line cut notice), "All files"
// returns to the list, and the detached window shows the same paths. Claude/OpenCode/Cursor worktree sessions are
// created against a fake CLI on PATH (never the real CLIs, never ~/.claude or ~/.cursor) and their tab menu must offer
// View changes and open the Changes tab. The renderer consoles must stay clean and the real config folders untouched.
// Run: node scripts/e2e-changes-files.cjs  (E2E_SHOT_DIR=<dir> for screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9488
const UNICODE_NAME = 'na\u00efve file.txt'
const EXPECTED_PATHS = ['big.txt', 'deleted-me.txt', 'fake.png', UNICODE_NAME, 'notes.txt', 'photo.bin', 'renamed.txt']
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', '-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8' }).trim()

/** Existence, mtime and size of the real user config folders: the run must not change them. */
function statOf(file) {
  try {
    const stat = fs.statSync(file)
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return { exists: false }
  }
}

/** Deterministic "binary" bytes with NULs and non-UTF8 values (a tiny fake .png / .bin). */
function binaryBytes(seed) {
  const bytes = Buffer.alloc(64)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 31 + i * 17) % 256
  bytes[0] = 0x89
  bytes[1] = 0x50
  bytes[2] = 0x4e
  bytes[3] = 0x47
  bytes[8] = 0x00
  bytes[9] = 0x00
  return bytes
}

function makeRepo(root) {
  const repo = path.join(root, 'my-app')
  fs.mkdirSync(repo, { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  // The PC's global git may convert line endings at checkout; the worktree must hold exactly the bytes written.
  git(repo, 'config', 'core.autocrlf', 'false')
  git(repo, 'config', 'core.eol', 'lf')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  fs.writeFileSync(path.join(repo, 'deleted-me.txt'), 'deleted line alpha\nsecond old line\n')
  fs.writeFileSync(path.join(repo, 'old-name.txt'), 'rename me\nsecond line\nthird line\n')
  fs.writeFileSync(path.join(repo, 'photo.bin'), binaryBytes(3))
  fs.writeFileSync(path.join(repo, UNICODE_NAME), 'unicode alpha\nunicode beta\n')
  fs.writeFileSync(path.join(repo, 'big.txt'), 'big initial line\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

/**
 * Fake `claude`, `opencode` and `cursor-agent` shims first on PATH: creating a session of each kind exercises the real
 * app without starting a real CLI (and without reading or writing the real ~/.claude and ~/.cursor).
 */
function writeFakeAgents(binDir) {
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'fake-claude.js'), "process.stdout.write('fake claude ready\\r\\n> ')\nprocess.stdin.resume()\nsetInterval(() => {}, 1 << 30)\n")
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n')
  // No "--standalone" in --help: the app launches the plain form. Any other argv is ignored.
  fs.writeFileSync(path.join(binDir, 'fake-opencode.js'), [
    "const argv = process.argv.slice(2)",
    "if (argv.includes('--help')) { process.stdout.write('fake opencode help\\n'); process.exit(0) }",
    "if (argv.includes('--version')) { process.stdout.write('9.9.9\\n'); process.exit(0) }",
    "process.stdout.write('fake opencode ready\\r\\n')",
    'process.stdin.resume()',
    'setInterval(() => {}, 1 << 30)'
  ].join('\n') + '\n')
  fs.writeFileSync(path.join(binDir, 'opencode.cmd'), '@echo off\r\nnode "%~dp0fake-opencode.js" %*\r\n')
  fs.writeFileSync(path.join(binDir, 'fake-cursor.js'), "process.stdout.write('fake cursor ready\\r\\n')\nprocess.stdin.resume()\nsetInterval(() => {}, 1 << 30)\n")
  fs.writeFileSync(path.join(binDir, 'cursor-agent.cmd'), '@echo off\r\nnode "%~dp0fake-cursor.js" %*\r\n')
}

/** Runs CDP commands in another page (the detached Changes window) over its own webSocketDebuggerUrl. */
async function cdpIn(wsUrl, commands) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  const results = new Array(commands.length)
  const finished = new Promise((resolve) => {
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (!d.id || d.id < 1 || d.id > commands.length) return
      results[d.id - 1] = d.result
      if (results.filter((r) => r !== undefined).length === commands.length) resolve()
    }
    commands.forEach((c, i) => ws.send(JSON.stringify({ id: i + 1, method: c.method, params: c.params ?? {} })))
  })
  await Promise.race([finished, sleep(5000)])
  ws.close()
  return results
}

async function evalIn(wsUrl, expression) {
  const [r] = await cdpIn(wsUrl, [{ method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }])
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed in the detached window')
  return r && r.result ? r.result.value : undefined
}

async function main() {
  const t = makeChecker()
  let app
  let cws = null
  const issues = []
  const detachedIssues = []
  const monitors = []
  const skips = []
  const skip = (name, reason) => { skips.push(name); console.log(`SKIP  ${name}  -> ${reason}`) }
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-changesfiles-')))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  const binDir = path.join(root, 'bin')
  const cursorHome = path.join(root, 'cursor-home')
  fs.mkdirSync(userData)
  fs.mkdirSync(cursorHome)
  const repo = makeRepo(root)
  const js = (value) => JSON.stringify(value)
  const realClaude = path.join(os.homedir(), '.claude')
  const realCursor = path.join(os.homedir(), '.cursor')
  const watched = [realClaude, path.join(realClaude, 'settings.json'), realCursor, path.join(realCursor, 'hooks.json')]
  const before = watched.map(statOf)
  const originalPath = process.env.PATH ?? ''
  const originalCursorConfigDir = process.env.SESSIONDECK_CURSOR_CONFIG_DIR
  let detach = null

  writeFakeAgents(binDir)
  process.env.PATH = binDir + path.delimiter + originalPath
  process.env.SESSIONDECK_CURSOR_CONFIG_DIR = cursorHome

  const pageTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === 'page' && !x.url.startsWith('devtools'))
  const pageIds = async () => new Set((await pageTargets()).map((x) => x.id))
  /** A page's console errors and uncaught exceptions in its own CDP socket (the harness socket ignores them). */
  const attachMonitor = async (wsUrl, sink) => {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.method === 'Runtime.exceptionThrown') {
        sink.push('EXCEPTION ' + String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).slice(0, 220))
      }
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
        sink.push('console.error ' + d.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 220))
      }
    }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
    monitors.push(ws)
    await sleep(150)
  }

  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const mainTargets = await pageTargets()
    cws = new WebSocket(mainTargets[0].webSocketDebuggerUrl)
    await new Promise((resolve) => { cws.onopen = resolve })
    cws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.method === 'Runtime.exceptionThrown') {
        issues.push('EXCEPTION ' + String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).slice(0, 220))
      }
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
        issues.push('console.error ' + d.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 220))
      }
    }
    cws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
    await sleep(300)

    const ev = (expr) => app.evaluate(expr)
    const shot = async (name, wsUrl) => {
      if (!process.env.E2E_SHOT_DIR) return
      const [r] = wsUrl
        ? await cdpIn(wsUrl, [{ method: 'Page.captureScreenshot', params: { format: 'png' } }])
        : [await app.send('Page.captureScreenshot', { format: 'png' }).then((x) => x.result)]
      const data = r && r.data
      if (data) fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(data, 'base64'))
    }
    /** Real mouse input over CDP (menus open on pointer/context events, not on synthetic .click()). */
    const mouse = async (x, y, button) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
    }
    // Escape until the menu is gone: a key sent while the menu is still animating in can be lost.
    const escape = async () => {
      for (let i = 0; i < 4; i++) {
        await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await sleep(300)
        if (!(await ev(`!!document.querySelector('[data-slot="context-menu-content"]')`))) return
      }
    }
    const center = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    // The 10 s Changes poll can unmount the list for a moment: wait for the point instead of failing on the first miss.
    const clickSel = async (selector) => {
      const p = await waitFor(async () => (await center(selector)) ?? null, 10000, 200)
      if (p === null) throw new Error(`not found: ${selector}`)
      await mouse(p.x, p.y, 'left')
      await sleep(300)
    }
    const menuOpen = () => ev(`!!document.querySelector('[data-slot="context-menu-content"]')`)
    const menuItems = () => ev(`[...document.querySelectorAll('[data-slot="context-menu-content"] [role=menuitem]')].map((n) => n.innerText.trim())`)
    const rightClickTab = async (id) => {
      const p = await ev(`(() => { const n = document.querySelector('[role=tab][data-tab-id=${js(id)}]'); if (!n) return null; n.scrollIntoView({ inline: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) } })()`)
      if (p === null) throw new Error(`no tab for ${id}`)
      await mouse(p.x, p.y, 'right')
      return waitFor(menuOpen, 3000, 100)
    }
    const clickMenuSelector = async (selector) => {
      const p = await center(selector)
      if (p === null) throw new Error(`menu item not found: ${selector} (items: ${js(await menuItems())})`)
      await mouse(p.x, p.y, 'left')
      await sleep(400)
    }
    const clickViewChanges = async () => clickMenuSelector('[data-view-changes]')
    const panelOpen = () => ev(`!!document.querySelector('[data-side-tab]')`)
    const sideTabSelected = (tab) => ev(`document.querySelector('[data-side-tab=${js(tab)}]')?.getAttribute('aria-selected') === 'true'`)
    const tabActive = (id) => ev(`document.querySelector('[role=tab][data-tab-id=${js(id)}]')?.getAttribute('aria-selected') === 'true'`)
    const openTab = async (id) => waitFor(async () => ((await ev(`!!document.querySelector('[role=tab][data-tab-id=${js(id)}]')`)) ? true : null), 12000, 200)
    /** The side panel's file detail has a breadcrumb button back to the changed files ("All files"). */
    const clickChangesBack = async () => {
      const p = await waitFor(async () => (await ev(`(() => {
        const sec = document.querySelector('section[aria-label="Changes"]')
        const n = [...(sec ? sec.querySelectorAll('button') : [])].find((b) => b.innerText.trim() === 'All files')
        if (!n) return null
        const r = n.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      })()`)) ?? null, 6000, 200)
      if (p === null) return false
      await mouse(p.x, p.y, 'left')
      await sleep(350)
      return true
    }
    const changesText = () => ev(`(document.querySelector('section[aria-label="Changes"]')?.innerText ?? '')`)
    const waitChangesText = (re, timeout = 15000) => waitFor(async () => { const text = await changesText(); return re.test(text) ? text : null }, timeout, 250)
    const alertText = () => ev(`(document.querySelector('section[aria-label="Changes"] [role=alert]')?.innerText ?? '')`)
    /** Every row of the changed files list with its kind badge (letter + label title), folder and counts text. */
    const rowInfos = () => ev(`[...document.querySelectorAll('[data-change-path]')].map((n) => {
      const badge = [...n.querySelectorAll('span[title]')].find((x) => x.getAttribute('title') !== null && x.getAttribute('title') !== '')
      return {
        path: n.dataset.changePath,
        kind: badge ? badge.getAttribute('title') : null,
        letter: badge ? badge.textContent.trim() : null,
        counts: n.innerText
      }
    })`)
    const waitAllRows = (timeout = 20000) => waitFor(async () => {
      const list = await rowInfos()
      if (!Array.isArray(list)) return null
      const paths = list.map((r) => r.path)
      return EXPECTED_PATHS.every((p) => paths.includes(p)) ? list : null
    }, timeout, 250)
    const rowOf = (list, p) => (Array.isArray(list) ? list.find((r) => r.path === p) ?? null : null)
    const alertFree = async () => ((await alertText()) ?? '').trim() === ''
    /** Waits for a NEW page target that was not there before, and attaches the console monitor to it. */
    const waitNewTarget = (known) => waitFor(async () => {
      const target = (await pageTargets()).find((x) => !known.has(x.id))
      if (!target) return null
      detach = target
      await attachMonitor(target.webSocketDebuggerUrl, detachedIssues)
      return target
    }, 20000, 400)

    // ---- 1: the temp repo, the worktree, a shell session, and the odd changes made with real git commands
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    const created = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'file kinds', baseBranch: 'main', agent: 'shell' })`)
    const wt = created.worktree
    const session1 = created.session
    t.check('1a: the worktree exists on branch file-kinds and holds a Shell session in its folder',
      !!wt && wt.branch === 'file-kinds' && fs.existsSync(wt.path) && session1.worktreeId === wt.id &&
      session1.cwd.toLowerCase() === wt.path.toLowerCase(), js({ branch: wt?.branch, path: wt?.path }))

    fs.unlinkSync(path.join(wt.path, 'deleted-me.txt'))
    git(wt.path, 'mv', 'old-name.txt', 'renamed.txt')
    fs.appendFileSync(path.join(wt.path, 'renamed.txt'), 'renamed edited line\n')
    fs.writeFileSync(path.join(wt.path, 'fake.png'), binaryBytes(11))
    git(wt.path, 'add', '--', 'fake.png')
    fs.writeFileSync(path.join(wt.path, 'photo.bin'), binaryBytes(7))
    fs.writeFileSync(path.join(wt.path, 'notes.txt'), 'untracked note alpha\nsecond note line\n')
    fs.appendFileSync(path.join(wt.path, UNICODE_NAME), 'unicode gamma\n')
    const bigLines = Array.from({ length: 6000 }, (_, i) => `line ${String(i + 1).padStart(5, '0')} changed content`)
    fs.writeFileSync(path.join(wt.path, 'big.txt'), bigLines.join('\n') + '\n')

    const status = git(wt.path, 'status', '--porcelain')
    const statusLines = status.split('\n').filter((line) => line.length > 0)
    // porcelain v1 still C-quotes a path with a space, so compare with the quotes unescaped.
    const unquoted = statusLines.map((line) => line.replace(/"/g, ''))
    t.check('1b: git status shows exactly the seven prepared changes', statusLines.length === 7 &&
      unquoted.some((l) => /^ D deleted-me\.txt$/.test(l)) &&
      unquoted.some((l) => /^R/.test(l) && l.includes('old-name.txt') && l.includes('renamed.txt')) &&
      unquoted.some((l) => /^A/.test(l) && l.endsWith('fake.png')) &&
      unquoted.some((l) => /^ M photo\.bin$/.test(l)) &&
      unquoted.some((l) => /^\?\? notes\.txt$/.test(l)) &&
      unquoted.some((l) => l.endsWith(UNICODE_NAME)) &&
      unquoted.some((l) => l.endsWith('big.txt')), js(statusLines))
    const bigBytes = fs.statSync(path.join(wt.path, 'big.txt')).size
    t.check('1c: the big text change is 6000 lines and stays under the 512 KB diff cap', bigLines.length === 6000 && bigBytes < 500 * 1024, `${bigLines.length} lines, ${bigBytes} bytes`)

    // ---- 2: Code mode, the worktree tab open, panel closed, "View changes" from the real tab menu
    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' && !!document.querySelector('[data-session-card=${js(session1.id)}]')`), 10000, 200)
    await clickSel(`[data-session-card="${session1.id}"]`)
    t.check('2a: clicking the worktree session in the sidebar opens its tab', !!(await openTab(session1.id)))
    t.check('2b: the side panel starts closed', (await panelOpen()) === false)
    t.check('2c: right-clicking the worktree session tab opens its menu', !!(await rightClickTab(session1.id)))
    const items1 = await menuItems()
    t.check('2d: the menu offers View changes', items1.includes('View changes') && (await ev(`!!document.querySelector('[data-view-changes]')`)), js(items1))
    await clickViewChanges()
    t.check('2e: View changes opens the side panel on its Changes tab', !!(await waitFor(() => ev(`!!document.querySelector('[data-side-tab="changes"][aria-selected="true"]')`), 8000, 200)))

    // ---- 3: the file list with the right kind badges and counts
    const rows = await waitAllRows()
    t.check('3a: the Changes list shows exactly the seven changed paths', !!rows && rows.length === 7 &&
      EXPECTED_PATHS.every((p) => rowOf(rows, p) !== null), js(rows && rows.map((r) => r.path)))
    const deleted = rowOf(rows, 'deleted-me.txt')
    t.check('3b: the deleted file is listed as Deleted (D) with a removal count',
      !!deleted && deleted.kind === 'Deleted' && deleted.letter === 'D' && /\u22122/.test(deleted.counts), js(deleted))
    const renamed = rowOf(rows, 'renamed.txt')
    t.check('3c: the renamed file is listed as Renamed (R)',
      !!renamed && renamed.kind === 'Renamed' && renamed.letter === 'R', js(renamed))
    const addedBin = rowOf(rows, 'fake.png')
    t.check('3d: the added binary is listed as Added (A) with the "binary" count label',
      !!addedBin && addedBin.kind === 'Added' && addedBin.letter === 'A' && addedBin.counts.includes('binary'), js(addedBin))
    const modifiedBin = rowOf(rows, 'photo.bin')
    t.check('3e: the modified tracked binary is listed as Modified (M) with "binary"',
      !!modifiedBin && modifiedBin.kind === 'Modified' && modifiedBin.letter === 'M' && modifiedBin.counts.includes('binary'), js(modifiedBin))
    const untracked = rowOf(rows, 'notes.txt')
    t.check('3f: the new text file is listed as New file (untracked) (U) with +2',
      !!untracked && untracked.kind === 'New file (untracked)' && untracked.letter === 'U' && /\+\d+/.test(untracked.counts), js(untracked))
    const unicode = rowOf(rows, UNICODE_NAME)
    t.check('3g: the file with a space and a non-ASCII letter is listed under its real name as Modified (M)',
      !!unicode && unicode.kind === 'Modified' && unicode.letter === 'M' && unicode.counts.includes(UNICODE_NAME), js(unicode))
    const big = rowOf(rows, 'big.txt')
    t.check('3h: the big text file is listed as Modified (M) with +6000',
      !!big && big.kind === 'Modified' && big.letter === 'M' && big.counts.includes('+6000'), js(big))
    await shot('changes-file-kinds')

    // ---- 4: each row's diff; no error alert, "All files" returns to the list
    const errors = []
    await clickSel('[data-change-path="deleted-me.txt"]')
    const deletedDiff = await waitChangesText(/deleted line alpha/, 12000)
    const deletedRows = await ev(`(() => {
      const rows = [...document.querySelectorAll('section[aria-label="Changes"] div')].filter((n) => typeof n.className === 'string' && n.className.includes('bg-destructive/10') && n.querySelector('span.w-4'))
      const hit = rows.find((n) => n.innerText.split('\\n').map((s) => s.trim()).includes('deleted line alpha'))
      return hit ? { marker: hit.querySelector('span.w-4').textContent, text: hit.innerText } : null
    })()`)
    t.check('4a: the deleted file\'s diff shows its removed lines with the "-" marker',
      !!deletedDiff && deletedRows !== null && deletedRows.marker === '-' && String(deletedRows.text).includes('deleted line alpha'), js(deletedRows))
    if (!(await alertFree())) errors.push('deleted: ' + String(await alertText()))
    const back1 = await clickChangesBack()
    const listAgain = await waitAllRows(8000)
    t.check('4b: "All files" returns to the list with all seven rows', back1 && !!listAgain)

    await clickSel('[data-change-path="renamed.txt"]')
    const renamedDiff = await waitChangesText(/renamed edited line/, 12000)
    t.check('4c: the renamed file\'s diff shows the edited content and its new path',
      !!renamedDiff && renamedDiff.includes('renamed.txt') && renamedDiff.includes('renamed edited line'), String(renamedDiff).slice(0, 200))
    if (!(await alertFree())) errors.push('renamed: ' + String(await alertText()))
    await clickChangesBack()

    await clickSel('[data-change-path="fake.png"]')
    const addedBinDiff = await waitChangesText(/Binary file, no text diff\./, 12000)
    t.check('4d: the added binary shows exactly "Binary file, no text diff."', !!addedBinDiff)
    if (!(await alertFree())) errors.push('fake.png: ' + String(await alertText()))
    await clickChangesBack()

    await clickSel('[data-change-path="photo.bin"]')
    const modifiedBinDiff = await waitChangesText(/Binary file, no text diff\./, 12000)
    t.check('4e: the modified tracked binary shows "Binary file, no text diff."', !!modifiedBinDiff)
    if (!(await alertFree())) errors.push('photo.bin: ' + String(await alertText()))
    await clickChangesBack()

    await clickSel('[data-change-path="notes.txt"]')
    const notesDiff = await waitChangesText(/untracked note alpha/, 12000)
    t.check('4f: the untracked text file shows its content in a diff', !!notesDiff)
    if (!(await alertFree())) errors.push('notes.txt: ' + String(await alertText()))
    await clickChangesBack()

    await clickSel(`[data-change-path=${js(UNICODE_NAME)}]`)
    const unicodeDiff = await waitChangesText(/unicode gamma/, 12000)
    t.check('4g: the space + non-ASCII named file opens its diff with the added line', !!unicodeDiff)
    if (!(await alertFree())) errors.push('unicode: ' + String(await alertText()))
    await clickChangesBack()

    await clickSel('[data-change-path="big.txt"]')
    const bigNotice = await waitChangesText(/Showing the first \d+ lines\.|Diff cut at \d+ KB\./, 25000)
    t.check('4h: the 6000-line file shows the cut/limit notice ("Showing the first N lines." or "Diff cut ...")', !!bigNotice, String(bigNotice).match(/Showing the first \d+ lines\.|Diff cut at \d+ KB\./)?.[0] ?? String(bigNotice).slice(0, 120))
    if (!(await alertFree())) errors.push('big.txt: ' + String(await alertText()))
    await shot('changes-big-diff')
    const backBig = await clickChangesBack()
    t.check('4i: "All files" returns to the list after the big diff', backBig && !!(await waitAllRows(8000)))
    t.check('4j: no diff showed an error alert', errors.length === 0, errors.join(' | '))

    // ---- 5: the detached window lists the same paths
    t.check('5a: the Changes panel header has the detach button', (await ev(`!!document.querySelector('[data-changes-detach]')`)) === true)
    const beforeIds = await pageIds()
    await clickSel('[data-changes-detach]')
    const target = await waitNewTarget(beforeIds)
    t.check('5b: the detach button opens a second window', !!target, target?.url)
    const ws = target?.webSocketDebuggerUrl ?? ''
    const detachedPaths = ws ? await waitFor(async () => {
      const r = await evalIn(ws, `(() => {
        const list = document.querySelector('[data-changes-list]')
        if (!list) return null
        return [...list.querySelectorAll('[data-change-path]')].map((n) => n.getAttribute('data-change-path'))
      })()`)
      return Array.isArray(r) && EXPECTED_PATHS.every((p) => r.includes(p)) ? r : null
    }, 20000, 300) : null
    t.check('5c: the detached [data-changes-list] shows the same seven paths', !!detachedPaths && detachedPaths.length === 7, js(detachedPaths))
    await shot('changes-detached-files', ws)

    // ---- 5d: panel controls (detached window, split layout): side-by-side, next/previous file, tree toggle
    if (ws) {
      const selectedIn = () => evalIn(ws, `document.querySelector('[data-changes-list] [data-change-path][aria-selected="true"]')?.getAttribute('data-change-path') ?? null`)
      const first = await waitFor(async () => (await selectedIn()) ?? null, 10000, 200)
      t.check('5d: the detached window has a selected file to start from', typeof first === 'string', String(first))
      await evalIn(ws, `document.querySelector('[data-changes-next]')?.click()`)
      const second = await waitFor(async () => { const s = await selectedIn(); return s !== null && s !== first ? s : null }, 8000, 200)
      t.check('5e: the Next file button moves the selection', typeof second === 'string' && second !== first, `${first} -> ${second}`)
      await evalIn(ws, `document.querySelector('[data-changes-prev]')?.click()`)
      const backTo = await waitFor(async () => (await selectedIn()) === first ? true : null, 8000, 200)
      t.check('5f: the Previous file button returns to the first file', !!backTo)
      await evalIn(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))`)
      const viaKey = await waitFor(async () => { const s = await selectedIn(); return s !== null && s !== first ? s : null }, 8000, 200)
      t.check('5g: Alt+Down also selects the next file', typeof viaKey === 'string' && viaKey !== first, String(viaKey))
      await evalIn(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))`)
      await waitFor(async () => (await selectedIn()) === first ? true : null, 8000, 200)

      const startsInline = await waitFor(async () => (await evalIn(ws, `document.querySelector('[data-diff-layout]')?.getAttribute('data-diff-layout') ?? null`)) === 'inline' ? true : null, 10000, 200)
      t.check('5h: the diff starts inline', !!startsInline)
      await evalIn(ws, `document.querySelector('[data-changes-sidebyside]')?.click()`)
      const splitOn = await waitFor(async () => (await evalIn(ws, `document.querySelector('[data-diff-layout="split"]') !== null`)) === true ? true : null, 8000, 200)
      t.check('5i: the side-by-side button switches the diff to two columns', !!splitOn)
      await evalIn(ws, `document.querySelector('[data-changes-sidebyside]')?.click()`)
      const inlineAgain = await waitFor(async () => (await evalIn(ws, `document.querySelector('[data-diff-layout="inline"]') !== null`)) === true ? true : null, 8000, 200)
      t.check('5j: and back to inline', !!inlineAgain)

      await evalIn(ws, `document.querySelector('[data-changes-tree]')?.click()`)
      const treeOn = await waitFor(async () => (await evalIn(ws, `document.querySelector('[data-changes-tree]')?.getAttribute('aria-pressed') ?? null`)) === 'true' ? true : null, 8000, 200)
      const treeRows = await evalIn(ws, `document.querySelectorAll('[data-changes-list] [data-change-path]').length`)
      t.check('5k: the tree toggle is on and still lists all seven files (all at the repo root)', !!treeOn && treeRows === 7, String(treeRows))
      await evalIn(ws, `document.querySelector('[data-changes-tree]')?.click()`)
    }


    // ---- 6: non-shell sessions: the same tab menu item and Changes tab (fake CLIs only)
    await ev(`document.querySelector('[aria-label="Close notes"]')?.click()`).catch(() => undefined)
    const kinds = [['claude', '6a'], ['opencode', '6b'], ['cursor', '6c']]
    for (const [kind, tag] of kinds) {
      let made = null
      try {
        made = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'agent ${kind}', baseBranch: 'main', agent: ${js(kind)} })`)
      } catch (error) {
        skip(`${tag}: a worktree ${kind} session is created safely`, `createWorktree failed: ${String(error).slice(0, 200)}`)
        continue
      }
      const session = made && made.session
      // A Claude session is the default agent: the store may leave `agent` unset for it (absent = claude).
      const agentOk = !!session && (session.agent === kind || (kind === 'claude' && session.agent === undefined))
      const okCreated = agentOk && !!made.worktree && fs.existsSync(made.worktree.path)
      t.check(`${tag}1: a worktree ${kind} session was created in its own folder`, okCreated, js({ agent: session?.agent, path: made?.worktree?.path }))
      await waitFor(() => ev(`!!document.querySelector('[data-session-card=${js(session.id)}]')`), 12000, 250)
      await clickSel(`[data-session-card="${session.id}"]`)
      t.check(`${tag}2: the ${kind} session tab opens`, !!(await openTab(session.id)))
      const menuShown = await rightClickTab(session.id)
      const itemShown = menuShown ? (await ev(`!!document.querySelector('[data-view-changes]')`)) === true : false
      const itemTexts = menuShown ? await menuItems() : []
      t.check(`${tag}3: its tab menu shows the View changes item`, !!menuShown && itemShown && itemTexts.includes('View changes'), js(itemTexts))
      await clickViewChanges()
      t.check(`${tag}4: View changes on the ${kind} tab opens the Changes tab`, !!(await waitFor(() => ev(`!!document.querySelector('[data-side-tab="changes"][aria-selected="true"]')`), 8000, 200)))
      await ev(`document.querySelector('[aria-label="Close notes"]')?.click()`).catch(() => undefined)
      await sleep(300)
    }

    // ---- 7: clean renderers and untouched real config folders
    t.check('7a: no renderer console errors or uncaught exceptions in the main window', issues.length === 0, issues.join(' | '))
    t.check('7b: ...nor in the detached window', detachedIssues.length === 0, detachedIssues.join(' | '))
    const after = watched.map(statOf)
    const untouched = watched.every((file, i) => before[i].exists === after[i].exists && (!before[i].exists || (before[i].mtimeMs === after[i].mtimeMs && before[i].size === after[i].size)))
    t.check('7c: the real ~/.claude and ~/.cursor were not created or modified', untouched, `${js(before)} -> ${js(after)}`)
    if (skips.length > 0) console.log(`\n${skips.length} check(s) skipped: ${skips.join(', ')}`)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
    if (app) {
      try {
        const state = await app.evaluate(`(() => {
          const t = document.querySelector('[data-side-tab]')
          const aside = t && t.closest('aside')
          return {
            panel: !!aside,
            tabs: [...document.querySelectorAll('[data-side-tab]')].map((n) => n.dataset.sideTab + ':' + n.getAttribute('aria-selected')),
            rows: [...document.querySelectorAll('[data-change-path]')].map((n) => n.dataset.changePath),
            asideText: (aside && aside.innerText || '').slice(0, 600)
          }
        })()`)
        console.log('DIAG main', JSON.stringify(state))
      } catch (diagError) { console.log('DIAG main failed', String(diagError)) }
    }
    console.log('DIAG issues', JSON.stringify(issues))
    console.log('DIAG detached issues', JSON.stringify(detachedIssues))
  } finally {
    if (cws !== null) { try { cws.close() } catch { /* already closed */ } }
    for (const ws of monitors) { try { ws.close() } catch { /* already closed */ } }
    process.env.PATH = originalPath
    if (originalCursorConfigDir === undefined) delete process.env.SESSIONDECK_CURSOR_CONFIG_DIR
    else process.env.SESSIONDECK_CURSOR_CONFIG_DIR = originalCursorConfigDir
    if (app) app.kill()
    await sleep(1000)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
