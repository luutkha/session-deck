// E2E (D58): Jarvis controls the last parts of the app. Tools are called over the real MCP endpoint (the way Claude
// calls them) and every check reads the real window, its storage or the store: sounds, the sidebar list view, terminal
// search, tabs, files into a session, links (a missing one only: nothing is opened on this PC), the app window, the
// Code tree and a changed file in the Changes panel (diff and preview), and restart_jarvis.
// Shell sessions only, no prompt is sent. Run: node scripts/e2e-jarvis-app.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9475
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-japp-'))
  const folder = path.join(root, 'ops')
  fs.mkdirSync(folder)
  const repo = path.join(root, 'shop')
  fs.mkdirSync(repo)
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), '# Shop\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const attachFile = path.join(root, 'notes-for-agent.txt')
  fs.writeFileSync(attachFile, 'hello\n')
  let app
  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => (await ev('window.api.getStore()'))
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => {
      const response = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
      return response.json()
    }
    const tool = async (name, args = {}) => {
      const body = await rpc('tools/call', { name, arguments: args })
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    // Worktrees go in the temp folder, never in the user's ~/SessionDeck.
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(path.join(root, 'wt'))} } })`)
    const asideText = () => ev('document.querySelector("aside")?.innerText ?? ""')

    const names = (await rpc('tools/list', {})).result.tools.map((x) => x.name)
    const added = ['sound_settings', 'sidebar_view', 'code_tree', 'open_file', 'terminal_search', 'switch_tab', 'attach_files', 'open_link', 'app_window', 'restart_jarvis']
    t.check('tools/list offers the D58 tools (75 in all)', names.length === 75 && added.every((n) => names.includes(n)), `${names.length} missing: ${added.filter((n) => !names.includes(n))}`)

    for (const name of ['app alpha', 'app beta']) await tool('create_session', { folder, name, agent: 'shell' })
    await waitFor(async () => (await store()).runtime.filter((r) => r.run === 'running').length >= 2 || null, 15000, 300)
    await tool('open_session', { session: 'app beta' })
    await sleep(600)
    await tool('open_session', { session: 'app alpha' })
    await sleep(800)

    // ---- sounds (the window's own store)
    let r = await tool('sound_settings', { enabled: false, volume: 30, event: 'done', sound: 'marimba' })
    const sound = await waitFor(() => ev('JSON.parse(localStorage.getItem("sessiondeck.sound.v1") || "null")'), 4000, 200)
    t.check('sound_settings saves sounds off, volume 30 and marimba for "done" in the window', !r.error && sound?.enabled === false && Math.abs(sound.volume - 0.3) < 0.01 && js(sound.perReason?.done) === js({ kind: 'builtin', id: 'marimba' }), `${r.text} ${js(sound)}`)
    r = await tool('sound_settings', { event: 'done', sound: 'kazoo' })
    t.check('...and refuses a sound that does not exist', r.error, r.text)
    const shown = await tool('get_screen_state')
    t.check('get_screen_state includes the sounds', /Sounds: off, volume 30%/.test(shown.text) && /done \(turn finished\): marimba/.test(shown.text), shown.text)

    // ---- sidebar list view
    r = await tool('sidebar_view', { search: 'beta' })
    const filtered = await waitFor(async () => { const text = await asideText(); return text.includes('app beta') && !text.includes('app alpha') ? text : null }, 5000, 200)
    t.check('sidebar_view search filters the sidebar list', !r.error && !!filtered, r.text)
    r = await tool('sidebar_view', { search: '', group_by: 'status' })
    const grouped = await waitFor(async () => (await ev('localStorage.getItem("sessiondeck-sidebar-groupby")')) === 'status' && (await asideText()).includes('app alpha') || null, 5000, 200)
    t.check('sidebar_view clears the search and groups by status', !r.error && !!grouped, r.text)
    const state = await tool('get_screen_state')
    t.check('get_screen_state describes the sidebar list', /Sidebar list: grouped by status/.test(state.text), state.text)
    await tool('sidebar_view', { group_by: 'groups' })
    // D61: the sort
    r = await tool('sidebar_view', { sort: 'name' })
    const sortedByName = await waitFor(async () => (await ev('document.querySelector("[data-sort-menu]")?.dataset.sort')) === 'name' || null, 5000, 200)
    const sortState = await tool('get_screen_state')
    t.check('sidebar_view sorts the sessions by name (D61)', !r.error && !!sortedByName && /sorted by Name A–Z/.test(sortState.text), `${r.text} ${sortState.text.slice(0, 200)}`)
    r = await tool('sidebar_view', { sort: 'size' })
    t.check('...and refuses an unknown sort', r.error, r.text)
    await tool('sidebar_view', { sort: 'manual' })

    // ---- tabs
    const activeTab = () => ev('document.querySelector("[data-tab-id][data-active=true]")?.getAttribute("data-tab-id") ?? null')
    const before = await activeTab()
    r = await tool('switch_tab', { op: 'next' })
    const after = await waitFor(async () => { const now = await activeTab(); return now !== null && now !== before ? now : null }, 5000, 200)
    t.check('switch_tab next shows the next tab', !r.error && !!after, `${before} -> ${after} ${r.text}`)
    await tool('open_session', { session: 'app alpha' })
    await sleep(600)

    // ---- terminal search
    const alpha = (await store()).data.sessions.find((s) => s.name === 'app alpha')
    await ev(`window.api.ptyWrite(${js(alpha.id)}, "echo NEEDLE_D58\\r")`)
    await sleep(1500)
    r = await tool('terminal_search', { action: 'find', query: 'NEEDLE_D58' })
    const count = await waitFor(async () => { const text = await ev('document.querySelector("[data-testid=terminal-search-count]")?.innerText ?? ""'); return /\d+\/\d+/.test(text) ? text : null }, 5000, 200)
    const query = await ev('document.querySelector("[aria-label=\\"Find in terminal\\"]")?.value ?? null')
    t.check('terminal_search opens the bar with the query and finds matches', !r.error && query === 'NEEDLE_D58' && !!count, `${r.text} ${query} ${count}`)
    r = await tool('terminal_search', { action: 'close' })
    t.check('terminal_search close hides the bar', !!(await waitFor(() => ev('!document.querySelector("[data-testid=terminal-search]") || null'), 5000, 200)), r.text)

    // ---- files into a session
    r = await tool('attach_files', { session: 'app alpha', paths: [attachFile] })
    const typed = await waitFor(async () => { const screen = await tool('read_screen', { session: 'app alpha', lines: 15 }); return screen.text.includes('notes-for-agent.txt') ? screen.text : null }, 5000, 300)
    t.check('attach_files types the file path into the session prompt', !r.error && !!typed, r.text)
    await ev(`window.api.ptyWrite(${js(alpha.id)}, "\\u0003")`)
    r = await tool('attach_files', { session: 'app alpha', paths: [path.join(root, 'missing.txt')] })
    t.check('...and refuses a path that does not exist', r.error && /Nothing at/.test(r.text), r.text)

    // ---- links: only refused ones (nothing gets opened on this PC)
    r = await tool('open_link', { session: 'app alpha', link: 'no-such-file.txt' })
    t.check('open_link says when a path does not exist', r.error, r.text)

    // ---- the app window
    r = await tool('app_window', { action: 'login_status' })
    t.check('app_window login_status answers (unpackaged: installed app only)', !r.error && /installed app only|Start on login is/.test(r.text), r.text)
    const quit = tool('app_window', { action: 'quit' })
    const asked = await waitFor(() => ev('!!document.querySelector("[role=alertdialog]") || null'), 8000, 200)
    await ev('[...document.querySelectorAll("[role=alertdialog] button")].find((b) => b.innerText.trim() === "Cancel")?.click()')
    const quitAnswer = await quit
    await sleep(2000)
    t.check('app_window quit asks first; Cancel keeps the app running', !!asked && /said no/.test(quitAnswer.text) && (await ev('1 + 1')) === 2, quitAnswer.text)

    // ---- Code mode: the tree and a changed file on screen
    r = await tool('add_repo', { folder: repo })
    r = await tool('create_worktree', { repo: 'shop', name: 'docs fix', agent: 'shell' })
    const wt = (await store()).data.worktrees?.find((w) => w.name === 'docs fix')
    t.check('a worktree to work in', !!wt, r.text)
    fs.writeFileSync(path.join(wt.path, 'README.md'), '# Shop\n\nNew **docs** line.\n')
    await waitFor(async () => { const c = await tool('worktree_changes', { worktree: 'docs fix' }); return c.text.includes('README.md') || null }, 15000, 500)
    r = await tool('open_file', { worktree: 'docs fix', path: 'README.md' })
    const diffShown = await waitFor(() => ev('document.querySelector("section[aria-label=Changes]")?.innerText.includes("New **docs** line.") || null'), 10000, 300)
    t.check('open_file shows the file diff in the Changes panel', !r.error && !!diffShown, r.text)
    r = await tool('open_file', { worktree: 'docs fix', path: 'README.md', view: 'preview' })
    const previewOn = await waitFor(() => ev('document.querySelector("[data-preview-mode=preview]")?.getAttribute("aria-pressed") === "true" || null'), 8000, 300)
    t.check('open_file view preview switches to the rendered preview', !r.error && !!previewOn, r.text)
    r = await tool('code_tree', { action: 'collapse', repo: 'shop' })
    t.check('code_tree collapses a repo in the store', !r.error && (await store()).data.repos?.find((x) => x.name === 'shop')?.collapsed === true, r.text)
    await tool('undo_last_action')
    t.check('...and undo expands it again', (await store()).data.repos?.find((x) => x.name === 'shop')?.collapsed === false)

    // ---- restart_jarvis (fresh): a new Jarvis session appears
    r = await tool('restart_jarvis', { fresh: true })
    const jarvis = await waitFor(async () => (await store()).data.sessions.find((s) => s.role === 'jarvis') ?? null, 15000, 500)
    t.check('restart_jarvis fresh starts a new Jarvis session', !r.error && !!jarvis, r.text)
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold a folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
