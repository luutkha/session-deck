// E2E: Code mode commit / push / pull request / merge / delete from disk (D60), driven through the Changes panel
// like a user, plus Jarvis's git tools over the real MCP endpoint. Shell sessions only. A bare repository in the temp
// folder plays "origin": the remote URL is a GitHub one (so the PR page is known) and git's pushInsteadOf sends every
// push to the bare repository, so nothing reaches the network. The PR page is written to a file
// (SESSIONDECK_E2E_OPENED_URLS_FILE) instead of opening a browser, and the GitHub CLI is ignored (SESSIONDECK_E2E_NO_GH).
// Run: npx electron-vite build && node scripts/e2e-code-git.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9482
const js = (value) => JSON.stringify(value)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const GITHUB_URL = 'https://github.com/acme/shop.git'

async function main() {
  const t = makeChecker()
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-cgit-')))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const repo = path.join(root, 'shop')
  const origin = path.join(root, 'origin.git')
  fs.mkdirSync(repo)
  git(root, 'init', '-q', '-b', 'main', repo)
  // A repo-local identity: the app's own git commits must work on a PC without a global one.
  git(repo, 'config', 'user.name', 'e2e')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  fs.writeFileSync(path.join(repo, 'README.md'), '# Shop\n')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(repo, 'remote', 'add', 'origin', GITHUB_URL)
  git(repo, 'config', `url.${origin}.pushInsteadOf`, GITHUB_URL)
  git(repo, 'push', '-q', 'origin', 'main')
  const urlsFile = path.join(root, 'opened-urls.txt')
  process.env.SESSIONDECK_E2E_OPENED_URLS_FILE = urlsFile
  process.env.SESSIONDECK_E2E_NO_GH = '1'

  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const store = async () => (await ev('window.api.getStore()')).data
    const point = (x, y) => app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    const clickSel = async (selector, button = 'left') => {
      const r = await ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
      if (r === null) throw new Error(`not found: ${selector}`)
      await point(r.x, r.y)
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button, buttons: 0, clickCount: 1 })
      await sleep(300)
    }
    const notice = () => ev(`(() => { const n = document.querySelector('[data-git-notice]'); return n ? { kind: n.dataset.gitNotice, text: n.innerText } : null })()`)
    const waitNotice = (part) => waitFor(async () => { const n = await notice(); return n !== null && n.text.includes(part) ? n : null }, 20000, 250)
    const confirmDialog = async (action) => {
      await waitFor(() => ev(`!!document.querySelector('[data-git-confirm="${action}"]') || null`), 4000, 150)
      await clickSel('[data-git-confirm-ok]')
    }
    const enabled = (action) => ev(`(() => { const b = document.querySelector('[data-git-action="${action}"]'); return !!b && !b.disabled })()`)

    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(path.join(root, 'wt'))} } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    const created = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'fix login', baseBranch: 'main', agent: 'shell' })`)
    const wt = created.worktree
    t.check('a worktree on branch fix-login', wt.branch === 'fix-login' && fs.existsSync(wt.path))

    // ---- open its session and the Changes tab
    await ev(`(() => { const n = document.querySelector('[data-mode-switch] [data-mode="code"]'); n && n.click() })()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' || null`), 5000, 200)
    await waitFor(() => ev(`!!document.querySelector('[data-session-card="${created.session.id}"]') || null`), 8000, 200)
    await clickSel(`[data-session-card="${created.session.id}"]`)
    const toggle = `document.querySelector('[aria-label="Notes and checklist"]')`
    if ((await ev(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await ev(`${toggle}?.click()`)
    await sleep(400)
    await clickSel('[data-side-tab="changes"]')
    await waitFor(() => ev(`!!document.querySelector('[data-git-branch-line]') || null`), 6000, 200)
    t.check('the Changes tab shows the branch line', (await ev(`document.querySelector('[data-git-branch]')?.innerText`)) === 'fix-login')
    t.check('nothing to commit yet: no commit box, Push off', !(await ev(`!!document.querySelector('[data-git-commit-box]')`)) && !(await enabled('push')))

    // ---- two changes; commit only one
    fs.writeFileSync(path.join(wt.path, 'a.txt'), 'one\ntwo\n')
    fs.writeFileSync(path.join(wt.path, 'new.txt'), 'new\n')
    await clickSel('[aria-label="Refresh changes"]')
    await waitFor(() => ev(`document.querySelectorAll('[data-commit-tick]').length === 2 || null`), 8000, 200)
    t.check('both changed files get a commit tick, both ticked', (await ev(`[...document.querySelectorAll('[data-commit-tick]')].every((n) => n.dataset.state === 'checked')`)) === true)
    await clickSel('[data-commit-tick="new.txt"]')
    t.check('unticking a file leaves "1 of 2"', ((await ev(`document.querySelector('[data-git-chosen]')?.innerText`)) || '').startsWith('1 of 2'))
    t.check('Commit is off without a message', !(await enabled('commit')))
    await ev(`document.querySelector('[data-git-message]').focus()`)
    await app.send('Input.insertText', { text: 'fix: login button' })
    await sleep(200)
    // Ctrl+Enter commits, like the hint says.
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 })
    const committed = await waitNotice('Committed 1 file')
    t.check('Ctrl+Enter commits the ticked file', !!committed && committed.kind === 'ok', js(committed))
    t.check('git has the commit with only a.txt', git(wt.path, 'log', '-1', '--format=%s') === 'fix: login button' && git(wt.path, 'show', '--name-only', '--format=', 'HEAD') === 'a.txt')
    t.check('new.txt stays uncommitted', git(wt.path, 'status', '--porcelain') === '?? new.txt')
    const aRowCommitted = await waitFor(() => ev(`(() => { const n = document.querySelector('[data-change-path="a.txt"]'); return n && n.dataset.uncommitted === undefined && !n.querySelector('[data-commit-tick]') })() || null`), 8000, 200)
    t.check('the committed file stays listed without a tick (not merged yet)', !!aRowCommitted)
    const counts = await waitFor(async () => { const c = await ev(`document.querySelector('[data-git-counts]')?.innerText ?? ''`); return c.includes('↑1') ? c : null }, 8000, 200)
    t.check('the branch line shows ↑1 to push', !!counts, String(counts))

    // ---- push
    t.check('Push is on', await enabled('push'))
    await clickSel('[data-git-action="push"]')
    await confirmDialog('push')
    const pushed = await waitNotice('Pushed fix-login to origin')
    t.check('Push pushes the branch to origin after the confirm', !!pushed && git(origin, 'rev-parse', 'refs/heads/fix-login') === git(wt.path, 'rev-parse', 'HEAD'), js(pushed))
    await waitFor(async () => !(await enabled('push')) || null, 8000, 200)
    t.check('after the push Push is off (up to date)', !(await enabled('push')))

    // ---- commit the second file, then Create PR (pushes first, opens the page)
    t.check('the unticked file stays unticked after the other commit', (await ev(`document.querySelector('[data-commit-tick="new.txt"]')?.dataset.state`)) === 'unchecked')
    await clickSel('[data-commit-tick="new.txt"]')
    await ev(`document.querySelector('[data-git-message]').focus()`)
    await app.send('Input.insertText', { text: 'feat: new file' })
    await sleep(200)
    await clickSel('[data-git-action="commit"]')
    const second = await waitFor(async () => { const n = await notice(); return n !== null && n.text.includes('feat: new file') ? n : null }, 20000, 250)
    t.check('ticking it again and Commit commits it', !!second && git(wt.path, 'status', '--porcelain') === '', js(second))
    await waitFor(() => ev(`(() => { const b = document.querySelector('[data-git-action="pr"]'); return !!b && !b.disabled })() || null`), 8000, 200)
    await clickSel('[data-git-action="pr"]')
    await confirmDialog('pr')
    const pr = await waitNotice('Opened the pull request page')
    const opened = fs.existsSync(urlsFile) ? fs.readFileSync(urlsFile, 'utf8').trim() : ''
    t.check('Create PR opens the GitHub compare page', !!pr && opened === 'https://github.com/acme/shop/compare/main...fix-login?expand=1', opened)
    t.check('...after pushing the new commit first', git(origin, 'rev-parse', 'refs/heads/fix-login') === git(wt.path, 'rev-parse', 'HEAD'))

    // ---- merge into main in the repository folder
    const mergeOn = await waitFor(() => enabled('merge'), 8000, 200)
    if (!mergeOn) console.log('branch status:', js(await ev(`window.api.getWorktreeBranchStatus(${js(wt.id)})`)), git(wt.path, 'status', '--porcelain'))
    t.check('Merge is on once everything is committed', !!mergeOn)
    await clickSel('[data-git-action="merge"]')
    await confirmDialog('merge')
    const merged = await waitNotice('Merged fix-login into main')
    t.check('Merge merges the branch into main in the repository folder', !!merged && git(repo, 'log', '-1', '--format=%P').split(' ').length === 2 && fs.existsSync(path.join(repo, 'new.txt')), js(merged))

    // ---- Jarvis: branch_status and commit_worktree over the MCP endpoint
    const cfg = JSON.parse(fs.readFileSync(path.join(userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })).json()
    const tool = async (name, args) => { const body = await rpc('tools/call', { name, arguments: args }); return { text: body.result.content[0].text, error: body.result.isError === true } }
    const names = (await rpc('tools/list', {})).result.tools.map((x) => x.name)
    t.check('tools/list offers the D60 git tools (85 in all)', names.length === 85 && ['branch_status', 'commit_worktree', 'push_worktree', 'create_pr', 'merge_worktree'].every((n) => names.includes(n)), String(names.length))
    fs.writeFileSync(path.join(wt.path, 'jarvis.txt'), 'from jarvis\n')
    let r = await tool('commit_worktree', { worktree: 'fix login', message: 'chore: jarvis file' })
    t.check('Jarvis commit_worktree commits every uncommitted file', !r.error && git(wt.path, 'log', '-1', '--format=%s') === 'chore: jarvis file' && git(wt.path, 'status', '--porcelain') === '', r.text)
    r = await tool('branch_status', { worktree: 'fix login' })
    t.check('Jarvis branch_status reports 1 commit ahead of the upstream', !r.error && r.text.includes('upstream origin/fix-login: 1 ahead, 0 behind'), r.text)
    await sleep(500)

    // ---- Remove worktree with "also delete from disk"
    // The worktree's header line is the group's first child (its sessions follow below it).
    await clickSel(`[data-worktree-id="${wt.id}"] > :first-child`, 'right')
    await waitFor(() => ev(`!!document.querySelector('[role=menuitem]') || null`), 3000, 100)
    await ev(`[...document.querySelectorAll('[role=menuitem]')].find((n) => n.innerText.includes('Remove worktree'))?.click()`)
    const dialogOpen = await waitFor(() => ev(`!!document.querySelector('[data-remove-worktree-dialog]') || null`), 4000, 150)
    if (!dialogOpen) console.log('menu items:', await ev(`[...document.querySelectorAll('[role=menuitem]')].map((n) => n.innerText).join(' | ')`), 'rows:', await ev(`document.querySelectorAll('[data-worktree-id="${wt.id}"]').length`))
    t.check('the Remove dialog offers "also delete from disk", off by default', (await ev(`document.querySelector('[data-delete-from-disk]')?.dataset.state`)) === 'unchecked')
    await clickSel('[data-delete-from-disk]')
    const warned = await waitFor(() => ev(`document.querySelector('[data-remove-warnings]')?.innerText ?? null`), 5000, 200)
    t.check('it warns that the unmerged jarvis commit will be lost', !!warned && warned.includes('fix-login has commits that main does not have'), String(warned))
    t.check('...and the button says "Delete anyway"', ((await ev(`document.querySelector('[data-remove-confirm]')?.innerText`)) || '').includes('Delete anyway'))
    await clickSel('[data-remove-confirm]')
    const gone = await waitFor(async () => !fs.existsSync(wt.path) && ((await store()).worktrees ?? []).length === 0 || null, 20000, 300)
    if (!gone) console.log('after delete:', js({ folder: fs.existsSync(wt.path), left: fs.existsSync(wt.path) ? fs.readdirSync(wt.path) : [], worktrees: ((await store()).worktrees ?? []).length, banner: await ev(`document.querySelector('[role=alert]')?.innerText ?? null`) }))
    t.check('the worktree is gone from SessionDeck and its folder from disk', !!gone)
    t.check('the branch is deleted too', git(repo, 'branch', '--list', 'fix-login') === '')
    t.check('the repository folder itself is untouched', fs.existsSync(path.join(repo, 'README.md')) && git(repo, 'status', '--porcelain') === '')
  } catch (error) {
    t.check('suite ran without an exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* files may still be held */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
