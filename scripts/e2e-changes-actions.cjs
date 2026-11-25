// E2E (G8): new Changes actions (discard file / discard hunk), viewed marks + badges, session tags,
// Diagnostics and restored detached windows. The real built app is driven over CDP with real mouse/key input.
// A temp git repo with one worktree and a shell session is prepared before the panel is opened through the
// real tab context menu. Nothing rebuilds out/ and no src/ file is touched. The real ~/.claude and ~/.cursor
// are only watched, never used. Run: node scripts/e2e-changes-actions.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9497
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', '-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8' }).trim()
const PATHS = ['committed.txt', 'fresh.txt', 'gone.txt', 'mod.txt', 'other.txt']
const EDITED = new Set(['mod.txt', 'gone.txt', 'fresh.txt', 'other.txt'])

/** 30 tracked lines; `edited` is the set of 1-based line numbers with uncommitted edits. */
function modContent(edited = []) {
  return Array.from({ length: 30 }, (_, i) => {
    const n = i + 1
    return `line ${String(n).padStart(2, '0')} ${edited.includes(n) ? 'EDITED' : 'original'}\n`
  }).join('')
}
const THREE_EDITS = [3, 15, 27]
const TWO_EDITS = [3, 27]
const staleContent = () => modContent(TWO_EDITS).replace('line 15 original', 'line 15 STALE edit')

