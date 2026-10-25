// E2E (annotate-diffs): in Code mode, comment on a diff line in the Changes panel and send the comments
// into the worktree's session as one ready-to-apply prompt. Real worktree, real file change, real pty:
// the sent prompt text must appear in the session's terminal (replay). Drafts survive a restart; Send is
// disabled for a Shell session and for a sleeping session; an Ops session shows no Changes tab at all.
// Run: node scripts/e2e-annotate.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9447
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

function makeRepo(root) {
  const repo = path.join(root, 'my-app')
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n')
  fs.writeFileSync(path.join(repo, 'src', 'app.txt'), 'line one\nline two\nline three\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-annotate-'))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  fs.mkdirSync(userData)
  const repo = makeRepo(root)
  fs.mkdirSync(path.join(root, 'plain'))
  const js = (value) => JSON.stringify(value)
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const click = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return false; n.click(); return true })()`)
    const replay = async (id) => String((await ev(`window.api.ptyReplay(${js(id)})`)).data)

    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} }, agents: { defaultAgent: 'opencode' } })`)
    await ev(`window.api.createSession({ cwd: ${js(path.join(root, 'plain'))}, name: 'ops-one', agent: 'opencode' })`)
    await ev(`window.api.addRepo(${js(repo)})`)

    // ---- Code mode: repo + worktree through the real dialog
    await click('[data-mode-switch] [data-mode="code"]')
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code" && !!document.querySelector(`[data-repo-id]`)'), 5000, 200)
    await click('[aria-label="New worktree in my-app"]')
    await waitFor(() => ev('!!document.querySelector("[data-testid=new-worktree-dialog]")'), 4000, 200)
    await waitFor(() => ev('[...document.querySelectorAll("[aria-label=\\"Base branch\\"]")].some((n) => n.innerText.includes("main"))'), 5000, 200)
    await ev('document.querySelector("input[name=worktree-name]").focus()')
    await app.send('Input.insertText', { text: 'Annotate It' })
    await sleep(300)
    await ev('[...document.querySelectorAll("[data-testid=new-worktree-dialog] button[type=submit]")][0].click()')
    const created = await waitFor(async () => { const d = (await ev('window.api.getStore()')).data; return (d.worktrees ?? []).length === 1 ? d : null }, 15000, 300)
    const wt = created?.worktrees?.[0]
    t.check('worktree + first session created through the real dialog', !!wt && created.sessions.some((s) => s.worktreeId === wt.id && s.agent === 'opencode'), js(wt))
    const ocSession = created.sessions.find((s) => s.worktreeId === wt.id)
    const ocId = ocSession.id
    // A Shell session in the same worktree (Send must be disabled for it: comments would execute).
    await ev(`window.api.createSession({ cwd: ${js(wt.path)}, agent: 'shell', worktreeId: ${js(wt.id)} })`)
    await sleep(800)

    // A real file change in the worktree (the diff target).
    await waitFor(async () => (await ev(`window.api.getStore()`)).runtime.find((r) => r.sessionId === ocId)?.run === 'running', 40000, 500)
    fs.writeFileSync(path.join(wt.path, 'src', 'app.txt'), 'line one\nline two REVIEW-ME\nline three\n')

    // ---- open the session's Changes panel and the file diff
    // ---- open the session's Changes panel and the file diff (all clicks retry: the panels mount async)
    const clickSessionTree = (name) => ev(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))?.click()`)
    const openNotes = async () => {
      if ((await ev(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await ev(`${toggle}?.click()`)
      await sleep(400)
    }
    /** Retries its way to the open diff of src/app.txt; done when the selector finds its target. */
    const openDiff = async (doneSelector) => {
      await waitFor(async () => {
        if ((await ev('!!document.querySelector(\'[data-side-tab="changes"]\')')) !== true) return null
        if ((await ev('!!document.querySelector(\'[data-change-path="src/app.txt"]\')')) !== true) {
          await ev('document.querySelector(\'[data-side-tab="changes"]\')?.click()')
          return null
        }
        await ev('document.querySelector(\'[data-change-path="src/app.txt"]\')?.click()')
        return (await ev(doneSelector)) === true ? true : null
      }, 15000, 400)
    }
    const annotateButtonsThere = '!!document.querySelector("[aria-label=\\"Comment on this line\\"]")'
    const stripThere = '!!document.querySelector("[data-testid=comments-strip]")'

    await clickSessionTree('annotate-it')
    await sleep(800)
    const toggle = `document.querySelector('[aria-label="Notes and checklist"]')`
    await openNotes()
    await openDiff(annotateButtonsThere)
    t.check('the file diff is open', (await ev(annotateButtonsThere)) === true)

    // ---- annotate two lines through the real UI
    async function annotate(lineIndex, text) {
      await ev(`(() => { const n = document.querySelectorAll('[aria-label="Comment on this line"]')[${String(lineIndex)}]; n.click(); return true })()`)
      await waitFor(() => ev('!!document.querySelector("[aria-label=\\"New comment\\"]")'), 4000, 200)
      // React tracks the textarea value; set it through the NATIVE setter so the input event is not deduped.
      await ev(`(() => {
        const t = document.querySelector('[aria-label="New comment"]')
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(t, ${js(text)})
        t.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Add comment'))?.click()`)
      await sleep(300)
    }
    await annotate(0, 'keep this line exactly as it is')
    await annotate(2, 'this addition needs a guard for empty input')
    const strip = await waitFor(() => ev('document.querySelectorAll("[data-comment-id]").length === 2 ? true : null'), 4000, 300)
    t.check('both comments are chips in the comments strip', !!strip)
    t.check('annotated lines carry the amber marker', (await ev('document.querySelectorAll(\'span[aria-label^="Commented:"]\').length')) === 2)
    t.check('the diff view has no leftover open editor', (await ev('!!document.querySelector("[aria-label=\\"New comment\\"]")')) === false)

    // ---- the draft survives an app restart
    // Quit through the app's real quit IPC: window.close() only hides to the tray (closeToTray default on)
    // and the later kill would still be a hard kill, which can drop the not-yet-committed localStorage write.
    await app.evaluate('window.api.quitApp()').catch(() => undefined)
    await sleep(6000)
    app.kill() // only cleans up stragglers if the app failed to exit by itself
    await sleep(1500)
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    await clickSessionTree('annotate-it')
    await sleep(800)
    await openNotes()
    await openDiff(stripThere)
    t.check('the draft comments survive the restart', (await ev('document.querySelectorAll("[data-comment-id]").length')) === 2)
    t.check('recomputed changes show the staleness notice', (await ev('document.body.innerText.includes("line numbers may have moved")')) === true)

    // ---- send: the prompt text must arrive in the session's terminal, then the strip clears
    await waitFor(async () => (await ev('window.api.getStore()')).runtime.find((r) => r.sessionId === ocId)?.run === 'running', 40000, 500)
    // The restarted TUI needs a moment before it accepts typing (a prompt typed during boot is discarded).
    await waitFor(async () => /opencode|Ask anything|build/i.test(await replay(ocId)), 40000, 500)
    await sleep(1000)
    await waitFor(() => ev('document.querySelector(\'[aria-label="Send comments to the agent"]\')?.disabled === false'), 10000, 300)
    await ev('document.querySelector(\'[aria-label="Send comments to the agent"]\')?.click()')
    const arrived = await waitFor(async () => {
      const r = await replay(ocId)
      return r.includes('Review comments on the current changes (file — line)') && r.includes('this addition needs a guard for empty input') && r.includes('Please apply these fixes.') ? r : null
    }, 10000, 300)
    t.check('Send types the formatted comments into the session', !!arrived)
    t.check('the strip clears after a successful send', (await ev('!!document.querySelector("[data-testid=comments-strip]")')) === false)

    // ---- Send is disabled for a Shell session (a comment would execute as a command)
    await clickSessionTree('Shell')
    await sleep(800)
    await openNotes()
    await openDiff(annotateButtonsThere)
    await annotate(1, 'shell sessions must never get this')
    t.check('Send is disabled for a Shell session', (await ev('document.querySelector(\'[aria-label="Send comments to the agent"]\')?.disabled ?? false')) === true)

    // ---- Send is disabled while the agent session sleeps: the panel stays open and the session is put to
    // sleep through the API (clicking the session would WAKE it — activation resumes it).
    await clickSessionTree('annotate-it')
    await sleep(800)
    await openNotes()
    await openDiff(stripThere)
    t.check('Send is enabled while the agent session runs', (await ev('document.querySelector(\'[aria-label="Send comments to the agent"]\')?.disabled ?? true')) === false,
      String(await ev(`window.api.getStore().then((s) => { const r = s.runtime.find((x) => x.sessionId === ${js(ocId)}); return 'run=' + (r?.run ?? 'gone') + ' sleeping=' + (r?.sleeping ?? 'no') })`)))
    await ev(`window.api.sleepSession(${js(ocId)})`)
    await sleep(1200)
    t.check('Send is disabled while the session sleeps', (await ev('document.querySelector(\'[aria-label="Send comments to the agent"]\')?.disabled ?? true')) === true)
    // Wake again the normal way (activation) for a clean end state.
    await clickSessionTree('annotate-it')
    await waitFor(async () => (await ev('window.api.getStore()')).runtime.find((r) => r.sessionId === ocId)?.run === 'running', 40000, 500)

    // ---- an Ops session (no worktree) has no Changes tab and no annotation UI
    await click('[data-mode-switch] [data-mode="ops"]')
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops"'), 4000, 200)
    await ev(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('ops-one'))?.click()`)
    await sleep(800)
    if ((await ev(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await ev(`${toggle}?.click()`)
    await sleep(300)
    t.check('an Ops session has no Changes tab (no annotation UI at all)', (await ev('!!document.querySelector(\'[data-side-tab="changes"]\')')) === false)  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
