// E2E for D74: the eye button on Changes-panel rows (Code mode). A changed file the viewer can show gets an
// "Open in viewer" button that previews it in the side panel; a file it cannot show gets none.
// Uses a temp git repo and a Shell session in a worktree (nothing outside the temp folder is touched).
// Run: node scripts/e2e-fileview3.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9422
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-fileview3-'))
  const repo = path.join(root, 'shop')
  fs.mkdirSync(repo)
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), '# Shop\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  try {
    app = await launchApp({ port: PORT })
    await sleep(1500)
    const ev = (x) => app.evaluate(x)
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })).json()
    const tool = async (name, args = {}) => { const b = await rpc('tools/call', { name, arguments: args }); return { text: b.result.content[0].text, error: b.result.isError === true } }
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${JSON.stringify(path.join(root, 'wt'))} } })`)

    let r = await tool('add_repo', { folder: repo })
    r = await tool('create_worktree', { repo: 'shop', name: 'view fix', agent: 'shell' })
    const wt = (await ev('window.api.getStore()')).data.worktrees?.find((w) => w.name === 'view fix')
    t.check('a worktree to work in', !!wt, r.text)

    // Changed files: one the viewer can show (md edit, csv new), one it cannot (a .bin).
    fs.writeFileSync(path.join(wt.path, 'README.md'), '# Shop\n\nA changed **line**.\n')
    fs.writeFileSync(path.join(wt.path, 'prices.csv'), 'item,price\nwidget,9\ngadget,12\n')
    fs.writeFileSync(path.join(wt.path, 'blob.bin'), Buffer.from([1, 2, 3, 4]))
    await waitFor(async () => { const c = await tool('worktree_changes', { worktree: 'view fix' }); return /prices\.csv/.test(c.text) && /blob\.bin/.test(c.text) || null }, 20000, 500)
    // The list of changed files (not a single file's diff, which hides the rows).
    r = await tool('side_panel', { open: true, tab: 'changes', session: 'Shell' })
    const panel = await waitFor(() => ev('!!document.querySelector("section[aria-label=Changes]") || null'), 12000, 300)
    t.check('the Changes panel is on screen', !!panel)
    const rows = await waitFor(() => ev('!!document.querySelector("[data-change-path]") || null'), 12000, 300)
    t.check('the list of changed files is shown', !!rows)

    const has = (file) => ev(`!!document.querySelector('[data-open-viewer=${JSON.stringify(file)}]')`)
    t.check('a changed .md has the viewer button', await has('README.md'))
    t.check('a changed .csv has the viewer button', await has('prices.csv'))
    t.check('a changed .bin has NO viewer button', (await has('blob.bin')) === false)

    await ev(`document.querySelector('[data-open-viewer="prices.csv"]').click()`)
    const shown = await waitFor(() => ev(`document.querySelector('[data-preview-name]')?.textContent === 'prices.csv' && /widget/.test(document.querySelector('[data-file-view]')?.innerText ?? '') || null`), 10000, 300)
    t.check('the eye button previews the changed csv in the side panel', !!shown, await ev(`document.querySelector('[data-preview-name]')?.textContent ?? 'no preview'`))
    const full = await ev(`document.querySelector('[data-preview-name]')?.getAttribute('title') ?? ''`)
    t.check('it is the file inside the worktree (absolute path, backslashes)', full.toLowerCase().startsWith(wt.path.toLowerCase().replace(/\//g, '\\')), full)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold a folder */ }
  }
}
main()