function makeRepo(root) {
  const repo = path.join(root, 'my-app')
  fs.mkdirSync(repo, { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  git(repo, 'config', 'core.autocrlf', 'false')
  git(repo, 'config', 'core.eol', 'lf')
  fs.writeFileSync(path.join(repo, 'mod.txt'), modContent())
  fs.writeFileSync(path.join(repo, 'gone.txt'), 'gone original\n')
  fs.writeFileSync(path.join(repo, 'committed.txt'), 'committed original\n')
  fs.writeFileSync(path.join(repo, 'other.txt'), 'other original\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

/** Fake CLIs first on PATH: no real Claude/OpenCode/Cursor is ever started. */
function writeFakeAgents(binDir) {
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'fake-claude.js'), "process.stdout.write('fake claude ready\\r\\n> ')\nprocess.stdin.resume()\nsetInterval(() => {}, 1 << 30)\n")
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n')
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

function statOf(file) {
  try {
    const stat = fs.statSync(file)
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return { exists: false }
  }
}

/** CDP commands in another page (a detached Changes window) over its own socket. */
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

/**
 * /json reports the generic "SessionDeck" title and the same URL for both windows, so identify a
 * detached Changes window by its in-page title strip and split [data-changes-list] column.
 */
async function changesWindowInfo(target) {
  const first = await changesWindowInfoNow(target)
  if (first && first.list) return first
  const deadline = Date.now() + 12000
  let last = first
  while (Date.now() < deadline) {
    await sleep(300)
    last = await changesWindowInfoNow(target)
    if (last && last.list) return last
  }
  return last
}

async function changesWindowInfoNow(target) {
  if (!target || !target.webSocketDebuggerUrl) return null
  try {
    return await evalIn(target.webSocketDebuggerUrl, `(() => {
      const heading = document.querySelector('[data-changes-window-title]')?.textContent ?? ''
      const list = document.querySelector('[data-changes-list]')
      return { title: document.title, heading, list: !!list,
        paths: list ? [...list.querySelectorAll('[data-change-path]')].map((n) => n.getAttribute('data-change-path')) : [] }
    })()`)
  } catch {
    return null
  }
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
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-changesactions-')))
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

  writeFakeAgents(binDir)
  process.env.PATH = binDir + path.delimiter + originalPath
  process.env.SESSIONDECK_CURSOR_CONFIG_DIR = cursorHome

  const pageTargets = async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === 'page' && !x.url.startsWith('devtools'))
    } catch {
      return []
    }
  }
  const pageIds = async () => new Set((await pageTargets()).map((x) => x.id))
  /** Console errors and uncaught exceptions of one renderer, from its own CDP socket. */
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
  // A detached Changes window loads the same index.html with the same title: it is told apart by the launch request the preload exposes.
  const isChangesTarget = async (x) => {
    try { return (await evalIn(x.webSocketDebuggerUrl, 'window.api != null && window.api.changesWindowRequest != null')) === true } catch { return false }
  }
  const attachMain = async () => {
    const targets = await pageTargets()
    // The detached window has the main window's title and URL: only its launch request tells them apart.
    let main = null
    for (const x of targets) if (!(await isChangesTarget(x))) { main = x; break }
    if (main === null) main = targets[0]
    if (cws !== null) { try { cws.close() } catch { /* already closed */ } }
    cws = new WebSocket(main.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { cws.onopen = resolve; cws.onerror = () => reject(new Error('ws error')) })
    await attachMonitor(main.webSocketDebuggerUrl, issues)
    // attachMonitor opened its own socket; this is the command socket of the same page.
  }

  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const mainTargets = await pageTargets()
    cws = new WebSocket(mainTargets[0].webSocketDebuggerUrl)
    await new Promise((resolve) => { cws.onopen = resolve })
    await attachMonitor(mainTargets[0].webSocketDebuggerUrl, issues)

    const ev = (expr) => app.evaluate(expr)
    const center = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height } })()`)
    const mouse = async (x, y, button) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
    }
    /** Wait until the element exists and has a real on-screen point, then use a real mouse click. */
    const clickSel = async (selector) => {
      const p = await waitFor(async () => { const q = await center(selector); return q && q.w > 0 && q.h > 0 ? q : null }, 12000, 200)
      if (p === null) throw new Error(`not found: ${selector}`)
      await mouse(p.x, p.y, 'left')
      await sleep(300)
    }
    const menuOpen = () => ev(`!!document.querySelector('[data-slot="context-menu-content"]')`)
    const menuItems = () => ev(`[...document.querySelectorAll('[data-slot="context-menu-content"] [role=menuitem]')].map((n) => n.innerText.trim())`)
    const rightClickTab = async (id) => {
      const p = await waitFor(async () => {
        const q = await ev(`(() => { const n = document.querySelector('[role=tab][data-tab-id=${js(id)}]'); if (!n) return null; n.scrollIntoView({ inline: 'nearest' }); const r = n.getBoundingClientRect(); return r.width > 0 ? { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) } : null })()`)
        return q ?? null
      }, 12000, 200)
      if (p === null) throw new Error(`no tab for ${id}`)
      await mouse(p.x, p.y, 'right')
      return waitFor(menuOpen, 5000, 100)
    }
    const key = async (name, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, text: name.length === 1 ? name : undefined })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    }
    const typeInto = async (selector, text) => {
      await clickSel(selector)
      await app.send('Input.insertText', { text })
      await sleep(200)
    }
    const rowInfos = () => ev(`[...document.querySelectorAll('section[aria-label="Changes"] [data-change-path]')].map((n) => ({
      path: n.getAttribute('data-change-path'), viewed: n.getAttribute('data-viewed'),
      discard: !!n.querySelector('[data-discard-file]'), tag: !!n.querySelector('[data-viewed-toggle]'), text: n.innerText
    }))`)
    const waitRows = (paths, timeout = 20000) => waitFor(async () => {
      const list = await rowInfos()
      if (!Array.isArray(list) || paths.some((p) => !list.some((r) => r.path === p))) return null
      return list
    }, timeout, 250)
    const rowOf = (list, p) => (Array.isArray(list) ? list.find((r) => r.path === p) ?? null : null)
    const rowGone = (p) => waitFor(async () => (await rowInfos()).every((r) => r.path !== p) ? true : null, 15000, 250)
    const changesText = () => ev(`(document.querySelector('section[aria-label="Changes"]')?.innerText ?? '')`)
    const clickChangesBack = async () => {
      const p = await waitFor(async () => (await ev(`(() => {
        const sec = document.querySelector('section[aria-label="Changes"]')
        const n = [...(sec ? sec.querySelectorAll('button') : [])].find((b) => b.innerText.trim() === 'All files')
        if (!n) return null
        const r = n.getBoundingClientRect()
        return r.width > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null
      })()`)) ?? null, 8000, 200)
      if (p === null) return false
      await mouse(p.x, p.y, 'left')
      await sleep(350)
      return true
    }
    const dialogOpen = () => ev(`!!document.querySelector('[data-discard-confirm]')`)
    const dialogTitle = () => ev(`(document.querySelector('[data-discard-confirm] [role=dialog] h2, [data-discard-confirm] h2, [data-discard-confirm] [data-radix-dialog-title]')?.innerText ?? document.querySelector('[data-discard-confirm]')?.innerText ?? '').split('\\n')[0]`)
    const confirmDiscard = async () => {
      await clickSel('[data-discard-yes]')
      return waitFor(async () => (await dialogOpen()) === false ? true : null, 10000, 250)
    }
    const waitReady = async () => {
      await waitFor(() => ev(`typeof window.api?.getStore === 'function'`), 20000, 250)
    }

    // ---- setup: a temp repo, a worktree, one shell session, and the five prepared file states
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    const created = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'changes actions', baseBranch: 'main', agent: 'shell' })`)
    const wt = created.worktree
    const session = created.session
    t.check('0a: the worktree holds a Shell session in its own folder', !!wt && fs.existsSync(wt.path) && session.worktreeId === wt.id && session.cwd.toLowerCase() === wt.path.toLowerCase(), js({ path: wt?.path }))

    fs.writeFileSync(path.join(wt.path, 'mod.txt'), modContent(THREE_EDITS))
    fs.unlinkSync(path.join(wt.path, 'gone.txt'))
    fs.writeFileSync(path.join(wt.path, 'fresh.txt'), 'fresh untracked\n')
    fs.writeFileSync(path.join(wt.path, 'other.txt'), 'other EDITED\n')
    fs.writeFileSync(path.join(wt.path, 'committed.txt'), 'committed CHANGED and committed\n')
    git(wt.path, 'add', '-A', '--', 'committed.txt')
    git(wt.path, 'commit', '-q', '-m', 'worktree commit')
    const status = git(wt.path, 'status', '--porcelain')
    t.check('0b: git status has the four uncommitted files and no committed.txt', status.split('\n').filter(Boolean).length === 4 && !status.includes('committed.txt') && status.includes('M  mod.txt') === false && /mod\.txt/.test(status) && /gone\.txt/.test(status) && /fresh\.txt/.test(status) && /other\.txt/.test(status), js(status.split('\n').filter(Boolean)))

    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' && !!document.querySelector('[data-session-card=${js(session.id)}]')`), 12000, 200)
    await clickSel(`[data-session-card="${session.id}"]`)
    t.check('0c: the session tab opens', !!(await waitFor(() => ev(`!!document.querySelector('[role=tab][data-tab-id=${js(session.id)}]')`), 12000, 200)))
    t.check('0d: right-clicking the tab opens its menu', !!(await rightClickTab(session.id)))
    t.check('0e: the menu offers View changes', (await menuItems()).includes('View changes'))
    await clickSel('[data-view-changes]')
    t.check('0f: View changes opens the Changes panel', !!(await waitFor(() => ev(`document.querySelector('[data-side-tab="changes"]')?.getAttribute('aria-selected') === 'true'`), 10000, 200)))
    const rows0 = await waitRows(PATHS)
    t.check('0g: the panel lists all five prepared files', !!rows0 && rows0.length === PATHS.length, js(rows0 && rows0.map((r) => r.path)))

    // ---- 1: discard a file (cancel keeps it, confirm reverts it; deleted and untracked too)
    const perRow = Object.fromEntries((rows0 ?? []).map((r) => [r.path, r]))
    t.check('1a: every uncommitted row has a discard button; the committed-only row has none',
      [...EDITED].every((p) => perRow[p]?.discard === true) && perRow['committed.txt']?.discard === false,
      js(rows0 && rows0.map((r) => `${r.path}:${r.discard}`)))

    await clickSel('[data-discard-file="other.txt"]')
    t.check('1b: clicking discard opens the confirmation dialog', !!(await waitFor(dialogOpen, 5000, 150)) && (await dialogTitle()).includes('Discard all changes'))
    await clickSel('[data-discard-cancel]')
    await waitFor(async () => (await dialogOpen()) === false ? true : null, 6000, 150)
    t.check('1c: Cancel leaves other.txt edited on disk', fs.readFileSync(path.join(wt.path, 'other.txt'), 'utf8') === 'other EDITED\n')

    await clickSel('[data-discard-file="other.txt"]')
    await waitFor(dialogOpen, 5000, 150)
    t.check('1d: confirming closes the dialog', !!(await confirmDiscard()))
    const otherBack = await waitFor(() => fs.readFileSync(path.join(wt.path, 'other.txt'), 'utf8') === 'other original\n' ? true : null, 10000, 200)
    t.check('1e: other.txt is back to its committed content and its row disappears', !!otherBack && !!(await rowGone('other.txt')))
    t.check('1f: the sibling mod.txt is untouched by the discard', fs.readFileSync(path.join(wt.path, 'mod.txt'), 'utf8') === modContent(THREE_EDITS))

    await clickSel('[data-discard-file="gone.txt"]')
    await waitFor(dialogOpen, 5000, 150)
    await confirmDiscard()
    const goneBack = await waitFor(() => fs.existsSync(path.join(wt.path, 'gone.txt')) && fs.readFileSync(path.join(wt.path, 'gone.txt'), 'utf8') === 'gone original\n' ? true : null, 10000, 200)
    t.check('1g: discarding gone.txt restores the deleted file and removes its row', !!goneBack && !!(await rowGone('gone.txt')))

    await clickSel('[data-discard-file="fresh.txt"]')
    await waitFor(dialogOpen, 5000, 150)
    const freshTitle = await dialogTitle()
    t.check('1h: the untracked file\'s dialog says it will be deleted', /delete this new file/i.test(freshTitle), freshTitle)
    await confirmDiscard()
    const freshGone = await waitFor(() => !fs.existsSync(path.join(wt.path, 'fresh.txt')) ? true : null, 10000, 200)
    t.check('1i: discarding fresh.txt deletes it and removes its row', !!freshGone && !!(await rowGone('fresh.txt')))
    t.check('1j: mod.txt is still edited after all three discards', fs.readFileSync(path.join(wt.path, 'mod.txt'), 'utf8') === modContent(THREE_EDITS))

    // ---- 2: discard one hunk; then a stale diff must show an error and change nothing on disk
    await clickSel('[data-change-path="mod.txt"]')
    const hunks3 = await waitFor(async () => (await ev(`document.querySelectorAll('[data-discard-hunk]').length`)) === 3 ? 3 : null, 15000, 250)
    t.check('2a: mod.txt has three diff hunks, each with an in-page discard button', !!hunks3)
    // The buttons are opacity 0 until hover, so click them in-page.
    await ev(`document.querySelectorAll('[data-discard-hunk]')[1]?.click()`)
    await waitFor(dialogOpen, 5000, 150)
    t.check('2b: the hunk dialog asks about one change block', /discard this change block/i.test(await dialogTitle()), await dialogTitle())
    await confirmDiscard()
    const hunkDisk = await waitFor(() => fs.readFileSync(path.join(wt.path, 'mod.txt'), 'utf8') === modContent(TWO_EDITS) ? true : null, 12000, 200)
    const hunks2 = await waitFor(async () => (await ev(`document.querySelectorAll('[data-discard-hunk]').length`)) === 2 ? 2 : null, 15000, 250)
    t.check('2c: only line 15 reverted on disk (lines 3 and 27 stay edited) and the diff shows two hunk buttons', !!hunkDisk && !!hunks2, js({ disk: !!hunkDisk, hunks: await ev(`document.querySelectorAll('[data-discard-hunk]').length`) }))

    fs.writeFileSync(path.join(wt.path, 'mod.txt'), staleContent())
    const staleBefore = fs.readFileSync(path.join(wt.path, 'mod.txt'), 'utf8')
    await ev(`document.querySelectorAll('[data-discard-hunk]')[1]?.click()`)
    await waitFor(dialogOpen, 5000, 150)
    await clickSel('[data-discard-yes]')
    const errText = await waitFor(async () => {
      const text = await ev(`(document.querySelector('[data-discard-error]')?.innerText ?? '')`)
      return text.trim() !== '' ? text : null
    }, 10000, 250)
    t.check('2d: a stale hunk discard reports an error in the dialog', !!errText && /no longer matches|changed since/i.test(String(errText)), String(errText))
    await sleep(500)
    t.check('2e: the failed discard leaves the file on disk unchanged', fs.readFileSync(path.join(wt.path, 'mod.txt'), 'utf8') === staleBefore)
    await clickSel('[data-discard-cancel]')
    t.check('2f: Cancel closes the dialog after the error', !!(await waitFor(async () => (await dialogOpen()) === false ? true : null, 6000, 150)))

    // ---- 3: viewed marks survive a reload and are dropped when the file signature changes
    await clickChangesBack()
    await waitRows(['committed.txt', 'mod.txt'])
    t.check('3a: the remaining rows have a viewed toggle', (await rowInfos()).every((r) => r.tag === true))
    await clickSel('[data-viewed-toggle="mod.txt"]')
    const marked = await waitFor(async () => (await ev(`document.querySelector('[data-change-path="mod.txt"]')?.getAttribute('data-viewed')`)) === 'true' ? true : null, 8000, 200)
    const header1 = await waitFor(async () => { const text = await changesText(); return /1 viewed/.test(text) ? text : null }, 8000, 200)
    t.check('3b: clicking the toggle marks mod.txt viewed and the header says "1 viewed"', !!marked && !!header1, String(header1).split('\n')[0])

    await ev(`location.reload(); true`).catch(() => undefined)
    await waitReady()
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' && !!document.querySelector('[data-session-card=${js(session.id)}]')`), 15000, 250).catch(() => null)
    await clickSel(`[data-session-card="${session.id}"]`)
    await rightClickTab(session.id)
    await clickSel('[data-view-changes]')
    const afterReload = await waitFor(async () => {
      const list = await rowInfos()
      const v = await ev(`document.querySelector('[data-change-path="mod.txt"]')?.getAttribute('data-viewed') ?? null`)
      return v === 'true' && list.length > 0 ? true : null
    }, 15000, 250)
    t.check('3c: the viewed mark survives a real page reload', !!afterReload)

    fs.appendFileSync(path.join(wt.path, 'mod.txt'), 'appended by e2e\n')
    await clickSel('[aria-label="Refresh changes"]')
    const unmarked = await waitFor(async () => {
      const v = await ev(`document.querySelector('[data-change-path="mod.txt"]')?.getAttribute('data-viewed') ?? null`)
      return v === null ? true : null
    }, 15000, 250)
    t.check('3d: after the file changes, the next Refresh drops its viewed mark', !!unmarked)

    // ---- 4: the worktree row and the session tab badges follow the viewed state
    const badges = () => ev(`[...document.querySelectorAll('[data-change-badge]')].map((n) => ({
      attr: n.getAttribute('data-change-badge'), text: n.innerText.trim(), title: n.getAttribute('title'),
      inTab: !!n.closest('[data-tab-id]'), inRow: !!n.closest('[data-session-card], [data-worktree-id]')
    }))`)
    const unviewedBadges = await waitFor(async () => {
      const b = await badges()
      return Array.isArray(b) && b.length >= 2 && b.every((x) => x.attr === 'unreviewed' && x.text === '2') &&
        b.some((x) => x.inTab) && b.some((x) => x.inRow) ? b : null
    }, 15000, 250)
    t.check('4a: the sidebar worktree row and the tab both show an amber badge of unreviewed files', !!unviewedBadges, js(unviewedBadges))

    await clickSel('[data-viewed-toggle="mod.txt"]')
    await clickSel('[data-viewed-toggle="committed.txt"]')
    const allViewed = await waitFor(async () => {
      const list = await rowInfos()
      return list.length === 2 && list.every((r) => r.viewed === 'true') ? list : null
    }, 10000, 250)
    const reviewedBadges = await waitFor(async () => {
      const b = await badges()
      return Array.isArray(b) && b.length >= 2 && b.every((x) => x.attr === 'reviewed' && x.text === '2') ? b : null
    }, 15000, 250)
    t.check('4b: marking every file viewed turns both badges to a reviewed badge showing the total', !!allViewed && !!reviewedBadges, js(reviewedBadges))

    // ---- 5: tags in the Notes editor, the sidebar row, the store, the 10-tag cap and sidebar search
    const ensurePanel = async () => {
      await waitFor(() => ev(`!!document.querySelector('[data-session-card=${js(session.id)}]')`), 12000, 250)
      await clickSel(`[data-session-card="${session.id}"]`)
      if ((await ev(`!!document.querySelector('[data-side-tab]')`)) === false) {
        await rightClickTab(session.id)
        await clickSel('[data-view-changes]')
        await waitFor(() => ev(`!!document.querySelector('[data-side-tab]')`), 8000, 200)
      }
    }
    const openNotes = async () => {
      await ensurePanel()
      await clickSel('[data-side-tab="notes"]')
      await waitFor(() => ev(`!!document.querySelector('[data-tag-editor] input[aria-label="Add tag"]')`), 8000, 200)
    }
    const lower = (list) => (Array.isArray(list) ? list.map((x) => String(x).toLowerCase()) : [])
    const storeTags = () => ev(`window.api.getStore().then(({ data }) => (data.sessions.find((s) => s.id === ${js(session.id)})?.tags ?? []).slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())))`)
    const editorTags = () => ev(`[...document.querySelectorAll('[data-tag-editor] [data-tag]')].map((n) => n.getAttribute('data-tag')).sort()`)
    const sidebarTags = () => ev(`[...document.querySelectorAll('[data-session-card=${js(session.id)}] [data-tag]')].map((n) => n.getAttribute('data-tag')).sort()`)
    const addTags = async (text) => {
      await typeInto('[data-tag-editor] input[aria-label="Add tag"]', text)
      await key('Enter', 'Enter', 13)
    }
    await openNotes()
    await addTags('alpha')
    const alpha = await waitFor(async () => {
      const e = await editorTags(); const s = await sidebarTags(); const store = await storeTags()
      return e.includes('alpha') && s.includes('alpha') && store.includes('alpha') ? { e, s, store } : null
    }, 10000, 250)
    t.check('5a: typing alpha + Enter adds a chip in the editor and the sidebar and stores it', !!alpha, js(alpha))

    await addTags('Beta, gamma')
    const three = await waitFor(async () => {
      const e = lower(await editorTags()); const s = lower(await sidebarTags()); const store = lower(await storeTags())
      return ['alpha', 'beta', 'gamma'].every((x) => e.includes(x) && s.includes(x) && store.includes(x)) ? { e, s, store } : null
    }, 10000, 250)
    t.check('5b: "Beta, gamma" adds two chips through the comma and all three persist in the store', !!three, js(three))

    await ev(`location.reload(); true`).catch(() => undefined)
    await waitReady()
    await openNotes()
    const reloaded = await waitFor(async () => {
      const e = lower(await editorTags()); const store = lower(await storeTags())
      return ['alpha', 'beta', 'gamma'].every((x) => e.includes(x) && store.includes(x)) ? { e, store } : null
    }, 12000, 250)
    t.check('5c: all three tags survive a real page reload', !!reloaded, js(reloaded))

    // The editor labels the button with the stored spelling ("Beta"), so find it case-insensitively.
    const betaLabel = await waitFor(async () => {
      const label = await ev(`[...document.querySelectorAll('[data-tag-editor] button[aria-label^="Remove tag "]')].map((n) => n.getAttribute('aria-label')).find((x) => /beta/i.test(x)) ?? null`)
      return label ? label : null
    }, 6000, 200)
    if (betaLabel) await clickSel(`[aria-label="${betaLabel}"]`)
    const removed = await waitFor(async () => {
      const e = lower(await editorTags()); const s = lower(await sidebarTags()); const store = lower(await storeTags())
      return !e.includes('beta') && !s.includes('beta') && !store.includes('beta') && store.includes('alpha') && store.includes('gamma') ? { e, s, store, betaLabel } : null
    }, 10000, 250)
    t.check('5d: the remove button drops beta from the editor, the sidebar and the store', !!removed, js(removed))

    await addTags('t1,t2,t3,t4,t5,t6,t7,t8')
    const ten = await waitFor(async () => {
      const store = await storeTags(); const e = await editorTags()
      return store.length === 10 && e.length === 10 ? { store, e } : null
    }, 12000, 250)
    await addTags('eleven')
    await sleep(800)
    const capped = await storeTags()
    t.check('5e: 10 tags are accepted but the 11th is ignored, without errors', !!ten && capped.length === 10 && !capped.includes('eleven'), js({ first: ten?.store, after: capped }))

    const searchButton = () => ev(`!!document.querySelector('button[aria-label="Search sessions"]')`)
    if ((await searchButton()) !== true) await ev(`document.querySelector('input[aria-label="Search sessions"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`).catch(() => undefined)
    await waitFor(async () => (await searchButton()) === true ? true : null, 5000, 200)
    await clickSel('button[aria-label="Search sessions"]')
    await typeInto('input[aria-label="Search sessions"]', 'gam')
    const searched = await waitFor(async () => {
      const card = await ev(`document.querySelector('[data-session-card=${js(session.id)}]')?.innerText ?? null`)
      return card && /gam/i.test(card) ? card : null
    }, 10000, 250)
    t.check('5f: sidebar search for "gam" still shows the session by its gamma tag', !!searched, String(searched).replace(/\s+/g, ' ').slice(0, 120))
    await key('Escape', 'Escape', 27)
    await sleep(300)

    // ---- 6: Settings > Diagnostics shows tools/folders with statuses and a copy button
    const settingsOpen = () => ev(`[...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('Settings'))`)
    await waitFor(async () => {
      await ev(`(() => { const n = [...document.querySelectorAll('[aria-label="Settings"]')].find((x) => x.getBoundingClientRect().width > 0); if (!n) return false; n.click(); return true })()`)
      return (await settingsOpen()) === true ? true : null
    }, 8000, 300)
    await waitFor(async () => {
      const clicked = await ev(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].find((x) => x.innerText.includes('Settings')); const n = d && [...d.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Diagnostics'); if (!n) return false; n.click(); return true })()`)
      return clicked && (await ev(`!!document.querySelector('[data-diagnostics]')`)) === true ? true : null
    }, 8000, 300)
    t.check('6a: Settings > Diagnostics renders the report', !!(await waitFor(() => ev(`!!document.querySelector('[data-diagnostics]')`), 8000, 200)))
    let gitFound = true
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }) } catch { gitFound = false }
    if (gitFound) {
      const found = await waitFor(() => ev(`!!document.querySelector('[data-diagnostics-tool="git"] [aria-label="found"]')`), 12000, 250)
      t.check('6b: the git tool row shows as found', !!found)
    } else skip('6b: the git tool row shows as found', 'git is not installed on this machine')
    const diagInfo = await waitFor(async () => {
      const b = await ev(`!!document.querySelector('[data-diagnostics-copy]')`)
      const dirs = await ev(`[...document.querySelectorAll('[data-diagnostics-dir]')].map((n) => ({ name: n.getAttribute('data-diagnostics-dir'), status: n.querySelector('[aria-label]')?.getAttribute('aria-label') ?? null }))`)
      return b && Array.isArray(dirs) && dirs.length > 0 && dirs.every((d) => d.status === 'exists' || d.status === 'missing') ? dirs : null
    }, 12000, 250)
    t.check('6c: the copy button is present and folders render with exists/missing status (no config contents)', !!diagInfo, js(diagInfo))
    const diagText = String(await ev(`(document.querySelector('[data-diagnostics]')?.innerText ?? '')`))
    t.check('6d: the report shows folder paths, not raw config file contents', !/mcpServers|"permissions"|"apiKey"/.test(diagText) && /\bFolders\b/.test(diagText), diagText.slice(0, 120).replace(/\s+/g, ' '))
    await key('Escape', 'Escape', 27)
    await waitFor(async () => (await settingsOpen()) === false ? true : null, 5000, 200)

    // ---- 7: a detached window is restored on a graceful restart, and not restored after it is closed
    await ensurePanel()
    await clickSel('[data-side-tab="changes"]')
    await waitRows(['committed.txt', 'mod.txt'])
    const detachedByTitle = async () => {
      for (const x of await pageTargets()) if (await isChangesTarget(x)) return x
      return null
    }
    const beforeDetach = await pageIds()
    await clickSel('[data-changes-detach]')
    const detached = await waitFor(async () => {
      const target = (await pageTargets()).find((x) => !beforeDetach.has(x.id))
      return target && (await isChangesTarget(target)) ? target : null
    }, 20000, 350)
    const detachInfo = detached ? await changesWindowInfo(detached) : null
    t.check('7a: the detach button opens a Changes window for this worktree', !!detachInfo && detachInfo.list === true && /changes/i.test(detachInfo.heading) && detachInfo.heading.includes(wt.name),
      js({ heading: detachInfo?.heading, paths: detachInfo?.paths, targets: (await pageTargets()).map((x) => ({ id: x.id, title: x.title, url: x.url })) }))
    if (detached) await attachMonitor(detached.webSocketDebuggerUrl, detachedIssues)

    const gracefulQuit = async () => {
      // The page may die mid-call (the app is quitting), so the call never answers: do not wait for it.
      // After a restart `app` may be attached to the restored detached window (same title), which 7d closes: ask the main window.
      let mainTarget = null
      for (const x of await pageTargets()) if (!(await isChangesTarget(x))) { mainTarget = x; break }
      if (mainTarget !== null) await Promise.race([evalIn(mainTarget.webSocketDebuggerUrl, 'window.api.quitApp()').catch(() => undefined), sleep(5000)])
      const ended = await waitFor(async () => (await pageTargets()).length === 0 ? true : null, 25000, 300)
      if (!ended) console.log('DIAG targets left after quit', js((await pageTargets()).map((x) => ({ id: x.id, title: x.title }))))
      app.kill()
      await sleep(1200)
      return ended
    }
    t.check('7b: the app exits gracefully through window.api.quitApp()', !!(await gracefulQuit()))

    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    await waitReady()
    await attachMain()
    const restored = await waitFor(async () => await detachedByTitle(), 25000, 400)
    const restoredInfo = restored ? await changesWindowInfo(restored) : null
    t.check('7c: a detached Changes window for the worktree reappears after the restart',
      !!restoredInfo && restoredInfo.list === true && /changes/i.test(restoredInfo.heading) && restoredInfo.heading.includes(wt.name),
      js({ heading: restoredInfo?.heading, paths: restoredInfo?.paths, targets: (await pageTargets()).map((x) => ({ id: x.id, title: x.title, url: x.url })) }))
    if (restored) await attachMonitor(restored.webSocketDebuggerUrl, detachedIssues)

    if (restored) {
      // window.close() goes through the window's normal close event (what the X button does); Target.closeTarget may skip it.
      try { await Promise.race([evalIn(restored.webSocketDebuggerUrl, 'window.close()'), sleep(3000)]) } catch { /* the page is gone */ }
      t.check('7d: closing the restored Changes window removes its target', !!(await waitFor(async () => (await pageIds()).has(restored.id) ? null : true, 10000, 300)))
    } else skip('7d: closing the restored Changes window removes its target', 'no restored window was found')

    t.check('7e: the app exits gracefully a second time', !!(await gracefulQuit()))
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    await waitReady()
    await attachMain()
    await sleep(6000)
    const stillDetached = await detachedByTitle()
    t.check('7f: no detached window is restored after it was closed before the quit', stillDetached === null, js(stillDetached && { id: stillDetached.id, title: stillDetached.title }))

    // ---- final: clean renderer and untouched real config folders (always the last checks)
    t.check('9a: no renderer console errors or uncaught exceptions in the main window', issues.length === 0, issues.join(' | '))
    const after = watched.map(statOf)
    const untouched = watched.every((file, i) => before[i].exists === after[i].exists && (!before[i].exists || (before[i].mtimeMs === after[i].mtimeMs && before[i].size === after[i].size)))
    t.check('9b: the real ~/.claude and ~/.cursor were not created or modified', untouched, `${js(before)} -> ${js(after)}`)
    if (skips.length > 0) console.log(`\n${skips.length} check(s) skipped: ${skips.join(', ')}`)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
    if (app) {
      try {
        const state = await app.evaluate(`(() => ({ rows: [...document.querySelectorAll('[data-change-path]')].map((n) => n.dataset.changePath), dialog: !!document.querySelector('[data-discard-confirm]'), text: (document.querySelector('section[aria-label="Changes"]')?.innerText ?? '').slice(0, 600) }))()`)
        console.log('DIAG main', js(state))
      } catch (diagError) { console.log('DIAG main failed', String(diagError)) }
    }
    console.log('DIAG issues', js(issues))
    console.log('DIAG detached issues', js(detachedIssues))
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
