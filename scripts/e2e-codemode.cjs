// E2E (D31): Code mode. A temp git repo is added, a worktree is created through the real New worktree dialog (the
// branch and folder are checked with git and the file system), a Shell session runs inside it, changes show in the
// Changes tab with a diff, Ops and Code stay separate, the Code window pops out and docks back, and everything survives
// a restart. Worktrees go to a temp folder (Settings > Code), never to the user's home. Takes ~1.5 min.
// Run: node scripts/e2e-codemode.cjs  (E2E_SHOT_DIR=<dir> for screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9411
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

/** Connects to another CDP page target (the popped-out Code window). */
async function connectPage(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  let counter = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++counter; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.result.value
  }
  return { evaluate, send, close: () => ws.close() }
}

async function findCodeWindow() {
  const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  for (const target of targets) {
    const page = await connectPage(target)
    try {
      if ((await page.evaluate('window.api && window.api.windowRole')) === 'code') return page
    } catch { /* not ready yet */ }
    page.close()
  }
  return null
}

function makeRepo(root) {
  const repo = path.join(root, 'my-app')
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n')
  fs.writeFileSync(path.join(repo, 'src', 'app.txt'), 'line one\nline two\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

async function main() {
  const t = makeChecker()
  let app
  let codeWin = null
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-code-'))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  fs.mkdirSync(userData)
  const repo = makeRepo(root)
  const plain = path.join(root, 'plain')
  fs.mkdirSync(plain)
  const js = (value) => JSON.stringify(value)
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const shot = async (page, name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const click = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return false; n.click(); return true })()`)

    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} }, agents: { defaultAgent: 'opencode' } })`)
    const ops = await ev(`window.api.createSession({ cwd: ${js(plain)}, name: 'ops-one', agent: 'opencode' })`)

    // ---- repos
    const added = await ev(`window.api.addRepo(${js(path.join(repo, 'src'))})`)
    t.check('adding a SUBFOLDER adds the repo top level', added.path.toLowerCase() === repo.toLowerCase() && added.name === 'my-app', js(added))
    const again = await ev(`window.api.addRepo(${js(repo)})`)
    t.check('adding the same repo again returns the same repo', again.id === added.id)
    const plainErr = await ev(`window.api.addRepo(${js(plain)}).then(() => 'no error', (e) => String(e.message))`)
    t.check('a plain folder is rejected as not a git repository', plainErr.includes('Not a git repository'), plainErr)
    const branches = await ev(`window.api.getRepoBranches(${js(added.id)})`)
    t.check('branches list the current branch', branches.current === 'main' && branches.branches.includes('main'), js(branches))

    // ---- switch to Code mode
    t.check('the main window has the Ops | Code switch', (await ev('!!document.querySelector("[data-mode-switch]")')) === true)
    await click('[data-mode-switch] [data-mode="code"]')
    const inCode = await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code" && !!document.querySelector(`[data-repo-id]`)'), 5000, 200)
    t.check('clicking Code shows the Code sidebar with the repo', !!inCode)
    t.check('Code mode does not show the Ops session', (await ev('document.body.innerText.includes("ops-one")')) === false)

    // ---- New worktree through the real dialog
    await click(`[aria-label="New worktree in my-app"]`)
    const dialog = await waitFor(() => ev('!!document.querySelector("[data-testid=new-worktree-dialog]")'), 4000, 200)
    t.check('New worktree dialog opens from the repo header', !!dialog)
    await waitFor(() => ev('[...document.querySelectorAll("[aria-label=\\"Base branch\\"]")].some((n) => n.innerText.includes("main"))'), 5000, 200)
    await ev('document.querySelector("input[name=worktree-name]").focus()')
    await app.send('Input.insertText', { text: 'Fix Login' })
    await sleep(300)
    await ev('[...document.querySelectorAll("[data-testid=new-worktree-dialog] button[type=submit]")][0].click()')
    const created = await waitFor(async () => { const d = (await ev('window.api.getStore()')).data; return (d.worktrees ?? []).length === 1 ? d : null }, 15000, 300)
    t.check('Create makes a worktree record', !!created, js(created?.worktrees))
    const wt = created?.worktrees?.[0]
    t.check('the branch is the git-safe name and exists in the repo', wt?.branch === 'fix-login' && git(repo, 'branch', '--list', 'fix-login').includes('fix-login'))
    t.check('the worktree folder is under the configured root and is a linked worktree', !!wt && wt.path.toLowerCase().startsWith(worktreesRoot.toLowerCase()) && fs.existsSync(path.join(wt.path, '.git')) && git(repo, 'worktree', 'list').toLowerCase().includes(path.basename(wt.path).toLowerCase()), wt?.path)
    const firstSession = created?.sessions.find((s) => s.worktreeId === wt?.id)
    t.check('its first session runs in the worktree folder', !!firstSession && firstSession.cwd.toLowerCase() === wt.path.toLowerCase() && firstSession.agent === 'opencode', js(firstSession))
    const dialogClosed = await waitFor(() => ev('!document.querySelector("[data-testid=new-worktree-dialog]")'), 4000, 200)
    t.check('the dialog closes and the worktree row shows', !!dialogClosed && (await ev(`!!document.querySelector('[data-worktree-id="${wt?.id}"]')`)))

    // ---- a Shell session in the worktree writes a file
    const shell = await ev(`window.api.createSession({ cwd: ${js(wt.path)}, agent: 'shell', worktreeId: ${js(wt.id)} })`)
    t.check('a Shell session is created in the worktree', shell.agent === 'shell' && shell.worktreeId === wt.id && shell.name === 'Shell', js(shell))
    await waitFor(async () => (await ev(`window.api.ptyReplay(${js(shell.id)})`)).data.includes('>'), 15000, 300)
    await ev(`window.api.ptyWrite(${js(shell.id)}, 'Set-Content -Path shell-made.txt -Value made-by-shell\\r')`)
    const shellFile = await waitFor(() => fs.existsSync(path.join(wt.path, 'shell-made.txt')), 10000, 300)
    t.check('the Shell (PowerShell) runs inside the worktree folder', !!shellFile)
    fs.writeFileSync(path.join(wt.path, 'src', 'app.txt'), 'line one\nline two changed\nline three\n')

    // ---- changes + diff in the Changes tab
    const changes = await ev(`window.api.getWorktreeChanges(${js(wt.id)})`)
    const byPath = Object.fromEntries(changes.files.map((f) => [f.path, f]))
    t.check('changes list the modified and the untracked file', byPath['src/app.txt']?.kind === 'modified' && byPath['shell-made.txt']?.kind === 'untracked', js(changes.files))
    const badDiff = await ev(`window.api.getWorktreeFileDiff(${js(wt.id)}, '../../secret.txt').then(() => 'no error', (e) => String(e.message))`)
    t.check('a diff for a path outside the changes list is refused', badDiff.includes('not in the changes list'), badDiff)
    const changesInRepo = await ev(`window.api.getWorktreeChanges(${js(wt.id)})`)
    t.check('the main repo is untouched (changes live in the worktree only)', git(repo, 'status', '--porcelain') === '' && changesInRepo.files.length === 2)

    await ev(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('Shell'))?.click()`)
    await sleep(800)
    const toggle = `document.querySelector('[aria-label="Notes and checklist"]')`
    if ((await ev(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await ev(`${toggle}?.click()`)
    await sleep(400)
    await click('[data-side-tab="changes"]')
    const row = await waitFor(() => ev('!!document.querySelector(`[data-change-path="src/app.txt"]`)'), 6000, 200)
    t.check('the Changes tab lists the changed files', !!row)
    await click('[data-change-path="src/app.txt"]')
    const diffText = await waitFor(async () => { const s = await ev('document.body.innerText'); return s.includes('line two changed') ? s : null }, 6000, 200)
    t.check('clicking a file shows its diff', !!diffText && diffText.includes('line three'))
    await shot(app, 'code-changes')
    const counts = await waitFor(() => ev(`document.querySelector('[data-worktree-id="${wt.id}"] [data-worktree-counts]')?.innerText ?? null`), 12000, 400)
    t.check('the worktree row shows change counts', !!counts && counts.includes('+'), String(counts))

    // ---- Ops stays separate, badge for the other mode
    await click('[data-mode-switch] [data-mode="ops"]')
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops"'), 4000, 200)
    const opsText = await ev('document.querySelector("aside")?.innerText ?? ""')
    t.check('Ops mode shows the Ops session and none of the Code sessions', opsText.includes('ops-one') && !opsText.includes('Shell') && !opsText.includes('my-app'), opsText.slice(0, 200))
    await ev(`window.api.markUnread(${js(shell.id)})`)
    const badge = await waitFor(() => ev('document.querySelector("[data-mode-switch] [data-mode=code] [data-mode-badge]")?.innerText ?? null'), 4000, 200)
    t.check('a Code session needing you shows a badge on the Code switch while in Ops', badge === '1', String(badge))
    await shot(app, 'ops-with-badge')

    // ---- pop out the Code window and dock it back
    await click('[data-mode-switch] [data-mode="code"]')
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code"'), 4000, 200)
    await click('[aria-label="Open Code in its own window"]')
    codeWin = await waitFor(() => findCodeWindow(), 15000, 500)
    t.check('Pop out opens a second window with role code', !!codeWin)
    const codeShows = codeWin && await waitFor(() => codeWin.evaluate(`!!document.querySelector('[data-worktree-id="${wt.id}"]') && document.body.innerText.includes('SessionDeck · Code')`), 8000, 300)
    t.check('the Code window shows the Code sidebar and its label', !!codeShows)
    const mainBack = await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops"'), 4000, 200)
    t.check('the main window shows Ops while Code is popped out', !!mainBack)
    if (codeWin) await shot(codeWin, 'code-window')
    if (codeWin) await codeWin.evaluate('document.querySelector("[aria-label=\\"Move Code back to the main window\\"]").click()')
    const docked = await waitFor(async () => (await ev('window.api.getWindowState()')).codePoppedOut === false && (await ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode')) === 'code', 8000, 300)
    t.check('Move back closes the Code window and the main window returns to Code', !!docked)

    // ---- restart keeps repos, worktrees and the mode
    await ev('window.api.quitApp()').catch(() => undefined)
    await sleep(3000)
    app.kill()
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const after = (await app.evaluate('window.api.getStore()')).data
    t.check('after a restart the repo, worktree and its sessions are still there', after.repos?.length === 1 && after.worktrees?.length === 1 && after.sessions.filter((s) => s.worktreeId === wt.id).length === 2)
    const modeAfter = await waitFor(() => app.evaluate('document.querySelector("[data-ui-mode]")?.dataset.uiMode ?? null'), 6000, 200)
    t.check('the main window comes back in Code mode', modeAfter === 'code', String(modeAfter))

    // ---- remove from SessionDeck keeps the folder and branch
    await app.evaluate(`window.api.removeWorktree(${js(wt.id)})`)
    await sleep(800)
    const removed = (await app.evaluate('window.api.getStore()')).data
    t.check('Remove worktree drops it and its sessions from SessionDeck', (removed.worktrees ?? []).length === 0 && !removed.sessions.some((s) => s.worktreeId === wt.id))
    t.check('the folder and the branch stay on disk', fs.existsSync(wt.path) && git(repo, 'branch', '--list', 'fix-login').includes('fix-login'))
  } catch (error) {
    t.check('no unexpected error', false, String(error && error.stack || error))
  } finally {
    if (codeWin) codeWin.close()
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
