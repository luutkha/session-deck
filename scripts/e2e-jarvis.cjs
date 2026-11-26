// E2E (D53): Jarvis's tools against the real built app, called over its MCP endpoint exactly the way Claude calls them,
// plus the UI: the right-side Jarvis panel in Ops and Code mode, Ctrl+Shift+J, the tab-bar button, the in-app Yes/No for
// destructive tools, palette, settings.
// The tool calls use Shell sessions (no model, no quota). Ctrl+Shift+J starts the real `claude` for Jarvis in the run's
// temp profile; no prompt is sent to it. Run: node scripts/e2e-jarvis.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9462
const CTRL = 2
const SHIFT = 8

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-jarvis-'))
  let app
  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => (await ev('window.api.getStore()'))
    const byName = async (name) => (await store()).data.sessions.find((s) => s.name === name)
    const runtimeOf = async (id) => (await store()).runtime.find((r) => r.sessionId === id)
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const center = (expr) => ev(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label) => {
      const point = await waitFor(() => center(expr), 8000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(400)
    }
    const button = (text) => `[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === ${js(text)})`

    // ---- the MCP endpoint (what `claude --mcp-config` is given)
    const cfgFile = path.join(app.userData, 'jarvis', 'mcp.json')
    t.check('the MCP config is written to <userData>/jarvis/mcp.json', fs.existsSync(cfgFile))
    t.check('the system prompt file is written next to it', fs.existsSync(path.join(app.userData, 'jarvis', 'system-prompt.md')))
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params, headers = cfg.headers) => {
      const response = await fetch(cfg.url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
      return { status: response.status, body: response.status === 200 ? await response.json() : null }
    }
    const tool = async (name, args = {}) => {
      const { body } = await rpc('tools/call', { name, arguments: args })
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    t.check('the endpoint listens on 127.0.0.1 only', cfg.url.startsWith('http://127.0.0.1:'))
    t.check('a call without the token is refused (401)', (await rpc('tools/list', {}, {})).status === 401)
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
    t.check('initialize answers with the tools capability', init.body?.result?.capabilities?.tools !== undefined, js(init.body))
    const list = await rpc('tools/list', {})
    const names = list.body.result.tools.map((x) => x.name)
    t.check('every tool is offered (95)', names.length === 95, names.join(','))

    // ---- the pinned sidebar entry before Jarvis exists
    t.check('the tab bar has the Jarvis button, the panel is not open yet', (await waitFor(() => ev(`!!document.querySelector('[data-jarvis-toggle]') || null`), 5000, 200)) === true &&
      (await ev(`document.querySelector('[data-jarvis-panel]')?.getAttribute('data-jarvis-panel') ?? 'none'`)) === 'none')

    // ---- create + first prompt (a Shell session: no model)
    const created = await tool('create_session', { folder, name: 'jv shell', agent: 'shell', prompt: 'echo JARVIS_WAS_HERE' })
    t.check('create_session creates the session and types the first prompt', !created.error && /Created "jv shell"/.test(created.text) && /Typed into the shell/.test(created.text), created.text)
    const shell = await byName('jv shell')
    t.check('...the session is in the store with the folder and agent', !!shell && shell.cwd === folder && shell.agent === 'shell')
    t.check('...and shows in the sidebar like any session', !!(await waitFor(() => ev(`[...document.querySelectorAll('[role=treeitem]')].some((n) => n.innerText.includes('jv shell'))`), 5000, 200)))
    const screen = await waitFor(async () => {
      const r = await tool('read_screen', { session: 'jv shell', lines: 60 })
      return /JARVIS_WAS_HERE\s*\n/.test(r.text.split('----- screen -----')[1] ?? '') ? r.text : null
    }, 15000, 800)
    t.check('read_screen shows the command output as plain text', !!screen && !/\x1b\[/.test(screen), String(screen).slice(-300))

    const listed = await tool('list_sessions')
    t.check('list_sessions lists it as running', /"jv shell" \(id [^)]+\) · shell · running/.test(listed.text), listed.text)

    // ---- D54: wait / last answer / usage / away
    const waited = await tool('wait_for_session', { session: 'jv shell', timeout_seconds: 5 })
    t.check('wait_for_session returns at once for an idle shell, pointing to read_screen', /"jv shell" is running, idle \(waited \d+ s\)\. Use read_screen/.test(waited.text), waited.text)
    const last = await tool('get_last_answer', { session: 'jv shell' })
    t.check('get_last_answer falls back to the screen for a shell', /No saved conversation/.test(last.text) && last.text.includes('JARVIS_WAS_HERE'), last.text.slice(-200))
    const usageText = await tool('get_usage')
    t.check('get_usage answers with the cost of today', !usageText.error && /Cost of all sessions today: \$\d+\.\d\d/.test(usageText.text), usageText.text)
    const awayText = await tool('get_away_summary')
    t.check('get_away_summary answers (none yet in a fresh run)', /No away summary yet/.test(awayText.text), awayText.text)

    // ---- sleep / wake (reconnect)
    const slept = await tool('sleep_session', { session: 'jv shell' })
    t.check('sleep_session puts it to sleep', slept.text === '"jv shell" is asleep.' && !!(await waitFor(async () => (await runtimeOf(shell.id))?.sleeping === true, 5000, 200)), slept.text)
    const woke = await tool('wake_session', { session: 'jv' })
    t.check('wake_session wakes it (partial name)', /waking up/.test(woke.text) && !!(await waitFor(async () => { const r = await runtimeOf(shell.id); return r?.run === 'running' && !r.sleeping }, 8000, 200)), woke.text)

    // ---- organize
    await tool('create_group', { name: 'Jarvis group' })
    const moved = await tool('move_to_group', { session: 'jv shell', group: 'jarvis group' })
    const group = (await store()).data.groups.find((g) => g.name === 'Jarvis group')
    t.check('create_group + move_to_group move the session', !!group && (await byName('jv shell'))?.groupId === group.id, moved.text)
    await tool('rename_session', { session: 'jv shell', name: 'jv shell one' })
    t.check('rename_session renames it', !!(await byName('jv shell one')))

    // ---- ambiguity and Jarvis protection
    await tool('create_session', { folder, name: 'jv shell two', agent: 'shell' })
    const ambiguous = await tool('close_session', { session: 'jv shell' })
    t.check('an ambiguous name is refused with the candidates', ambiguous.error && /matches 2 sessions/.test(ambiguous.text), ambiguous.text)

    // ---- destructive: the user answers in the app
    const pendingNo = tool('remove_session', { session: 'jv shell two' })
    const dialog = await waitFor(() => ev(`document.querySelector('[role=alertdialog]')?.innerText ?? null`), 8000, 200)
    t.check('remove_session asks the user in the app', !!dialog && dialog.includes('Jarvis wants to remove session “jv shell two”'), String(dialog))
    await shot('jarvis-confirm')
    await click(button('Cancel'), 'Cancel')
    const no = await pendingNo
    t.check('Cancel = nothing removed, Jarvis is told', /did not allow/.test(no.text) && !!(await byName('jv shell two')), no.text)
    const pendingYes = tool('remove_session', { session: 'jv shell two' })
    await waitFor(() => ev(`!!document.querySelector('[role=alertdialog]')`), 8000, 200)
    await click(button('Remove'), 'Remove')
    const yes = await pendingYes
    t.check('Remove = the session is removed', yes.text === '"jv shell two" was removed.' && !(await byName('jv shell two')), yes.text)

    // ---- prompts into a sleeping session wake it first
    await tool('sleep_session', { session: 'jv shell one' })
    await waitFor(async () => (await runtimeOf(shell.id))?.sleeping === true, 5000, 200)
    const sent = await tool('send_prompt', { session: 'jv shell one', text: 'echo SECOND_PROMPT' })
    t.check('send_prompt wakes a sleeping session, then types', /^Woke it first\. Typed into the shell/.test(sent.text), sent.text)

    // ---- D54: Code mode tools on a temp git repo (worktrees under a temp root, never the home folder)
    const repoDir = path.join(folder, 'repo-jv')
    const wtRoot = path.join(folder, 'wt')
    fs.mkdirSync(repoDir)
    const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd: repoDir, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\n')
    git('add', '.')
    git('commit', '-m', 'init')
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(wtRoot)} } })`)
    const addedRepo = await tool('add_repo', { folder: repoDir })
    t.check('add_repo adds the repository', /Added repository "repo-jv"/.test(addedRepo.text) && (await store()).data.repos.some((r) => r.name === 'repo-jv'), addedRepo.text)
    const repos = await tool('list_repos')
    t.check('list_repos shows it with its current branch', /repo "repo-jv" .* current branch main · branches: main/.test(repos.text), repos.text)
    const madeWt = await tool('create_worktree', { repo: 'repo-jv', name: 'jv feature', agent: 'shell' })
    const wt = (await store()).data.worktrees.find((w) => w.name === 'jv feature')
    t.check('create_worktree makes the branch + worktree (from main) with a session', !!wt && wt.baseBranch === 'main' && wt.path.toLowerCase().startsWith(wtRoot.toLowerCase()) && fs.existsSync(wt.path) &&
      (await store()).data.sessions.some((s) => s.worktreeId === wt.id), madeWt.text)
    fs.writeFileSync(path.join(wt.path, 'feature.txt'), 'one\ntwo\n')
    fs.writeFileSync(path.join(wt.path, 'README.md'), 'hello\nworld\n')
    const changed = await tool('worktree_changes', { worktree: 'jv feature' })
    t.check('worktree_changes lists the new and the modified file with line counts', /2 file\(s\), \+3 -0/.test(changed.text) && /README\.md \(\+1 -0\)/.test(changed.text) && /feature\.txt \(\+2 -0\)/.test(changed.text), changed.text)
    const pendingWt = tool('remove_worktree', { worktree: 'jv feature' })
    await waitFor(() => ev(`!!document.querySelector('[role=alertdialog]') || null`), 8000, 200)
    await click(button('Remove'), 'Remove worktree')
    const removedWt = await pendingWt
    t.check('remove_worktree (after Yes) removes it from SessionDeck, the folder stays', /was removed/.test(removedWt.text) && !(await store()).data.worktrees.some((w) => w.name === 'jv feature') && fs.existsSync(wt.path), removedWt.text)


    // ---- D54: schedules through the tools and the panel list (no run: the time is hours away)
    const later = new Date(Date.now() + 3 * 3600_000)
    const laterText = `${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}`
    const sched = await tool('schedule_add', { instruction: 'wake jv shell one and run the tests', time: laterText, days: 'weekdays', label: 'e2e schedule' })
    const schedId = /\(id ([^)]+)\)/.exec(sched.text)?.[1]
    t.check('schedule_add stores a schedule', !sched.error && !!schedId && fs.existsSync(path.join(app.userData, 'jarvis', 'schedules.json')), sched.text)
    const schedList = await tool('schedule_list')
    t.check('schedule_list shows it with its next run', schedList.text.includes('"e2e schedule"') && /· next /.test(schedList.text), schedList.text)
    t.check('a bad time is refused', (await tool('schedule_add', { instruction: 'x', time: '9am' })).error)
    // ---- the action log
    const logFile = path.join(app.userData, 'jarvis', 'actions.log')
    const logged = await waitFor(() => (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('remove_session') ? fs.readFileSync(logFile, 'utf8') : null), 3000, 200)
    t.check('actions are written to <userData>/jarvis/actions.log', !!logged && logged.includes('create_session') && logged.includes('sleep_session'))

    // ---- Ctrl+Shift+J opens the Jarvis panel over the current session (real claude, no prompt)
    const panelState = () => ev(`document.querySelector('[data-jarvis-panel]')?.getAttribute('data-jarvis-panel') ?? 'none'`)
    const pressJ = async () => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'J', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: CTRL | SHIFT })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'J', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: CTRL | SHIFT })
      await sleep(300)
    }
    const modeButton = (label) => `[...document.querySelectorAll('[aria-label=Mode] button, [aria-label=Mode] [role=radio]')].find((b) => b.innerText.trim().startsWith(${js(label)}))`
    const tabBefore = await ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)
    await ev('document.activeElement && document.activeElement.blur(); true')
    await pressJ()
    t.check('Ctrl+Shift+J opens the Jarvis panel', (await waitFor(async () => (await panelState()) === 'open' || null, 5000, 200)) === true)
    const jarvis = await waitFor(async () => (await store()).data.sessions.find((s) => s.role === 'jarvis') ?? null, 10000, 300)
    t.check('...creating the Jarvis session (named Jarvis, in <userData>/jarvis)', !!jarvis && jarvis.name === 'Jarvis' && jarvis.cwd === path.join(app.userData, 'jarvis'))
    const panelBox = await waitFor(() => ev(`(() => { const p = document.querySelector('[data-jarvis-panel=open]'); const x = p?.querySelector('.xterm'); if (!p || !x) return null; const a = p.getBoundingClientRect(); const b = x.getBoundingClientRect(); return { right: Math.round(a.right), left: Math.round(a.left), win: window.innerWidth, xw: Math.round(b.width), xh: Math.round(b.height) } })()`), 10000, 300)
    t.check('...on the right side, over the page, with a sized terminal', !!panelBox && panelBox.right === panelBox.win && panelBox.left > panelBox.win / 4 && panelBox.xw > 200 && panelBox.xh > 200, js(panelBox))
    t.check('...without opening a tab: the session on screen stays the same', (await ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)) === tabBefore)
    t.check('Jarvis is never a tab or a sidebar card', !(await ev(`[...document.querySelectorAll('[role=tab]')].some((n) => n.getAttribute('data-tab-id') === ${js(jarvis.id)})`)) &&
      !(await ev(`[...document.querySelectorAll('[role=treeitem]')].some((n) => n.innerText.trim().startsWith('Jarvis'))`)))
    t.check('the tab-bar button shows the panel is open', (await ev(`document.querySelector('[data-jarvis-toggle]')?.getAttribute('aria-pressed')`)) === 'true')
    const ready = await waitFor(async () => {
      const s = strip((await ev(`window.api.ptyReplay(${js(jarvis.id)})`)).data).slice(-3000)
      return /bypass\s*permissions/i.test(s) ? s : null
    }, 60000, 1000)
    t.check('Jarvis\'s Claude starts past the folder-trust question by itself', !!ready)
    t.check('the panel draws the terminal (WebGL canvas, no DOM text to read)', !!(await waitFor(() => ev(`(() => { const c = document.querySelector('[data-jarvis-panel] .xterm-screen canvas'); return c && c.getBoundingClientRect().height > 100 ? true : null })()`), 10000, 300)))
    await shot('jarvis-panel-ops')

    // ---- Code mode: the panel stays open across the mode switch and works there too
    await click(modeButton('Code'), 'Code mode')
    await sleep(800)
    t.check('switching to Code mode keeps the panel open', (await panelState()) === 'open' && !!(await ev(`!!document.querySelector('[data-jarvis-panel=open] .xterm')`)))
    await shot('jarvis-panel-code')
    await click(`document.querySelector('[data-jarvis-toggle]')`, 'Jarvis button (Code)')
    t.check('Code mode has the Jarvis button; it closes the panel', (await waitFor(async () => (await panelState()) === 'closed' || null, 3000, 200)) === true)
    const kept = await ev(`(() => { const x = document.querySelector('[data-jarvis-panel] .xterm'); return x ? Math.round(x.getBoundingClientRect().width) : 0 })()`)
    t.check('closing keeps the terminal at its size (no redraw at a tiny width)', kept > 200, String(kept))
    await pressJ()
    t.check('Ctrl+Shift+J opens it again in Code mode', (await waitFor(async () => (await panelState()) === 'open' || null, 3000, 200)) === true)
    await pressJ()
    t.check('...and closes it', (await waitFor(async () => (await panelState()) === 'closed' || null, 3000, 200)) === true)
    await click(modeButton('Ops'), 'Ops mode')
    await sleep(500)

    // ---- D54: the panel's schedule list (pause, delete)
    await pressJ()
    await waitFor(async () => (await panelState()) === 'open' || null, 3000, 200)
    await click(`document.querySelector('[data-jarvis-schedules]')`, 'Schedules button')
    const row = await waitFor(() => ev(`document.querySelector('[data-schedule-id]')?.innerText ?? null`), 5000, 200)
    t.check('the panel lists the schedule', !!row && row.includes('wake jv shell one and run the tests') && row.includes('weekdays'), String(row))
    await click(`document.querySelector('[data-schedule-id] [aria-label="Pause schedule"]')`, 'Pause')
    const paused = await waitFor(async () => ((await tool('schedule_list')).text.includes('paused') ? true : null), 5000, 300)
    t.check('Pause in the list pauses it', paused === true)
    await click(`document.querySelector('[data-schedule-id] [aria-label="Delete schedule"]')`, 'Delete')
    t.check('Delete in the list removes it', (await waitFor(async () => ((await tool('schedule_list')).text === 'No schedules.' ? true : null), 5000, 300)) === true)
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(300)
    await pressJ()

    // ---- D54: undo from the panel button
    await tool('rename_session', { session: 'jv shell one', name: 'jv renamed' })
    t.check('a tool rename happened', !!(await byName('jv renamed')))
    await pressJ()
    await waitFor(async () => (await panelState()) === 'open' || null, 3000, 200)
    await click(`document.querySelector('[data-jarvis-undo]')`, 'Undo')
    const undoNotice = await waitFor(() => ev(`document.querySelector('[data-jarvis-notice]')?.innerText ?? null`), 5000, 200)
    t.check('the panel Undo button reverts it and says what it undid', !!(await byName('jv shell one')) && !(await byName('jv renamed')) && /Undone: rename "jv shell one" to "jv renamed"/.test(String(undoNotice)), String(undoNotice))
    const viaTool = await tool('undo_last_action')
    t.check('undo_last_action steps further back and says when its target is gone', !viaTool.error && /^(Undone|Could not undo|Nothing to undo)/.test(viaTool.text), viaTool.text)
    await pressJ()

    const again = await ev('window.api.openJarvis()')
    t.check('opening Jarvis again reuses the same session', again.id === jarvis.id && (await store()).data.sessions.filter((s) => s.role === 'jarvis').length === 1)
    const self = await tool('close_session', { session: 'Jarvis' })
    t.check('Jarvis\'s tools cannot act on Jarvis', self.error && /No session matches "Jarvis"/.test(self.text), self.text)

    // ---- palette and settings
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'K', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: CTRL | SHIFT })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'K', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: CTRL | SHIFT })
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]")'), 3000, 100)
    await app.send('Input.insertText', { text: 'jarvis' })
    await sleep(300)
    const items = await ev(`[...document.querySelectorAll('[cmdk-item]')].map((n) => n.innerText)`)
    t.check('the palette offers Open Jarvis and a new Jarvis conversation', items.some((x) => x.includes('Open Jarvis')) && items.some((x) => x.includes('start a new conversation')), js(items))
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    t.check('Jarvis uses Sonnet by default', (await store()).data.settings?.jarvis?.model === undefined || (await store()).data.settings.jarvis.model === 'sonnet')
    const saved = await ev(`window.api.updateSettings({ jarvis: { model: 'opus' } }).then((s) => s.jarvis.model)`)
    t.check('the Jarvis model can be changed', saved === 'opus')
    const refused = await ev(`window.api.updateSettings({ jarvis: { model: 'opus & calc' } }).then(() => 'ok', (e) => String(e.message))`)
    t.check('...but not to something that is not a model name', /Invalid settings: jarvis/.test(refused), refused)

    const reset = await ev('window.api.resetJarvis()')
    t.check('"new conversation" replaces Jarvis with a fresh session', reset.id !== jarvis.id && reset.claudeSessionId !== jarvis.claudeSessionId && (await store()).data.sessions.filter((s) => s.role === 'jarvis').length === 1)

    for (const s of (await store()).data.sessions) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
