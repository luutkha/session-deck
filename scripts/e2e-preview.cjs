// E2E (rich previews, Code mode): a real worktree with a .md and a .png change; the Changes panel gains a
// Diff | Preview toggle for previewable files. Markdown renders sanitized through [data-markdown]; images
// render as data URLs; an oversized file is flagged; a traversal request is refused; Ops has no toggle.
// Run: node scripts/e2e-preview.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9449
const CLEANUP_ATTEMPTS = 6
const CLEANUP_RETRY_MS = 500
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

function makeRepo(root) {
  const repo = path.join(root, 'my-app')
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

// A real, decodable 8x8 PNG (RGB, opaque red): 8 rows of filter byte 0 + 8 red pixels.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

/** Electron/opencode children can hold the temp dir briefly after taskkill; retry instead of crashing the run. */
async function removeTempDir(dir) {
  for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === CLEANUP_ATTEMPTS - 1) {
        process.stderr.write(`temp cleanup skipped: ${error.message}\n`)
        return
      }
      await sleep(CLEANUP_RETRY_MS)
    }
  }
}

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-preview-'))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  fs.mkdirSync(userData)
  fs.mkdirSync(path.join(root, 'plain'))
  const repo = makeRepo(root)
  const js = (value) => JSON.stringify(value)
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const click = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return false; n.click(); return true })()`)

    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} }, agents: { defaultAgent: 'opencode' } })`)
    await ev(`window.api.createSession({ cwd: ${js(path.join(root, 'plain'))}, name: 'ops-one', agent: 'opencode' })`)
    await ev(`window.api.addRepo(${js(repo)})`)

    // ---- Code mode + worktree through the real dialog
    await click('[data-mode-switch] [data-mode="code"]')
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code" && !!document.querySelector(`[data-repo-id]`)'), 5000, 200)
    await click('[aria-label="New worktree in my-app"]')
    await waitFor(() => ev('!!document.querySelector("[data-testid=new-worktree-dialog]")'), 4000, 200)
    await waitFor(() => ev('[...document.querySelectorAll("[aria-label=\\"Base branch\\"]")].some((n) => n.innerText.includes("main"))'), 5000, 200)
    await ev('document.querySelector("input[name=worktree-name]").focus()')
    await app.send('Input.insertText', { text: 'Docs' })
    await sleep(300)
    await ev('[...document.querySelectorAll("[data-testid=new-worktree-dialog] button[type=submit]")][0].click()')
    const created = await waitFor(async () => { const d = (await ev('window.api.getStore()')).data; return (d.worktrees ?? []).length === 1 ? d : null }, 15000, 300)
    const wt = created?.worktrees?.[0]
    t.check('worktree created through the real dialog', !!wt, js(wt))
    const wtSession = created.sessions.find((s) => s.worktreeId === wt.id)
    await waitFor(async () => (await ev('window.api.getStore()')).runtime.find((r) => r.sessionId === wtSession.id)?.run === 'running', 40000, 500)

    // ---- real changes: an untracked markdown, an untracked png, and an oversized markdown
    fs.writeFileSync(path.join(wt.path, 'NOTES.md'), '# Preview Heading\n\nSome rendered text with a **bold** part.\n')
    fs.writeFileSync(path.join(wt.path, 'shot.png'), Buffer.from(PNG, 'base64'))
    const bigLines = []
    for (let index = 0; index < 9500; index++) bigLines.push(`big ${String(index)} ${'x'.repeat(50)}`)
    fs.writeFileSync(path.join(wt.path, 'BIG.md'), bigLines.join('\n') + '\n')

    // ---- open the session's Changes panel
    const toggle = `document.querySelector('[aria-label="Notes and checklist"]')`
    /** Retries its way to the file list, selects the file and waits until the diff view shows its path. */
    const openFileDiff = async (pathName) => {
      await waitFor(async () => {
        if ((await ev('!!document.querySelector(\'[data-side-tab="changes"]\')')) !== true) return null
        await ev('document.querySelector(\'[data-side-tab="changes"]\')?.click()')
        if ((await ev(`!!document.querySelector(\`[data-change-path="${pathName}"]\`)`)) !== true) return null
        await ev(`document.querySelector(\`[data-change-path="${pathName}"]\`)?.click()`)
        return (await ev(`document.body.innerText.includes(${js(pathName)})`)) === true ? true : null
      }, 15000, 400)
    }
    const backToFiles = async () => {
      await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('All files'))?.click()`)
      await sleep(400)
    }
    await ev(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('docs'))?.click()`)
    await sleep(800)
    if ((await ev(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await ev(`${toggle}?.click()`)
    await sleep(400)
    await openFileDiff('NOTES.md')
    t.check('the markdown change is listed in the Changes panel', (await ev(`document.body.innerText.includes('NOTES.md')`)) === true)

    // ---- default view = Diff; the toggle exists for a previewable file
    t.check('the Diff | Preview toggle shows for a previewable file', (await ev('!!document.querySelector(\'[data-preview-mode="preview"]\')')) === true)
    t.check('Diff is the default (preview not pressed)', (await ev('document.querySelector(\'[data-preview-mode="preview"]\')?.getAttribute(\'aria-pressed\')')) === 'false')

    // ---- toggle Preview: sanitized markdown renders
    await click('[data-preview-mode="preview"]')
    const mdShown = await waitFor(async () => {
      const heading = await ev('document.querySelector("[data-markdown] h1")?.innerText ?? null')
      return heading !== null && heading.includes('Preview Heading') ? heading : null
    }, 8000, 300)
    t.check('markdown renders with its heading', !!mdShown)
    t.check('markdown is sanitized (no raw html/script nodes)', (await ev('document.querySelector("[data-markdown] script, [data-markdown] iframe")')) === null)

    // ---- a second file: preview resets to Diff, then the image renders
    await backToFiles()
    await openFileDiff('shot.png')
    t.check('switching files resets the toggle to Diff', (await ev('document.querySelector(\'[data-preview-mode="preview"]\')?.getAttribute(\'aria-pressed\')')) === 'false')
    await click('[data-preview-mode="preview"]')
    // The src check alone passes even when CSP blocks the request; the decoded size proves it loaded.
    const imgShown = await waitFor(async () => {
      const loaded = await ev(`(() => {
        const img = document.querySelector('[data-testid=preview-image] img[src^="data:image/png;base64,"]')
        return img !== null && img.complete === true && img.naturalWidth > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null
      })()`)
      return loaded ?? null
    }, 8000, 300)
    t.check('the image loads and decodes from its data URL (not blocked by CSP)', !!imgShown, js(imgShown))

    // ---- the oversized markdown shows the truncation note
    await backToFiles()
    await openFileDiff('BIG.md')
    await click('[data-preview-mode="preview"]')
    const cut = await waitFor(async () => {
      const text = await ev('document.body.innerText')
      return text.includes('File was cut at the preview size cap') ? true : null
    }, 8000, 300)
    t.check('an oversized markdown is flagged truncated', !!cut)

    // ---- traversal is refused by main (direct IPC, outside any changes list)
    const refused = await ev(`window.api.getWorktreeFilePreview(${js(wt.id)}, '../secret.md').then(() => 'no error', (e) => String(e.message))`)
    t.check('a path-traversal preview is refused', refused.includes('outside the worktree'), refused)

    // ---- a non-previewable file has no toggle
    await backToFiles()
    t.check('the toggle is gone on the All-files view', (await ev('!!document.querySelector(\'[data-preview-mode="preview"]\')')) === false)

    // ---- Ops mode: no preview toggle at all (scope rule)
    await click('[data-mode-switch] [data-mode="ops"]')
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops"'), 4000, 200)
    await ev(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('ops-one'))?.click()`)
    await sleep(800)
    t.check('an Ops session has no preview toggle (no Changes tab)', (await ev('!!document.querySelector(\'[data-side-tab="changes"]\')')) === false)
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    await removeTempDir(root)
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
