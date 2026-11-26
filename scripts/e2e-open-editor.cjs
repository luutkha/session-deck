// E2E (D89): open a changed file in the editor at a line, from the Changes panel in the built app. A recorder script
// stands in for VS Code (SESSIONDECK_EDITOR_COMMAND), so no real editor opens. Checks: clicking a diff line number
// runs `<editor> --goto <file>:<line>` for the right file and line, the header button opens line 1, a path outside the
// worktree and a deleted file are refused. Run: node scripts/e2e-open-editor.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9483
const js = (value) => JSON.stringify(value)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function main() {
  const t = makeChecker()
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-edit-')))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const repo = path.join(root, 'shop')
  fs.mkdirSync(repo)
  git(root, 'init', '-q', '-b', 'main', repo)
  git(repo, 'config', 'user.name', 'e2e')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  fs.writeFileSync(path.join(repo, 'gone.txt'), 'bye\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const log = path.join(root, 'editor-calls.log')
  const recorder = path.join(root, 'recorder.js')
  fs.writeFileSync(recorder, `require('node:fs').appendFileSync(${js(log)}, JSON.stringify(process.argv.slice(2)) + String.fromCharCode(10))\n`)
  process.env.SESSIONDECK_EDITOR_COMMAND = `node "${recorder}"`
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const clickSel = async (selector) => {
      const r = await ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
      if (r === null) throw new Error(`not found: ${selector}`)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none' })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 })
      await sleep(300)
    }
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(path.join(root, 'wt'))} } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    const created = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'edit me', baseBranch: 'main', agent: 'shell' })`)
    const wt = created.worktree
    fs.writeFileSync(path.join(wt.path, 'a.txt'), 'one\ntwo\nthree\nfour\n')
    fs.rmSync(path.join(wt.path, 'gone.txt'))

    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' || null`), 5000, 200)
    await waitFor(() => ev(`!!document.querySelector('[data-session-card="${created.session.id}"]') || null`), 8000, 200)
    await clickSel(`[data-session-card="${created.session.id}"]`)
    const toggle = `document.querySelector('[aria-label="Notes and checklist"]')`
    if ((await ev(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await ev(`${toggle}?.click()`)
    await sleep(400)
    await clickSel('[data-side-tab="changes"]')
    await clickSel('[aria-label="Refresh changes"]')
    await waitFor(() => ev(`!!document.querySelector('[data-change-path="a.txt"]') || null`), 8000, 200)
    await clickSel('[data-change-path="a.txt"]')
    const lineBtn = await waitFor(() => ev(`!!document.querySelector('[data-open-line="4"]') || null`), 8000, 200)
    t.check('the diff shows a clickable new-side line number', !!lineBtn)

    // ---- a line number opens the file at that line
    await clickSel('[data-open-line="4"]')
    const first = await waitFor(() => (calls().length >= 1 ? calls() : null), 10000, 200)
    t.check('clicking line 4 runs the editor with --goto <file>:4', !!first && first[0][0] === '--goto' && first[0][1].toLowerCase() === `${path.join(wt.path, 'a.txt')}:4`.toLowerCase(), js(first))

    // ---- the header button opens line 1
    await clickSel('[data-open-in-editor]')
    const second = await waitFor(() => (calls().length >= 2 ? calls() : null), 10000, 200)
    t.check('the header button opens the file at line 1', !!second && second[1][1].toLowerCase() === `${path.join(wt.path, 'a.txt')}:1`.toLowerCase(), js(second))

    // ---- refusals: outside the worktree, a deleted file; nothing is run
    const before = calls().length
    const outside = await ev(`window.api.openInEditor(${js(wt.id)}, '../shop/a.txt', 1).then(() => 'opened', (e) => String(e.message))`)
    const missing = await ev(`window.api.openInEditor(${js(wt.id)}, 'gone.txt', 1).then(() => 'opened', (e) => String(e.message))`)
    const unknown = await ev(`window.api.openInEditor('nope', 'a.txt', 1).then(() => 'opened', (e) => String(e.message))`)
    t.check('a path outside the worktree is refused', outside.includes('outside the worktree'), outside)
    t.check('a deleted file is refused', missing.includes('no longer exists'), missing)
    t.check('an unknown worktree is refused', unknown.includes('Worktree not found'), unknown)
    await sleep(500)
    t.check('refusals ran no editor', calls().length === before)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold a folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
