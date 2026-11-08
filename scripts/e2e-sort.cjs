// E2E: sort sessions (D61). Shell sessions only (no agent, no cost). Checks: the sidebar Sort menu reorders cards
// by Name / Newest / Last active / Needs attention and back to Manual; typing a line sets lastActiveAt; a live sort is
// pinned while the pointer is over the list and re-sorts when it leaves; keyboard ↓ follows the sorted order; a drag
// inside a group is refused with a hint while sorted; the Hub follows the sort; the choice survives a restart;
// Code mode keeps its own sort and sorts the sessions inside a worktree.
// Run: npx electron-vite build && node scripts/e2e-sort.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9480
const js = (value) => JSON.stringify(value)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' })

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-sort-'))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const work = path.join(root, 'work')
  fs.mkdirSync(work)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    const store = () => ev('window.api.getStore()')
    const order = (selector = '[data-session-card]') => ev(`[...document.querySelectorAll(${js(selector)})].map((n) => n.getAttribute(${js(selector.slice(1, -1))}))`)
    const names = async (selector) => {
      const ids = await order(selector)
      const data = (await store()).data
      return ids.map((id) => data.sessions.find((s) => s.id === id)?.name ?? id)
    }
    const point = async (x, y) => app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    const clickAt = async (rect) => {
      await point(rect.x, rect.y)
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
      await sleep(300)
    }
    const rectOf = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const moveAway = () => point(5, 5) // the title bar: off the list
    const chooseSort = async (value) => {
      const trigger = await rectOf('[data-sort-menu]')
      if (trigger === null) throw new Error('no sort menu')
      await clickAt(trigger)
      await waitFor(() => ev(`!!document.querySelector('[data-sort-option="${value}"]') || null`), 3000, 100)
      const option = await rectOf(`[data-sort-option="${value}"]`)
      if (option === null) throw new Error(`no sort option ${value}`)
      await clickAt(option)
      await waitFor(() => ev(`document.querySelector('[data-sort-menu]')?.dataset.sort === ${js(value)} || null`), 3000, 100)
      await moveAway()
      await sleep(200)
    }

    // ---- three Shell sessions, created b, a, c
    const make = (name) => ev(`window.api.createSession({ cwd: ${js(work)}, name: ${js(name)}, agent: 'shell' })`)
    const b = await make('b-two')
    await sleep(30)
    const a = await make('a-one')
    await sleep(30)
    const c = await make('c-three')
    const running = await waitFor(async () => {
      const s = await store()
      return [a, b, c].every((x) => s.runtime.find((r) => r.sessionId === x.id)?.run === 'running') || null
    }, 20000, 300)
    t.check('three Shell sessions run', !!running)
    await moveAway()
    t.check('Manual (default) keeps the creation order', js(await names()) === js(['b-two', 'a-one', 'c-three']), js(await names()))
    t.check('the sort button says Manual', (await ev(`document.querySelector('[data-sort-menu]')?.dataset.sort`)) === 'manual')

    await chooseSort('name')
    t.check('Name A–Z', js(await names()) === js(['a-one', 'b-two', 'c-three']), js(await names()))
    await chooseSort('newest')
    t.check('Newest', js(await names()) === js(['c-three', 'a-one', 'b-two']), js(await names()))

    // ---- Last active: a submitted line in b-two makes it the most recent
    await chooseSort('recent')
    await ev(`window.api.ptyWrite(${js(b.id)}, 'echo sort-e2e\\r')`)
    const touched = await waitFor(async () => (await store()).data.sessions.find((s) => s.id === b.id)?.lastActiveAt ?? null, 5000, 200)
    t.check('typing a line sets lastActiveAt', typeof touched === 'number')
    const recentOk = await waitFor(async () => js(await names()) === js(['b-two', 'c-three', 'a-one']) || null, 4000, 200)
    t.check('Last active puts b-two first, then by creation', !!recentOk, js(await names()))

    // ---- hover freeze: a-one becomes active while the pointer is over the list; it moves only after the pointer leaves
    const listCard = await rectOf(`[data-session-card="${c.id}"]`)
    await point(listCard.x, listCard.y)
    await sleep(300)
    await ev(`window.api.ptyWrite(${js(a.id)}, 'echo again\\r')`)
    await waitFor(async () => (await store()).data.sessions.find((s) => s.id === a.id)?.lastActiveAt ?? null, 5000, 200)
    await sleep(500)
    t.check('the order is pinned while the pointer is over the list', js(await names()) === js(['b-two', 'c-three', 'a-one']), js(await names()))
    await moveAway()
    const unpinned = await waitFor(async () => js(await names()) === js(['a-one', 'b-two', 'c-three']) || null, 3000, 200)
    t.check('it re-sorts when the pointer leaves', !!unpinned, js(await names()))

    // ---- keyboard ↓ follows the sorted order
    await clickAt(await rectOf(`[data-session-card="${a.id}"]`))
    await moveAway()
    await ev(`document.querySelector('[data-session-card="${a.id}"]').focus()`)
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    const next = await waitFor(() => ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') === ${js(b.id)} || null`), 3000, 150)
    t.check('↓ from the first card opens the next one in sorted order', !!next)

    // ---- Needs attention: a sleeping session goes last
    await ev(`window.api.sleepSession(${js(a.id)})`)
    await waitFor(async () => (await store()).runtime.find((r) => r.sessionId === a.id)?.sleeping === true || null, 10000, 200)
    await chooseSort('attention')
    const attentionOk = await waitFor(async () => (await names()).at(-1) === 'a-one' || null, 4000, 200)
    t.check('Needs attention puts the sleeping session last', !!attentionOk, js(await names()))

    // ---- a drag inside the group is refused while sorted
    await chooseSort('name')
    const before = js((await store()).data.sessions.map((s) => [s.id, s.order]))
    const drag = (type, id, targetId) => ev(`(() => {
      window.__sortDt = window.__sortDt || new DataTransfer()
      const card = document.querySelector('[data-session-card="${id}"]')
      const target = document.querySelector('[data-session-card="${targetId}"]')
      const el = (${js(type)} === 'dragover' || ${js(type)} === 'drop') ? target : card
      const r = target.getBoundingClientRect()
      el.dispatchEvent(new DragEvent(${js(type)}, { bubbles: true, cancelable: true, dataTransfer: window.__sortDt, clientY: r.top + 2 }))
      return true
    })()`)
    await drag('dragstart', c.id, a.id)
    await drag('dragover', c.id, a.id)
    await drag('drop', c.id, a.id)
    await drag('dragend', c.id, a.id)
    await sleep(400)
    t.check('the drag shows "switch to Manual to reorder"', ((await ev(`document.querySelector('[data-sort-hint]')?.textContent ?? ''`)) || '').includes('Switch the sort to Manual'))
    t.check('the drag did not change the stored order', js((await store()).data.sessions.map((s) => [s.id, s.order])) === before)

    // ---- the Hub follows the sort
    await clickAt(await rectOf('[aria-label="Open Hub"]'))
    await waitFor(() => ev(`document.querySelectorAll('[data-hub-card]').length === 3 || null`), 5000, 200)
    await moveAway()
    t.check('Hub cards follow Name A–Z', js(await names('[data-hub-card]')) === js(['a-one', 'b-two', 'c-three']), js(await names('[data-hub-card]')))
    await chooseSort('newest')
    t.check('Hub cards follow Newest', js(await names('[data-hub-card]')) === js(['c-three', 'a-one', 'b-two']), js(await names('[data-hub-card]')))
    await chooseSort('name')

    // ---- Code mode has its own sort and sorts inside a worktree
    const repo = path.join(root, 'shop')
    fs.mkdirSync(repo)
    git(root, 'init', '-q', '-b', 'main', repo)
    fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n')
    git(repo, 'add', '.')
    git(repo, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-q', '-m', 'init')
    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(path.join(root, 'wt'))} } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    const wt = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'zeta-main', baseBranch: 'main', source: 'main', agent: 'shell' })`)
    const worktreeId = wt.worktree?.id ?? wt.id
    const wtPath = (await store()).data.worktrees.find((w) => w.id === worktreeId)?.path
    await ev(`window.api.createSession({ cwd: ${js(wtPath)}, worktreeId: ${js(worktreeId)}, name: 'alpha-code', agent: 'shell' })`)
    await ev(`(() => { const n = document.querySelector('[data-mode-switch] [data-mode="code"]'); n && n.click() })()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'code' || null`), 5000, 200)
    await waitFor(() => ev(`document.querySelectorAll('[data-session-card]').length >= 2 || null`), 8000, 200)
    await moveAway()
    t.check('Code mode starts on its own sort (Manual)', (await ev(`document.querySelector('[data-sort-menu]')?.dataset.sort`)) === 'manual')
    const codeManual = await names()
    await chooseSort('name')
    const codeNamed = await names()
    t.check('Code mode sorts the sessions of a worktree by name', codeNamed[0] === 'alpha-code' && codeManual[0] !== 'alpha-code', `${js(codeManual)} -> ${js(codeNamed)}`)
    await chooseSort('newest')
    await ev(`(() => { const n = document.querySelector('[data-mode-switch] [data-mode="ops"]'); n && n.click() })()`)
    await waitFor(() => ev(`document.querySelector('[data-ui-mode]')?.dataset.uiMode === 'ops' || null`), 5000, 200)
    t.check('Ops kept its own sort (Name)', (await ev(`document.querySelector('[data-sort-menu]')?.dataset.sort`)) === 'name')

    // ---- the choice survives a restart
    await ev('window.api.quitApp()').catch(() => undefined)
    await sleep(6000)
    app.kill()
    await sleep(1500)
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const kept = await waitFor(() => app.evaluate(`document.querySelector('[data-sort-menu]')?.dataset.sort === 'name' || null`), 8000, 300)
    t.check('the Ops sort survives a restart', !!kept)
    const keptStore = await app.evaluate('window.api.getStore()')
    t.check('lastActiveAt survives a restart', typeof keptStore.data.sessions.find((s) => s.id === b.id)?.lastActiveAt === 'number')
  } catch (error) {
    t.check('suite ran without an exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* files may still be held */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
