// E2E: "View changes" in a session TAB's right-click menu (Code mode). A temp git repo gets a worktree session,
// the file list is changed through the file system, and the tab menu is opened with REAL right-clicks over CDP on the
// built app. The menu item must be there only for worktree sessions, and choosing it must activate that tab, leave
// grid/hub for the terminal view, open the side panel on its Changes tab, show the changed files and their diff, and
// widen the panel once from the default 320 to 520 px (a width the user chose is kept). The renderer console must stay
// clean and the real ~/.claude and ~/.cursor must not be touched. Takes ~1 min.
// Run: node scripts/e2e-tab-changes.cjs  (E2E_SHOT_DIR=<dir> for screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9481
const SIDE_PANEL_WIDTH_KEY = 'sessiondeck.sidePanelWidth.v1'
const MODE_KEY = 'sessiondeck.mode.v1'
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

/** Existence, mtime and size of the real user config folders: the run must not change them. */
function statOf(file) {
  try {
    const stat = fs.statSync(file)
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return { exists: false }
  }
}

function makeRepo(root) {
  const repo = path.join(root, 'my-app')
  fs.mkdirSync(repo, { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  // The PC's global git may convert line endings at checkout; the worktree must hold exactly the bytes written.
  git(repo, 'config', 'core.autocrlf', 'false')
  git(repo, 'config', 'core.eol', 'lf')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

async function main() {
  const t = makeChecker()
  let app
  let cws = null
  const issues = []
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-tabchanges-')))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  const plain = path.join(root, 'plain')
  fs.mkdirSync(userData)
  fs.mkdirSync(plain)
  const repo = makeRepo(root)
  const js = (value) => JSON.stringify(value)
  const realClaude = path.join(os.homedir(), '.claude')
  const realCursor = path.join(os.homedir(), '.cursor')
  const watched = [realClaude, path.join(realClaude, 'settings.json'), realCursor, path.join(realCursor, 'hooks.json')]
  const before = watched.map(statOf)

  /** A separate CDP socket for the page's console errors and uncaught exceptions (the harness socket ignores them). */
  const attachConsole = async () => {
    if (cws !== null) { try { cws.close() } catch { /* already closed */ } }
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    const target = targets.find((x) => x.type === 'page' && !x.url.startsWith('devtools'))
    cws = new WebSocket(target.webSocketDebuggerUrl)
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
  }

  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    await attachConsole()
    const ev = (expr) => app.evaluate(expr)
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
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
    const center = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height } })()`)
    /** Waits for a real on-screen box first: a menu item that is still mounting has no clickable centre yet. */
    const clickSel = async (selector) => {
      const p = await waitFor(async () => { const q = await center(selector); return q && q.w > 0 && q.h > 0 ? q : null }, 12000, 200)
      if (p === null) throw new Error(`not found: ${selector}`)
      await mouse(p.x, p.y, 'left')
      await sleep(300)
    }
    const menuOpen = () => ev(`!!document.querySelector('[data-slot="context-menu-content"]')`)
    const menuItems = () => ev(`[...document.querySelectorAll('[data-slot="context-menu-content"] [role=menuitem]')].map((n) => n.innerText.trim())`)
    /** Right-clicks the session tab: the trigger is the tab element itself, like e2e-termmenu does for panes. */
    const rightClickTab = async (id) => {
      const p = await waitFor(() => ev(`(() => { const n = document.querySelector('[role=tab][data-tab-id=${js(id)}]'); if (!n) return null; n.scrollIntoView({ inline: 'nearest' }); const r = n.getBoundingClientRect(); return r.width > 0 ? { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) } : null })()`), 10000, 200)
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
    const panelWidth = () => ev(`(() => { const t = document.querySelector('[data-side-tab]'); const a = t && t.closest('aside'); return a ? Math.round(a.getBoundingClientRect().width) : null })()`)
    const tabActive = (id) => ev(`document.querySelector('[role=tab][data-tab-id=${js(id)}]')?.getAttribute('aria-selected') === 'true'`)
    const openTab = async (id) => waitFor(async () => ((await ev(`!!document.querySelector('[role=tab][data-tab-id=${js(id)}]')`)) ? true : null), 10000, 200)
    const pointerClick = (selector) => ev(`(() => {
      const n = document.querySelector(${js(selector)})
      if (!n) return false
      const r = n.getBoundingClientRect()
      const fire = (type) => n.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: r.x + 2, clientY: r.y + 2, isPrimary: true }))
      fire('pointerdown')
      fire('pointerup')
      return true
    })()`)

    // ---- 1: the temp repo and the worktree session
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
    const opsSession = await ev(`window.api.createSession({ cwd: ${js(plain)}, name: 'ops-one', agent: 'shell' })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    const created = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'view changes', baseBranch: 'main', agent: 'shell' })`)
    const wt = created.worktree
    const session1 = created.session
    t.check('1a: the worktree exists on branch view-changes and holds a Shell session in its folder',
      !!wt && wt.branch === 'view-changes' && fs.existsSync(wt.path) && session1.worktreeId === wt.id &&
      session1.cwd.toLowerCase() === wt.path.toLowerCase(), js({ branch: wt?.branch, path: wt?.path }))
    t.check('1b: the committed a.txt is "one/two/three" in the worktree', fs.readFileSync(path.join(wt.path, 'a.txt'), 'utf8') === 'one\ntwo\nthree\n')
    fs.writeFileSync(path.join(wt.path, 'a.txt'), 'one\nTWO CHANGED\nthree\n')
    fs.writeFileSync(path.join(wt.path, 'b.txt'), 'new file\n')
    const status = git(wt.path, 'status', '--porcelain')
    t.check('1c: the worktree change is exactly modified a.txt + untracked b.txt', status.includes('M a.txt') && status.includes('?? b.txt') && status.split('\n').length === 2, status)
    const session2 = await ev(`window.api.createSession({ cwd: ${js(wt.path)}, name: 'wt two', agent: 'shell', worktreeId: ${js(wt.id)} })`)

    // ---- Code mode, first session tab open, panel closed
    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' && !!document.querySelector('[data-session-card=${js(session1.id)}]')`), 8000, 200)
    await clickSel(`[data-session-card="${session1.id}"]`)
    t.check('1d: clicking the worktree session in the sidebar opens its tab', !!(await openTab(session1.id)))
    t.check('2a: the side panel starts closed', (await panelOpen()) === false)

    // ---- 2: the worktree tab's menu offers "View changes"
    t.check('2b: right-clicking the worktree session tab opens its menu', !!(await rightClickTab(session1.id)))
    const items1 = await menuItems()
    t.check('2c: the menu shows an item with text "View changes"', items1.includes('View changes') && (await ev(`!!document.querySelector('[data-view-changes]')`)), js(items1))
    t.check('2d: the menu still offers Close session (not a stray pane menu)', items1.includes('Close session'), js(items1))
    await shot('tab-menu-view-changes')
    await escape()
    t.check('2e: Escape closes the tab menu', (await menuOpen()) === false)

    // ---- 3: a tab of a session without a worktree (Ops mode) has no "View changes"
    await ev(`document.querySelector('[data-mode-switch] [data-mode="ops"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'ops' && !!document.querySelector('[data-session-card=${js(opsSession.id)}]')`), 8000, 200)
    await clickSel(`[data-session-card="${opsSession.id}"]`)
    t.check('3a: the Ops session opens its own tab', !!(await openTab(opsSession.id)))
    t.check('3b: right-clicking the Ops session tab opens a menu', !!(await rightClickTab(opsSession.id)))
    const itemsOps = await menuItems()
    t.check('3c: the Ops tab menu has no "View changes"', !itemsOps.includes('View changes') && (await ev(`!document.querySelector('[data-view-changes]')`)), js(itemsOps))
    await escape()
    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code'`), 8000, 200)
    await waitFor(() => ev(`!!document.querySelector('[data-tab-id=${js(session1.id)}]')`), 8000, 200)

    // ---- 4 and 8a: View changes opens the panel on Changes, lists both files, widens 320 -> 520 once
    t.check('4a: the panel is still closed before View changes', (await panelOpen()) === false)
    await rightClickTab(session1.id)
    await clickViewChanges()
    const opened = await waitFor(() => ev(`!!document.querySelector('[data-side-tab="changes"]')`), 6000, 200)
    t.check('4b: View changes opens the side panel', !!opened)
    t.check('4c: the panel shows its Changes tab', (await sideTabSelected('changes')) === true)
    t.check('4d: the tab became active', (await tabActive(session1.id)) === true)
    const bothRows = await waitFor(() => ev(`(() => { const a = document.querySelector('[data-change-path="a.txt"]'); const b = document.querySelector('[data-change-path="b.txt"]'); return a && b ? { a: a.innerText, b: b.innerText } : null })()`), 10000, 250)
    t.check('4e: the Changes list shows a.txt and b.txt', !!bothRows, js(bothRows))
    t.check('4f: both rows carry +/- line counts', !!bothRows && /\+\d+/.test(bothRows.a) && /\u2212\d+/.test(bothRows.a) && /\+\d+/.test(bothRows.b) && /\u2212\d+/.test(bothRows.b), js(bothRows))
    const width520 = await waitFor(async () => { const w = await panelWidth(); return w === 520 ? w : null }, 4000, 200)
    const storedWidth = await ev(`localStorage.getItem(${js(SIDE_PANEL_WIDTH_KEY)})`)
    t.check('8a: after the first View changes the panel is 520 px wide (default was 320), and 520 is remembered', width520 === 520 && storedWidth === '520', `width=${String(await panelWidth())} stored=${String(storedWidth)}`)
    await shot('view-changes-panel')

    // ---- 5: another tab active, panel on Notes, View changes on the first tab activates it and shows Changes
    await clickSel(`[data-session-card="${session2.id}"]`)
    t.check('5a: the second session tab becomes active', !!(await waitFor(() => tabActive(session2.id), 5000, 200)))
    await clickSel('[data-side-tab="notes"]')
    t.check('5b: the panel is on Notes before the second View changes', (await sideTabSelected('notes')) === true)
    await rightClickTab(session1.id)
    await clickViewChanges()
    t.check('5c: View changes activates the first session tab', !!(await waitFor(() => tabActive(session1.id), 5000, 200)))
    t.check('5d: ...and the panel is back on Changes', !!(await waitFor(() => sideTabSelected('changes'), 5000, 200)))
    t.check('5e: ...and the open panel is still open', (await panelOpen()) === true)

    // ---- 6: clicking the a.txt row shows its diff with add/remove styling
    await clickSel('[data-change-path="a.txt"]')
    const diffText = await waitFor(async () => { const s = await ev('document.body.innerText'); return s.includes('TWO CHANGED') ? s : null }, 8000, 200)
    t.check('6a: the diff view shows the new line "TWO CHANGED"', !!diffText)
    const diffRows = await ev(`(() => {
      const rows = [...document.querySelectorAll('div')].filter((n) => typeof n.className === 'string' && (n.className.includes('bg-status-success-background') || n.className.includes('bg-destructive/10')))
      const pick = (cls) => rows.filter((n) => n.className.includes(cls) && n.querySelector('span.w-4'))
      const add = pick('bg-status-success-background').find((n) => n.innerText.includes('TWO CHANGED'))
      const del = pick('bg-destructive/10').find((n) => n.innerText.split('\\n').map((s) => s.trim()).includes('two'))
      const marker = (n) => n ? n.querySelector('span.w-4').textContent : null
      return { add: !!add, addMarker: marker(add), del: !!del, delMarker: marker(del), delText: del ? del.innerText : null }
    })()`)
    t.check('6b: the removed "two" line is drawn as a deletion with the "-" marker', diffRows.del === true && diffRows.delMarker === '-', js(diffRows))
    t.check('6c: the added "TWO CHANGED" line is drawn as an addition with the "+" marker', diffRows.add === true && diffRows.addMarker === '+', js(diffRows))
    await shot('view-changes-diff')

    // ---- 7: from the grid view, View changes returns to the terminal view with the panel open
    await pointerClick('[aria-label="Grid view"]')
    await sleep(300)
    await clickSel('[data-grid-preset="2x2"]')
    const gridUp = await waitFor(() => ev(`!!document.querySelector('[data-testid="grid-view"][data-grid-preset="2x2"]')`), 5000, 200)
    t.check('7a: the grid preset 2x2 is on', !!gridUp)
    await rightClickTab(session1.id)
    await clickViewChanges()
    const backToTerminal = await waitFor(() => ev(`!document.querySelector('[data-testid="grid-view"]') && !!document.querySelector('.terminal-workspace:not(.terminal-workspace--grid)')`), 6000, 200)
    t.check('7b: View changes leaves the grid for the terminal view', !!backToTerminal)
    t.check('7c: ...with that tab active and the Changes tab shown', (await tabActive(session1.id)) === true && (await waitFor(() => sideTabSelected('changes'), 4000, 200)) === true)

    // ---- 8b: a width the user chose is kept (fresh start, stored 400 instead of the 320 default)
    await ev(`localStorage.setItem(${js(SIDE_PANEL_WIDTH_KEY)}, '400')`)
    t.check('8b: the mode and the width are remembered for the restart', (await ev(`localStorage.getItem(${js(MODE_KEY)})`)) === 'code' && (await ev(`localStorage.getItem(${js(SIDE_PANEL_WIDTH_KEY)})`)) === '400')
    // A reload re-reads storage and resets the workspace in-memory widened-once flag, like a restart (a killed app can lose a just-written localStorage value).
    await ev('location.reload()').catch(() => undefined)
    await sleep(2500)
    await waitFor(() => app.evaluate(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code'`), 8000, 200)
    const tabBack = await openTab(session1.id)
    t.check('8b2: the reload brings the Code mode and the tab back', !!tabBack)
    // A closed panel makes View changes open it again (the widening rule still sees the stored width). The panel restores
    // asynchronously: wait for it to mount before pressing its X, or the click lands on nothing.
    await waitFor(() => app.evaluate('!!document.querySelector("[data-side-tab]")'), 6000, 200)
    await app.evaluate(`document.querySelector('[aria-label="Close notes"]')?.click()`)
    const closedAgain = await waitFor(() => app.evaluate('!document.querySelector("[data-side-tab]")'), 4000, 200)
    t.check('8c: the panel can be closed before the second run', !!closedAgain)
    await rightClickTab(session1.id)
    await clickViewChanges()
    t.check('8d: View changes after a restart opens the panel on Changes', !!(await waitFor(() => app.evaluate('!!document.querySelector("[data-side-tab=\\"changes\\"][aria-selected=\\"true\\"]")'), 6000, 200)))
    const width400 = await waitFor(async () => { const w = await app.evaluate(`(() => { const t = document.querySelector('[data-side-tab]'); const a = t && t.closest('aside'); return a ? Math.round(a.getBoundingClientRect().width) : null })()`); return w === 400 ? w : null }, 4000, 200)
    const storedAfter = await app.evaluate(`localStorage.getItem(${js(SIDE_PANEL_WIDTH_KEY)})`)
    t.check('8e: the width the user chose (400) is kept, not overridden to 520', width400 === 400 && storedAfter === '400', `width=${String(await app.evaluate(`(() => { const t = document.querySelector('[data-side-tab]'); const a = t && t.closest('aside'); return a ? Math.round(a.getBoundingClientRect().width) : null })()`))} stored=${String(storedAfter)}`)

    // ---- 9: the renderer stayed clean and the real config folders were not touched
    // ---- 10: a sleeping session still gets View changes (Changes reads git, not the process)
    await ev('window.api.sleepSession(' + js(session1.id) + ')').catch(() => undefined)
    const asleep = await waitFor(() => ev(`!!document.querySelector('[role=tab][data-tab-id=${js(session1.id)}] [aria-label="Sleeping"]')`), 8000, 200)
    t.check('10a: the worktree session is asleep', !!asleep)
    await ev(`document.querySelector('[aria-label="Close notes"]')?.click()`)
    await sleep(300)
    await rightClickTab(session1.id)
    const sleepItems = await ev(`Array.from(document.querySelectorAll('[data-slot="context-menu-content"] [role=menuitem]')).map((n) => n.textContent.trim())`)
    t.check('10b: a sleeping tab menu offers View changes', Array.isArray(sleepItems) && sleepItems.includes('View changes'), js(sleepItems))
    await clickViewChanges()
    t.check('10c: ...and it opens the Changes tab with the changed files', (await waitFor(() => sideTabSelected('changes'), 5000, 200)) === true && !!(await waitFor(() => ev(`document.body.innerText.includes('a.txt') && document.body.innerText.includes('b.txt')`), 5000, 200)))
    // ---- 11: the same item in the right-click menu of the session in the Code sidebar
    await ev(`document.querySelector('[aria-label="Close notes"]')?.click()`)
    await waitFor(async () => (await panelOpen()) ? null : true, 4000, 200)
    const session3 = await ev(`window.api.createSession({ cwd: ${js(wt.path)}, name: 'wt three', agent: 'shell', worktreeId: ${js(wt.id)} })`)
    await waitFor(() => ev(`!!document.querySelector('[data-session-card=${js(session3.id)}]')`), 6000, 200)
    t.check('11-: the third session has no tab yet', (await ev(`!document.querySelector('[role=tab][data-tab-id=${js(session3.id)}]')`)) === true)
    const cardPoint = await center(`[data-session-card="${session3.id}"]`)
    if (cardPoint !== null) await mouse(cardPoint.x, cardPoint.y, 'right')
    await waitFor(menuOpen, 3000, 100)
    const cardItems = await menuItems()
    t.check('11a: the sidebar session menu offers View changes', Array.isArray(cardItems) && cardItems.includes('View changes'), js(cardItems))
    await clickViewChanges()
    t.check('11b: ...and it opens that session on its Changes tab', (await waitFor(() => sideTabSelected('changes'), 5000, 200)) === true && (await tabActive(session3.id)) === true)
    t.check('9a: no renderer console errors or uncaught exceptions during the run', issues.length === 0, issues.join(' | '))
    const after = watched.map(statOf)
    const untouched = watched.every((file, i) => before[i].exists === after[i].exists && (!before[i].exists || (before[i].mtimeMs === after[i].mtimeMs && before[i].size === after[i].size)))
    t.check('9b: the real ~/.claude and ~/.cursor were not created or modified', untouched, `${js(before)} -> ${js(after)}`)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (cws !== null) { try { cws.close() } catch { /* already closed */ } }
    if (app) app.kill()
    await sleep(1000)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
