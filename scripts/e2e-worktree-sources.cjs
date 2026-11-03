// E2E (D57): Code mode workspaces like Orca, in the built app with a real git repo and the real New worktree dialog:
// a taken name gets -2 (branch and folder), an existing branch opens in its own worktree, a branch open elsewhere is
// refused, and the repository folder itself opens once as a workspace (removing it leaves the folder alone).
// OpenCode sessions, no prompt is sent. Run: node scripts/e2e-worktree-sources.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9474
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-wtsrc-'))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  fs.mkdirSync(userData)
  const repo = path.join(root, 'shop')
  fs.mkdirSync(repo)
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'branch', 'feature-x')
  // git reports the long path; the temp dir may be an 8.3 short name (C:\Users\JOHNSM~1).
  const repoLong = fs.realpathSync.native(repo).toLowerCase()
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const store = async () => (await ev('window.api.getStore()')).data
    const click = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return false; n.click(); return true })()`)
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} }, agents: { defaultAgent: 'opencode' } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    await click('[data-mode-switch] [data-mode="code"]')
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code" && !!document.querySelector("[data-repo-id]") || null'), 5000, 200)

    const openDialog = async () => {
      await click('[aria-label="New worktree in shop"]')
      await waitFor(() => ev('!!document.querySelector("[data-testid=new-worktree-dialog]") || null'), 4000, 200)
      await waitFor(() => ev('[...document.querySelectorAll("[aria-label=\\"Base branch\\"], [aria-label=\\"Branch\\"], [data-testid=new-worktree-main]")].length > 0 || null'), 5000, 200)
      await sleep(400)
    }
    const typeName = async (text) => {
      await ev('document.querySelector("input[name=worktree-name]").focus()')
      await app.send('Input.insertText', { text })
      await sleep(250)
    }
    const submit = () => ev('document.querySelector("[data-testid=new-worktree-dialog] button[type=submit]").click()')
    const worktreeCount = async (n) => waitFor(async () => { const d = await store(); return (d.worktrees ?? []).length === n ? d : null }, 15000, 300)
    const dialogGone = () => waitFor(() => ev('!document.querySelector("[data-testid=new-worktree-dialog]") || null'), 5000, 200)

    // ---- 1. the same name twice: the second gets -2 for branch and folder
    await openDialog()
    await typeName('Fix Login')
    await submit()
    await worktreeCount(1)
    await dialogGone()
    await openDialog()
    await typeName('Fix Login')
    await submit()
    const two = await worktreeCount(2)
    await dialogGone()
    const second = two?.worktrees?.[1]
    t.check('a taken name gets -2 for the worktree, its branch and its folder', second?.name === 'Fix Login-2' && second?.branch === 'fix-login-2' && path.basename(second?.path ?? '') === 'fix-login-2', js(second))
    t.check('...and both branches exist in the repo', git(repo, 'branch', '--list', 'fix-login*').split('\n').length === 2)

    // ---- 2. an existing branch, opened through the dialog
    await openDialog()
    await click('[data-worktree-source="existing"]')
    const shown = await waitFor(() => ev('document.querySelector("[aria-label=\\"Branch\\"]")?.innerText.includes("feature-x") || null'), 5000, 200)
    t.check('Existing branch preselects the first free branch (main is open in the repo folder)', !!shown)
    await submit()
    const three = await worktreeCount(3)
    await dialogGone()
    const reused = three?.worktrees?.find((w) => w.branch === 'feature-x')
    t.check('the existing branch opens in its own worktree, no new branch', !!reused && git(reused.path, 'rev-parse', '--abbrev-ref', 'HEAD') === 'feature-x' && !git(repo, 'branch', '--list').includes('feature-x-2'), js(reused))
    const busy = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'again', baseBranch: 'main', source: 'existing', branch: 'feature-x', agent: 'shell' }).then(() => 'created', (e) => String(e.message))`)
    t.check('a branch open in another worktree is refused, saying where', busy.includes('Branch "feature-x" is already open in'), busy)

    // ---- 3. the repository folder itself
    await openDialog()
    await click('[data-worktree-source="main"]')
    const info = await waitFor(() => ev('document.querySelector("[data-testid=new-worktree-main]")?.innerText ?? null'), 4000, 200)
    t.check('Repo folder explains where sessions run', !!info && info.toLowerCase().includes(repoLong) && info.includes('main'), info)
    await submit()
    const four = await worktreeCount(4)
    await dialogGone()
    const main = four?.worktrees?.find((w) => w.main === true)
    const mainSession = four?.sessions.find((s) => s.worktreeId === main?.id)
    t.check('the repo folder opens as a workspace on its branch, with a session in it', !!main && main.path.toLowerCase() === repoLong && main.branch === 'main' && mainSession?.cwd.toLowerCase() === repoLong, js(main))
    t.check('the sidebar marks it as the repo folder', !!(await waitFor(() => ev(`!!document.querySelector('[data-worktree-id="${main?.id}"] [data-repo-folder]') || null`), 5000, 200)))
    await openDialog()
    await click('[data-worktree-source="main"]')
    await sleep(300)
    const blocked = await ev('({ disabled: document.querySelector("[data-testid=new-worktree-dialog] button[type=submit]").disabled, text: document.querySelector("[data-testid=new-worktree-main]")?.innerText ?? "" })')
    t.check('the repo folder can be opened once: the dialog says it is already open', blocked.disabled === true && blocked.text.includes('already open'), js(blocked))
    await ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await click('[data-testid=new-worktree-dialog] button[type=button]:not([data-worktree-source])')
    await dialogGone()

    await ev(`window.api.removeWorktree(${js(main.id)})`)
    await worktreeCount(3)
    t.check('removing the repo-folder workspace leaves the repository on disk', fs.existsSync(path.join(repo, '.git')) && fs.existsSync(path.join(repo, 'README.md')))
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
