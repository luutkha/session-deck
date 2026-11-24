// E2E for D83: the Changes panel can be detached into its own window (Code mode, real mouse events over CDP).
// A temp git repo gets a worktree session with a modified a.txt and an untracked b.txt; the panel opens on Changes
// through the session tab's "View changes" item, and its detach button must open a second, shell-less window that
// shows the file list and the selected diff side by side, live, one window per worktree, with no comment UI; the side
// panel keeps working; a closed window is forgotten. The renderer console stays clean and the real ~/.claude and
// ~/.cursor are not touched. Takes ~1.5 min.
// Run: node scripts/e2e-changes-detach.cjs  (E2E_SHOT_DIR=<dir> for screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9483
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
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-changesdetach-')))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  fs.mkdirSync(userData)
  const repo = makeRepo(root)
  const js = (value) => JSON.stringify(value)
  const realClaude = path.join(os.homedir(), '.claude')
  const realCursor = path.join(os.homedir(), '.cursor')
  const watched = [realClaude, path.join(realClaude, 'settings.json'), realCursor, path.join(realCursor, 'hooks.json')]
  const before = watched.map(statOf)
  let detach = null

  const pageTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === 'page' && !x.url.startsWith('devtools'))
  const pageIds = async () => new Set((await pageTargets()).map((x) => x.id))
  /** The page's console errors and uncaught exceptions in its own CDP socket (the harness socket ignores them). */
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
    // The 10 s poll can unmount the list for a moment: wait for the point instead of failing on the first miss.
    const clickSel = async (selector) => {
      const p = await waitFor(async () => (await center(selector)) ?? null, 8000, 200)
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
    /** The side panel's file detail has a breadcrumb button back to the changed files ("All files"). */
    const clickChangesBack = async () => {
      const p = await waitFor(async () => (await ev(`(() => {
        const sec = document.querySelector('section[aria-label="Changes"]')
        const n = [...(sec ? sec.querySelectorAll('button') : [])].find((b) => b.innerText.trim() === 'All files')
        if (!n) return null
        const r = n.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      })()`)) ?? null, 4000, 200)
      if (p === null) return false
      await mouse(p.x, p.y, 'left')
      await sleep(350)
      return true
    }
    const sideTabSelected = (tab) => ev(`document.querySelector('[data-side-tab=${js(tab)}]')?.getAttribute('aria-selected') === 'true'`)
    const panelOpen = () => ev(`!!document.querySelector('[data-side-tab]')`)
    const tabActive = (id) => ev(`document.querySelector('[role=tab][data-tab-id=${js(id)}]')?.getAttribute('aria-selected') === 'true'`)
    const openTab = async (id) => waitFor(async () => ((await ev(`!!document.querySelector('[role=tab][data-tab-id=${js(id)}]')`)) ? true : null), 10000, 200)

    /** Real mouse click inside a detached page, located through its own CDP socket. */
    const clickIn = async (wsUrl, selector) => {
      const p = await evalIn(wsUrl, `(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
      if (p === null || p === undefined) throw new Error(`not found in the detached window: ${selector}`)
      await cdpIn(wsUrl, [
        { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' } },
        { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 } },
        { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 } }
      ])
      await sleep(350)
    }
    /** Waits for a NEW page target that was not there before, and attaches the console monitor to it. */
    const waitNewTarget = (known) => waitFor(async () => {
      const target = (await pageTargets()).find((x) => !known.has(x.id))
      if (!target) return null
      detach = target
      await attachMonitor(target.webSocketDebuggerUrl, detachedIssues)
      return target
    }, 20000, 400)
    const detachedReady = (wsUrl) => waitFor(async () => (await evalIn(wsUrl, `!!document.querySelector('[data-changes-list]')`)) === true ? true : null, 15000, 300)
    const detachedTitle = async (wsUrl) => {
      const target = (await pageTargets()).find((x) => x.id === detach.id)
      const parts = [target?.title, await evalIn(wsUrl, 'document.title'), await evalIn(wsUrl, `document.querySelector('[data-changes-window-title]')?.textContent ?? ''`)]
      return parts.filter((p) => typeof p === 'string' && p.length > 0)
    }

    // ---- 1: the temp repo and the worktree session
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
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

    // ---- Code mode, the worktree session tab, panel opened on Changes through the tab menu
    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' && !!document.querySelector('[data-session-card=${js(session1.id)}]')`), 10000, 200)
    await clickSel(`[data-session-card="${session1.id}"]`)
    t.check('1d: clicking the worktree session in the sidebar opens its tab', !!(await openTab(session1.id)))
    t.check('1e: the side panel starts closed', (await panelOpen()) === false)
    t.check('1f: right-clicking the worktree session tab opens its menu', !!(await rightClickTab(session1.id)))
    const items1 = await menuItems()
    t.check('1g: the menu offers View changes', items1.includes('View changes') && (await ev(`!!document.querySelector('[data-view-changes]')`)), js(items1))
    await clickViewChanges()
    const opened = await waitFor(() => ev(`!!document.querySelector('[data-side-tab="changes"][aria-selected="true"]')`), 8000, 200)
    t.check('1h: View changes opens the side panel on its Changes tab', !!opened)
    const bothRows = await waitFor(() => ev(`(() => { const a = document.querySelector('[data-change-path="a.txt"]'); const b = document.querySelector('[data-change-path="b.txt"]'); return a && b ? { a: a.innerText, b: b.innerText } : null })()`), 15000, 250)
    t.check('1i: the main panel lists a.txt and b.txt (with +/- counts)', !!bothRows && /\+\d+/.test(bothRows.a) && /\u2212\d+/.test(bothRows.a) && /\+\d+/.test(bothRows.b) && /\u2212\d+/.test(bothRows.b), js(bothRows))
    await shot('panel-changes')

    // ---- 2: the detach button in the panel header
    const detachBtn = await ev(`(() => { const n = document.querySelector('[data-changes-detach]'); return n ? { label: n.getAttribute('aria-label'), text: n.innerText.trim() } : null })()`)
    t.check('2a: the Changes panel header has a detach button', !!detachBtn, js(detachBtn))
    t.check('2b: ...with the aria-label "Open changes in a separate window"', !!detachBtn && detachBtn.label === 'Open changes in a separate window', js(detachBtn))

    // ---- 3: clicking it opens a NEW page target with only the Changes UI
    const beforeIds = await pageIds()
    await clickSel('[data-changes-detach]')
    const target1 = await waitNewTarget(beforeIds)
    t.check('3a: the detach button opens a second window', !!target1, target1?.url)
    let ws1 = target1?.webSocketDebuggerUrl ?? ''
    t.check('3b: the detached window loads the changes UI', !!(ws1 && await detachedReady(ws1)))
    const shell = ws1 ? await evalIn(ws1, `({ tabs: document.querySelectorAll('[role=tab]').length, cards: document.querySelectorAll('[data-session-card]').length, mode: document.querySelector('[data-ui-mode]') ? true : false })`) : null
    t.check('3c: it has no app shell (no [role=tab], no sidebar session cards, no ui-mode)', !!shell && shell.tabs === 0 && shell.cards === 0 && shell.mode === false, js(shell))
    const detachedRows = ws1 ? await waitFor(async () => {
      const r = await evalIn(ws1, `(() => {
        const list = document.querySelector('[data-changes-list]')
        if (!list) return null
        const rows = [...list.querySelectorAll('[data-change-path]')]
        if (rows.length < 2) return null
        return { paths: rows.map((n) => n.getAttribute('data-change-path')), texts: rows.map((n) => n.innerText), first: rows[0].getAttribute('data-change-path'), body: document.body.innerText }
      })()`)
      return r && r.paths.includes('a.txt') && r.paths.includes('b.txt') ? r : null
    }, 15000, 300) : null
    t.check('3d: the detached [data-changes-list] column has rows for a.txt and b.txt', !!detachedRows, js(detachedRows && detachedRows.paths))
    t.check('3e: both rows carry +/- line counts', !!detachedRows && detachedRows.texts.every((x) => /\+\d+/.test(x) && /\u2212\d+/.test(x)), js(detachedRows && detachedRows.texts))
    t.check('3f: a.txt is the first row', !!detachedRows && detachedRows.first === 'a.txt', String(detachedRows && detachedRows.first))
    // The diff loads after the rows appear: wait for it instead of reading the body once.
    const autoDiff = ws1 ? !!(await waitFor(async () => ((await evalIn(ws1, `document.body.innerText.includes('TWO CHANGED')`)) === true ? true : null), 8000, 250)) : false
    t.check('3g: the first file\'s diff is shown without any click ("TWO CHANGED")', autoDiff)
    await shot('detached-changes', ws1)

    // ---- 4: the window title and no detach button in it
    const titles = ws1 ? await detachedTitle(ws1) : []
    const titleOk = titles.some((x) => /changes/i.test(x) && x.toLowerCase().includes(String(wt.name).toLowerCase()))
    t.check('4a: the window title contains "Changes" and the worktree name', titleOk, js(titles))
    t.check('4b: the detached window has no detach button', ws1 ? (await evalIn(ws1, `!document.querySelector('[data-changes-detach]')`)) === true : false)

    // ---- 5: clicking b.txt switches the right pane, list and diff visible at once
    if (ws1) await clickIn(ws1, '[data-change-path="b.txt"]')
    const bDiff = ws1 ? await waitFor(async () => {
      const r = await evalIn(ws1, `(() => {
        const list = document.querySelector('[data-changes-list]')
        const rows = list ? [...list.querySelectorAll('[data-change-path]')] : []
        const nodes = [...document.querySelectorAll('body *')].filter((n) => n.children.length === 0 && n.textContent.trim() === 'new file' && n.getBoundingClientRect().width > 0)
        const line = nodes[0]
        if (!list || !line) return null
        const l = list.getBoundingClientRect()
        const d = line.getBoundingClientRect()
        return { listW: Math.round(l.width), listRight: Math.round(l.right), lineLeft: Math.round(d.left), body: document.body.innerText, rows: rows.length }
      })()`)
      return r && r.body.includes('new file') ? r : null
    }, 8000, 250) : null
    t.check('5a: clicking the b.txt row shows b.txt\'s content in the right pane', !!bDiff, js(bDiff && { rows: bDiff.rows, listW: bDiff.listW }))
    t.check('5b: the b.txt row is selected (list still has both rows)', !!bDiff && bDiff.rows === 2)
    t.check('5c: list and diff are both visible at once (diff right of the list column)', !!bDiff && bDiff.listW > 100 && bDiff.listRight <= bDiff.lineLeft + 2, js(bDiff && { listW: bDiff.listW, listRight: bDiff.listRight, lineLeft: bDiff.lineLeft }))
    await shot('detached-b-txt', ws1)

    // ---- 6: no comment/annotation affordance in the detached window (also while hovering a diff line)
    const hoverPoint = ws1 ? await evalIn(ws1, `(() => {
      const n = [...document.querySelectorAll('body *')].find((x) => x.children.length === 0 && x.textContent.trim() === 'new file' && x.getBoundingClientRect().width > 0)
      if (!n) return null
      const r = n.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`) : null
    if (ws1 && hoverPoint) {
      await cdpIn(ws1, [
        { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: hoverPoint.x, y: hoverPoint.y } },
        { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: hoverPoint.x + 40, y: hoverPoint.y } }
      ])
      await sleep(350)
    }
    const annotations = ws1 ? await evalIn(ws1, `(() => {
      const sels = ['[data-add-comment]', '[data-comment-add]', '[data-annotation]', '[data-annotations]', '[data-comment-form]', '[aria-label*="omment"]', '[title*="omment"]', 'button[data-comment]']
      const found = sels.filter((s) => document.querySelector(s))
      const text = [...document.querySelectorAll('button,[role=button]')].map((n) => n.innerText.trim().toLowerCase()).filter((x) => x.includes('comment'))
      return { found, text, hovered: true }
    })()`) : null
    t.check('6a: no add-comment affordance in the detached window (even hovering the diff)', !!annotations && annotations.found.length === 0 && annotations.text.length === 0, js(annotations))

    // ---- 7: one window per worktree: asking again focuses the existing one, no second target
    const idsBeforeAgain = await pageIds()
    await clickSel('[data-changes-detach]')
    await sleep(2500)
    const idsAfterAgain = await pageIds()
    t.check('7a: clicking detach again creates no second window', idsAfterAgain.size === idsBeforeAgain.size, `${idsBeforeAgain.size} -> ${idsAfterAgain.size}`)
    t.check('7b: ...and the existing detached window is still the same target', idsAfterAgain.has(detach.id) && [...idsBeforeAgain].every((id) => idsAfterAgain.has(id)), js([...idsAfterAgain]))

    // ---- 8: live data: a file added in the worktree shows up after the refresh button
    fs.appendFileSync(path.join(wt.path, 'a.txt'), 'four\n')
    // The 10 s poll may deliver a file by itself: retry with another name until one is really not listed yet,
    // so the refresh button is what must bring it in.
    const live = { name: null, absent: false }
    for (const name of ['c.txt', 'c2.txt', 'c3.txt']) {
      fs.writeFileSync(path.join(wt.path, name), 'brand new\n')
      const absent = ws1 ? (await evalIn(ws1, `!document.querySelector('[data-change-path=${js(name)}]')`)) === true : false
      if (absent) { live.name = name; live.absent = true; break }
    }
    t.check('8a: the new file is not in the detached list before the refresh', live.absent && live.name === 'c.txt', js(live))
    if (ws1) await clickIn(ws1, '[aria-label="Refresh changes"]')
    const cRow = ws1 && live.name ? await waitFor(async () => (await evalIn(ws1, `document.querySelector('[data-change-path=${js(live.name)}]')?.innerText ?? null`)) || null, 10000, 250) : null
    t.check('8b: the refresh button brings the new file into the detached list', !!cRow, js(cRow))
    const aCount = ws1 ? await evalIn(ws1, `document.querySelector('[data-change-path="a.txt"]')?.innerText ?? ''`) : ''
    t.check('8c: ...and a.txt still lists both files with counts', /\+\d+/.test(aCount) && /\u2212\d+/.test(aCount), js(aCount))
    await shot('detached-after-refresh', ws1)

    // ---- 9: the side panel is still open on Changes and still works
    t.check('9a: the main window\'s side panel is still open on Changes', (await panelOpen()) === true && (await sideTabSelected('changes')) === true)
    await clickSel('[data-change-path="b.txt"]')
    const mainBDiff = await waitFor(() => ev(`document.body.innerText.includes('new file') ? true : null`), 8000, 200)
    t.check('9b: clicking a file row in the side panel still shows its diff', !!mainBDiff)
    // Control for 6a: this very diff in the side panel does offer the line comment affordance.
    t.check('9c: (control) the side panel\'s diff offers the line comment button', (await ev(`!!document.querySelector('[aria-label="Comment on this line"]')`)) === true)
    await clickChangesBack()
    const backList = await waitFor(() => ev(`(() => {
      const rows = [...document.querySelectorAll('[data-change-path]')].map((n) => n.getAttribute('data-change-path'))
      const detail = [...document.querySelectorAll('section[aria-label="Changes"] button')].some((b) => b.innerText.trim() === 'All files')
      return rows.includes('a.txt') && rows.includes('b.txt') && !detail ? true : null
    })()`), 8000, 250)
    t.check('9d: "All files" returns to the changed files list', !!backList)
    await clickSel('[data-change-path="a.txt"]')
    t.check('9e: ...and clicking a.txt shows its diff again', !!(await waitFor(() => ev(`document.body.innerText.includes('TWO CHANGED') ? true : null`), 8000, 200)))

    // ---- 10: a second worktree gets its own window
    const created2 = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'second changes', baseBranch: 'main', agent: 'shell' })`)
    const wt2 = created2.worktree
    const session2 = created2.session
    t.check('10a: a second worktree (branch second-changes) with its own session exists', !!wt2 && wt2.branch === 'second-changes' && wt2.id !== wt.id && session2.worktreeId === wt2.id, js({ branch: wt2?.branch }))
    fs.appendFileSync(path.join(wt2.path, 'a.txt'), 'five\n')
    await waitFor(() => ev(`!!document.querySelector('[data-session-card=${js(session2.id)}]')`), 10000, 250)
    await clickSel(`[data-session-card="${session2.id}"]`)
    await openTab(session2.id)
    await rightClickTab(session2.id)
    await clickViewChanges()
    const panelSwitched = await waitFor(async () => {
      if (!(await ev(`!!document.querySelector('[data-change-path="a.txt"]')`))) return null
      await clickSel('[data-change-path="a.txt"]')
      return (await ev(`document.body.innerText.includes('five') && !document.body.innerText.includes('TWO CHANGED')`)) ? true : null
    }, 10000, 400)
    t.check('10b: View changes switches the panel to the second worktree (its own a.txt diff)', !!panelSwitched)
    const idsBeforeSecond = await pageIds()
    await clickSel('[data-changes-detach]')
    const target2 = await waitFor(async () => (await pageTargets()).find((x) => !idsBeforeSecond.has(x.id)) ?? null, 20000, 400)
    const ws2 = target2?.webSocketDebuggerUrl ?? ''
    if (ws2) await attachMonitor(ws2, detachedIssues)
    t.check('10c: the second worktree gets its own detached window (target count +1)', !!target2 && (await pageIds()).size === idsBeforeSecond.size + 1, `${idsBeforeSecond.size} -> ${(await pageIds()).size}`)
    const ws2Rows = ws2 ? await waitFor(async () => (await evalIn(ws2, `document.querySelector('[data-changes-list] [data-change-path="a.txt"]') && document.body.innerText.includes('five') ? document.title + '|' + document.body.innerText : null`)) || null, 15000, 300) : null
    t.check('10d: that window shows its own worktree\'s changes', !!ws2Rows && ws2Rows.includes('five'), js(ws2Rows && ws2Rows.slice(0, 120)))

    // ---- 11: closing the detached window; detach again opens a fresh one
    const closedId = target1.id
    const otherId = target2?.id ?? null
    const browserUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl
    const [closed] = await cdpIn(browserUrl, [{ method: 'Target.closeTarget', params: { targetId: closedId } }])
    if (!(closed && closed.success)) {
      // Target.closeTarget can refuse an Electron page; the window itself must still close.
      try { await evalIn(target1.webSocketDebuggerUrl, 'window.close()') } catch { /* already gone */ }
    }
    const gone = await waitFor(async () => ((await pageIds()).has(closedId) ? null : true), 8000, 300)
    t.check('11a: closing the detached window removes its page target', !!gone, js({ viaTargetClose: closed?.success === true, targets: [...await pageIds()] }))
    t.check('11b: the other worktree\'s detached window is still there', !!otherId && (await pageIds()).has(otherId), js({ otherId, targets: [...await pageIds()] }))
    await clickChangesBack()
    await clickSel('[data-change-path="a.txt"]')
    const mainStillWorks = await waitFor(() => ev(`document.body.innerText.includes('five') ? true : null`), 8000, 200)
    t.check('11c: the main window still works after the close', !!mainStillWorks)
    // Back to the first worktree's Changes, then detach: the closed window must be forgotten, a new one opens.
    await clickSel(`[data-session-card="${session1.id}"]`)
    await rightClickTab(session1.id)
    await clickViewChanges()
    await waitFor(() => ev(`document.querySelector('[data-change-path=${js(live.name)}]') ? true : null`), 8000, 250)
    const idsBeforeReopen = await pageIds()
    await clickSel('[data-changes-detach]')
    const reopened = await waitFor(async () => (await pageTargets()).find((x) => !idsBeforeReopen.has(x.id)) ?? null, 20000, 400)
    t.check('11d: detaching the closed worktree again opens a new window', !!reopened && reopened.id !== closedId, js({ closedId, reopened: reopened?.id }))
    let ws3 = reopened?.webSocketDebuggerUrl ?? ''
    if (ws3) await attachMonitor(ws3, detachedIssues)
    t.check('11e: the new window shows the first worktree\'s changes', !!ws3 && !!(await waitFor(async () => (await evalIn(ws3, `document.querySelector('[data-change-path=${js(live.name)}]') ? true : null`)) === true ? true : null, 15000, 300)))

    // ---- 13: Dock back focuses a session of the worktree, opens Changes and closes the detached window
    // First put the main window on something else, so the dock back has to change both the tab and the side tab.
    const wtSessions = await ev(`window.api.getStore().then(({ data }) => data.sessions.filter((s) => s.worktreeId === ${js(wt.id)} && s.closedAt === undefined).map((s) => s.id))`)
    await clickSel(`[data-session-card="${session2.id}"]`)
    await openTab(session2.id)
    await clickSel('[data-side-tab="notes"]')
    const showingElse = await waitFor(async () => ((await sideTabSelected('notes')) === true && (await tabActive(session2.id)) === true ? true : null), 8000, 200)
    t.check('13a: before the dock back the main window shows the second worktree on Notes', !!showingElse, js({ notes: await sideTabSelected('notes'), secondTab: await tabActive(session2.id) }))
    const firstTargetId = reopened?.id ?? null
    if (ws3) await evalIn(ws3, `document.querySelector('[data-changes-attach]')?.click()`)
    const dockedGone = firstTargetId ? await waitFor(async () => ((await pageIds()).has(firstTargetId) ? null : true), 12000, 300) : null
    t.check('13b: Dock back closes the detached window (its page target is gone)', !!dockedGone, js({ firstTargetId, targets: [...await pageIds()] }))
    const dockedState = await waitFor(async () => {
      const panel = (await ev(`!!document.querySelector('[data-side-tab="changes"][aria-selected="true"]')`)) === true
      const active = await ev(`document.querySelector('[role=tab][aria-selected="true"]')?.getAttribute('data-tab-id') ?? null`)
      return panel && Array.isArray(wtSessions) && wtSessions.includes(active) ? { panel, active } : null
    }, 12000, 250)
    t.check('13c: ...the main side panel is open on Changes', !!dockedState && dockedState.panel === true)
    t.check('13d: ...and the active tab is a session of that worktree', !!dockedState && wtSessions.includes(dockedState.active), js({ activeTab: dockedState?.active, wtSessions }))
    t.check('13e: the main window has no console errors after the dock back', issues.length === 0, issues.join(' | '))

    // ---- 14: Dock back from a worktree whose only session was closed keeps the window and shows an error
    const openBeforeClose = await ev(`window.api.getStore().then(({ data }) => data.sessions.filter((s) => s.worktreeId === ${js(wt2.id)} && s.closedAt === undefined).map((s) => s.id))`)
    t.check('14a: the second worktree has one open session before it is closed', Array.isArray(openBeforeClose) && openBeforeClose.length === 1, js(openBeforeClose))
    await ev(`window.api.closeSession(${js(session2.id)})`)
    const noOpen = await waitFor(async () => (await ev(`window.api.getStore().then(({ data }) => data.sessions.filter((s) => s.worktreeId === ${js(wt2.id)} && s.closedAt === undefined).length)`)) === 0 ? true : null, 8000, 200)
    t.check('14b: window.api.closeSession leaves that worktree with no open session', !!noOpen)
    if (ws2) await evalIn(ws2, `document.querySelector('[data-changes-attach]')?.click()`)
    const attachError = ws2 ? await waitFor(async () => {
      const text = await evalIn(ws2, `document.querySelector('[data-changes-attach-error]')?.innerText ?? ''`)
      return typeof text === 'string' && text.trim() !== '' ? text : null
    }, 10000, 250) : null
    t.check('14c: Dock back with no open session keeps the detached window open', !!target2 && (await pageIds()).has(target2.id), js({ target2: target2?.id, targets: [...await pageIds()] }))
    t.check('14d: ...and [data-changes-attach-error] shows a message', !!attachError && /no session/i.test(attachError), js(attachError))

    // ---- 15: a detached window remembers its position and size per worktree (D84)
    const idsBeforeMove = await pageIds()
    await clickSel('[data-changes-detach]')
    const movedTarget = await waitFor(async () => (await pageTargets()).find((x) => !idsBeforeMove.has(x.id)) ?? null, 20000, 400)
    const wsMove = movedTarget?.webSocketDebuggerUrl ?? ''
    if (wsMove) await attachMonitor(wsMove, detachedIssues)
    t.check('15a: the first worktree opens a detached window to move', !!movedTarget && !!wsMove && !!(await detachedReady(wsMove)), movedTarget?.url)
    const browserCall = async (method, params) => {
      const [r] = await cdpIn(browserUrl, [{ method, params }])
      return r
    }
    const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 20
    // CDP's Browser.* window calls are not available for Electron windows: move/resize from inside the page (Electron honours moveTo/resizeTo).
    const pageBounds = (ws) => evalIn(ws, '({ left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight })')
    if (wsMove) await evalIn(wsMove, 'window.moveTo(120, 90); window.resizeTo(900, 650)')
    const movedBounds = wsMove ? await waitFor(async () => { const b = await pageBounds(wsMove); return b && near(b.left, 120) && near(b.top, 90) && near(b.width, 900) && near(b.height, 650) ? b : null }, 6000, 250) : null
    t.check('15b: the window was moved/resized to about 120,90 900x650', !!movedBounds, js(wsMove ? await pageBounds(wsMove) : null))
    const boundsFile = path.join(userData, 'changes-windows.json')
    const readBounds = () => {
      try { return JSON.parse(fs.readFileSync(boundsFile, 'utf8')) } catch { return null }
    }
    const saved = await waitFor(() => {
      const map = readBounds()
      const b = map && map[wt.id]
      return b && near(b.width, 900) && near(b.height, 650) && near(b.x, 120) ? b : null
    }, 8000, 250)
    t.check('15c: changes-windows.json saves that worktree at about 900x650', !!saved && near(saved.width, 900) && near(saved.height, 650), js(saved))
    t.check('15d: ...and at about x=120', !!saved && near(saved.x, 120), js(saved))
    const [closedMoved] = await cdpIn(browserUrl, [{ method: 'Target.closeTarget', params: { targetId: movedTarget.id } }])
    if (!(closedMoved && closedMoved.success)) {
      try { await evalIn(wsMove, 'window.close()') } catch { /* already gone */ }
    }
    const movedGone = await waitFor(async () => ((await pageIds()).has(movedTarget.id) ? null : true), 8000, 300)
    t.check('15e: closing the moved window removes its page target', !!movedGone, js({ viaTargetClose: closedMoved?.success === true }))
    const idsBeforeRestore = await pageIds()
    await clickSel('[data-changes-detach]')
    const restoredTarget = await waitFor(async () => (await pageTargets()).find((x) => !idsBeforeRestore.has(x.id)) ?? null, 20000, 400)
    const wsRestored = restoredTarget?.webSocketDebuggerUrl ?? ''
    if (wsRestored) await attachMonitor(wsRestored, detachedIssues)
    t.check('15f: detaching again reopens the first worktree', !!restoredTarget && restoredTarget.id !== movedTarget.id, js({ closed: movedTarget?.id, reopened: restoredTarget?.id }))
    const restoredReady = wsRestored ? !!(await detachedReady(wsRestored)) : false
    const restoredBounds = wsRestored ? await waitFor(async () => { const b = await pageBounds(wsRestored); return b && near(b.left, 120) && near(b.top, 90) && near(b.width, 900) && near(b.height, 650) ? b : null }, 8000, 300) : null
    t.check('15g: the reopened window restores about the same left/top/width/height', !!restoredReady && !!restoredBounds, js(restoredBounds))

    // ---- 16: the saved bounds file holds only well-formed entries
    let rawBounds = null
    try { rawBounds = JSON.parse(fs.readFileSync(boundsFile, 'utf8')) } catch { rawBounds = null }
    const entries = rawBounds && typeof rawBounds === 'object' && !Array.isArray(rawBounds) ? Object.values(rawBounds) : []
    const wellFormed = rawBounds !== null && entries.length > 0 && entries.every((v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 4 && ['x', 'y', 'width', 'height'].every((k) => Number.isInteger(v[k])))
    t.check('16a: changes-windows.json parses and every entry has four integers', wellFormed, js({ keys: rawBounds && Object.keys(rawBounds), entries }))

    // ---- 12: clean renderers and untouched real config folders
    t.check('12a: no renderer console errors or uncaught exceptions in the main window', issues.length === 0, issues.join(' | '))
    t.check('12b: ...nor in the detached windows', detachedIssues.length === 0, detachedIssues.join(' | '))
    const after = watched.map(statOf)
    const untouched = watched.every((file, i) => before[i].exists === after[i].exists && (!before[i].exists || (before[i].mtimeMs === after[i].mtimeMs && before[i].size === after[i].size)))
    t.check('12c: the real ~/.claude and ~/.cursor were not created or modified', untouched, `${js(before)} -> ${js(after)}`)
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
    console.log('DIAG main issues', JSON.stringify(issues))
    console.log('DIAG detached issues', JSON.stringify(detachedIssues))
  } finally {
    if (cws !== null) { try { cws.close() } catch { /* already closed */ } }
    for (const ws of monitors) { try { ws.close() } catch { /* already closed */ } }
    if (app) app.kill()
    await sleep(1000)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
