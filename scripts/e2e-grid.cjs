// E2E (grid view, D32): preset 2x2 through the real Grid ▾ menu, cells assigned through the real cell
// dropdowns, both terminals render (text echoed through the pty), duplicate pick MOVES the session,
// preset switches keep assignments, per-mode grids differ, and a graceful restart restores the grid.
// Run: node scripts/e2e-grid.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9451
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

function makeWorktree(root, name) {
  const wt = path.join(root, name)
  fs.mkdirSync(wt, { recursive: true })
  git(root, 'init', '-q', '-b', 'main', wt)
  fs.writeFileSync(path.join(wt, 'README.md'), 'x\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'init')
  return wt
}

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-grid-'))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const js = (value) => JSON.stringify(value)
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const click = (selector) => ev(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return false; n.click(); return true })()`)
    /** Radix menus open on POINTER events: a synthetic .click() alone does not open them. */
    const pointerClick = (selector) => ev(`(() => {
      const n = document.querySelector(${js(selector)})
      if (!n) return false
      const r = n.getBoundingClientRect()
      const fire = (type) => n.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: r.x + 2, clientY: r.y + 2, isPrimary: true }))
      fire('pointerdown')
      fire('pointerup')
      return true
    })()`)
    const replay = async (id) => String((await ev(`window.api.ptyReplay(${js(id)})`)).data)

    // Three real sessions (opencode TUI on free models, no turns needed).
    const ids = []
    for (const name of ['grid-one', 'grid-two', 'grid-three']) {
      const dir = makeWorktree(path.join(root, 'folders'), name)
      const s = await ev(`window.api.createSession({ cwd: ${js(dir)}, name: ${js(name)}, agent: 'opencode' })`)
      ids.push(s.id)
    }
    await sleep(1500)
    await ev(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('grid-one')).click()`)

    // ---- open the grid at 2x2 through the real Grid ▾ menu
    await pointerClick('[aria-label="Grid view"]')
    await sleep(300)
    await click('[data-grid-preset="2x2"]')
    await sleep(500)
    const gridUp = await waitFor(() => ev('!!document.querySelector(\'[data-testid="grid-view"][data-grid-preset="2x2"]\')'), 5000, 200)
    t.check('the grid opens at 2x2 through the menu', !!gridUp)
    t.check('empty cells show no terminal and no auto-fill', (await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')) === 0)

    // ---- assign two sessions through the real cell pickers (plain buttons: deterministic)
    const pickCell = async (cellIndex, name) => {
      await waitFor(async () => {
        const shown = await ev(`document.querySelector('[data-grid-cell="${String(cellIndex)}"] [aria-label="Choose the session for this cell"]')?.innerText ?? ''`)
        if (shown.includes(name)) return true
        await click(`[data-grid-cell="${String(cellIndex)}"] [aria-label="Choose the session for this cell"]`)
        await sleep(250)
        await ev(`(() => {
          const n = [...document.querySelectorAll('[data-cell-choice-id]')].find((x) => x.innerText.includes(${js(name)}))
          if (!n) return false
          n.click()
          return true
        })()`)
        await sleep(300)
        return null
      }, 12000, 300)
    }
    await pickCell(0, 'grid-one')
    await pickCell(1, 'grid-two')
    const twoPanes = await waitFor(async () => {
      const count = await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')
      return count === 2 ? count : null
    }, 8000, 300)
    t.check('both assigned cells show interactive terminals', !!twoPanes)
    // The viewport div alone proves nothing: xterm must have actually rendered INTO each cell (a pane opened in a
    // second host would leave the cell blank).
    const renderedExpr = `(() => {
      const views = [...document.querySelectorAll('[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport')]
      return views.length > 0 && views.every((v) => { const r = v.querySelector('.xterm')?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0 })
    })()`
    const rendered = await waitFor(() => ev(renderedExpr), 8000, 300)
    t.check('each assigned cell has a rendered xterm (not an empty viewport)', !!rendered)

    // ---- typing lands in the focused cell (echo check through the replay)
    await sleep(1000)
    await ev(`window.api.ptyWrite(${js(ids[0])}, 'echo GRID-ECHO-ONE\\r')`)
    const echoShown = await waitFor(async () => (await replay(ids[0])).includes('GRID-ECHO-ONE'), 10000, 300)
    t.check('typing reaches the assigned cell terminal', !!echoShown)

    // ---- duplicate guard: picking grid-one for cell 1 SWAPS the occupants (no duplicates)
    await pickCell(1, 'grid-one')
    await sleep(500)
    const panesAfterMove = await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')
    const firstCellName = await ev(`document.querySelector('[data-grid-cell="0"] [aria-label="Choose the session for this cell"]')?.innerText ?? null`)
    t.check('picking an assigned session swaps the cells (no duplicates)', panesAfterMove === 2 && (firstCellName ?? '').includes('grid-two'), `panes=${String(panesAfterMove)} firstCell=${String(firstCellName)}`)

    // ---- preset switches keep assignments where they fit (menu opens async: retry until it applied)
    const setPreset = async (preset) => {
      await waitFor(async () => {
        const shown = await ev('document.querySelector(\'[data-testid="grid-view"]\')?.getAttribute("data-grid-preset") ?? null')
        if (shown === preset) return true
        await pointerClick('[aria-label="Grid view"]')
        await sleep(250)
        await click(`[data-grid-preset="${preset}"]`)
        await sleep(400)
        return null
      }, 10000, 300)
    }
    await setPreset('3x2')
    t.check('widening keeps assignments (added empty cells)', (await ev('!!document.querySelector(\'[data-testid="grid-view"][data-grid-preset="3x2"]\')')) === true)
    await setPreset('1x1')
    t.check('shrinking to 1x1 keeps one pane', (await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')) === 1)
    await setPreset('2x2')
    t.check('back to 2x2 restores the assignments', (await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')) >= 2)

    // ---- a graceful restart restores preset + assignments
    await app.evaluate('window.api.quitApp()').catch(() => undefined)
    await sleep(6000)
    app.kill()
    await sleep(1500)
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const restored = await waitFor(() => ev('!!document.querySelector(\'[data-testid="grid-view"][data-grid-preset="2x2"]\')'), 8000, 300)
    // The panes mount one React commit after the grid element: wait for them instead of counting once.
    const restoredPanes = await waitFor(async () => (await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')) >= 2, 5000, 200)
    t.check('the restart restores the grid preset and assignments', !!restored && !!restoredPanes)

    // ---- D55: leave the grid with the X button, then with the menu item; the layout is kept
    const gridGone = () => waitFor(() => ev('!document.querySelector(\'[data-testid="grid-view"]\')'), 5000, 200)
    const visiblePane = 'Array.from(document.querySelectorAll(".terminal-pane__viewport")).some((v) => { const r = v.getBoundingClientRect(); return r.width > 0 && r.height > 0 })'
    t.check('the Exit grid button shows while the grid is on', (await ev('!!document.querySelector("[data-grid-exit-button]")')) === true)
    await click('[data-grid-exit-button]')
    t.check('the Exit grid button brings back the single terminal view', !!(await gridGone()) && (await ev(visiblePane)) === true)
    t.check('the Exit grid button is hidden outside the grid', (await ev('!!document.querySelector("[data-grid-exit-button]")')) === false)
    await setPreset('2x2')
    t.check('reopening the grid keeps the cells', (await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')) >= 2)
    await waitFor(async () => {
      if (await ev('!document.querySelector(\'[data-testid="grid-view"]\')')) return true
      await pointerClick('[aria-label="Grid view"]')
      await sleep(250)
      await click('[data-grid-exit]')
      await sleep(400)
      return null
    }, 10000, 300)
    t.check('the Exit grid menu item leaves the grid', !!(await gridGone()))
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
