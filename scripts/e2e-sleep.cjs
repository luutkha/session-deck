// E2E: session sleep. Manual sleep + wake (same conversation id), then the idle timer (1 minute, so this takes ~2 min).
// Then two windows (D40): the main window shows an Ops session while the popped-out Code window shows a worktree
// session. The Code session must stay awake while the background Ops session sleeps; after the Code window is docked
// and the main window moves to Ops, the same session is no longer shown anywhere and must sleep normally.
// Takes ~5 min. Run: node scripts/e2e-sleep.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9396
const js = (value) => JSON.stringify(value)
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

const runtimeOf = async (app, id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)
const click = (app, text) =>
  app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes(${js(text)})).click()`)
const clickSelector = (target, selector) =>
  target.evaluate(`(() => { const n = document.querySelector(${js(selector)}); if (!n) return false; n.click(); return true })()`)
/** Clicks the session card with this text; the worktree row is not a treeitem, so the name cannot hit it. */
const clickSessionRow = (target, text) =>
  target.evaluate(`(() => {
    const n = [...document.querySelectorAll('[role="treeitem"]')].find((x) => x.innerText.includes(${js(text)}))
    if (!n) return false
    n.click()
    return true
  })()`)
const showsSession = (target, id) =>
  target.evaluate(`[...document.querySelectorAll('.terminal-pane__viewport')].some((n) => n.dataset.sessionId === ${js(id)})`)

/** Connects to another CDP page target (the popped-out Code window). */
async function connectPage(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  let counter = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  // The Code window can be closed by the command it just ran (dock); a pending reply then never arrives.
  ws.onclose = () => { for (const resolve of pending.values()) resolve({ result: {} }); pending.clear() }
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++counter; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const result = r.result ?? {}
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed')
    return result.result?.value
  }
  return { evaluate, send, close: () => ws.close() }
}

/** The window whose renderer reports role 'code', or null while it is still loading. */
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
  const repo = path.join(root, 'sleep-app')
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

async function main() {
  const t = makeChecker()
  let app
  let codeWin = null
  try {
    app = await launchApp({ port: PORT })
    await sleep(1500)
    const a = await app.evaluate(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'sleeper' })`)
    const b = await app.evaluate(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'other' })`)
    await sleep(2000)
    await click(app, 'other') // 'other' is the active one; 'sleeper' is in the background

    // ---- manual sleep
    await app.evaluate(`window.api.sleepSession(${js(a.id)})`)
    const asleep = await waitFor(async () => (await runtimeOf(app, a.id))?.sleeping === true, 8000, 300)
    t.check('sleepSession marks the session sleeping', !!asleep)
    const st = await runtimeOf(app, a.id)
    t.check('a sleeping session is not "running"', st?.run === 'exited')
    const stored = (await app.evaluate('window.api.getStore()')).data.sessions.find((s) => s.id === a.id)
    t.check('the card is kept (not closed), same claude conversation id', stored && stored.closedAt === undefined && !!stored.claudeSessionId)
    const convo = stored.claudeSessionId

    // ---- wake by activating it
    await click(app, 'sleeper')
    const awake = await waitFor(async () => { const r = await runtimeOf(app, a.id); return r?.run === 'running' && !r.sleeping }, 20000, 400)
    t.check('opening a sleeping session wakes it (running, not sleeping)', !!awake)
    const after = (await app.evaluate('window.api.getStore()')).data.sessions.find((s) => s.id === a.id)
    t.check('it resumed the same conversation id', after?.claudeSessionId === convo)

    // ---- idle timer
    await click(app, 'other')
    await app.evaluate('window.api.updateSettings({ sleep: { enabled: true, afterMinutes: 1 } })')
    const timed = await waitFor(async () => (await runtimeOf(app, a.id))?.sleeping === true, 150000, 2000)
    t.check('idle timer puts the background session to sleep (1 min)', !!timed)
    const activeStill = await runtimeOf(app, b.id)
    t.check('the active session is never put to sleep', activeStill?.run === 'running' && !activeStill.sleeping)

    // ---- two windows: on screen in the popped-out Code window still protects a session
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-sleep-code-'))
    const repo = makeRepo(root)
    const worktreesRoot = path.join(root, 'wt')
    await app.evaluate(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
    const idleTwo = await app.evaluate(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'idle-two', agent: 'claude' })`)
    await sleep(800)
    const added = await app.evaluate(`window.api.addRepo(${js(repo)})`)
    const created = await app.evaluate(`window.api.createWorktree({ repoId: ${js(added.id)}, name: 'sleep check', baseBranch: 'main', agent: 'claude' })`)
    const codeSession = created.session
    t.check('a worktree session starts in Code mode', !!codeSession && codeSession.worktreeId === created.worktree.id && fs.existsSync(created.worktree.path), js(codeSession))

    await clickSelector(app, '[data-mode-switch] [data-mode="code"]')
    const codeMode = await waitFor(() => app.evaluate('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code"'), 5000, 200)
    t.check('the main window switches to Code mode', !!codeMode)
    const rowClicked = await waitFor(() => clickSessionRow(app, 'sleep-check'), 8000, 300)
    t.check('the worktree session card opens', !!rowClicked)
    const mainShows = await waitFor(() => showsSession(app, codeSession.id), 10000, 300)
    t.check('the worktree session is on screen before the pop out', !!mainShows)

    await clickSelector(app, '[aria-label="Open Code in its own window"]')
    const popped = await waitFor(async () => (await app.evaluate('window.api.getWindowState()')).codePoppedOut === true, 8000, 300)
    t.check('the Code window pops out', !!popped)
    codeWin = await waitFor(() => findCodeWindow(), 15000, 500)
    t.check('a second window with role code exists', !!codeWin)
    const role = codeWin ? await codeWin.evaluate('window.api.windowRole') : null
    t.check('the second window reports the code role', role === 'code', String(role))
    if (codeWin && !(await showsSession(codeWin, codeSession.id))) await clickSessionRow(codeWin, 'sleep-check')
    const codeShows = codeWin ? await waitFor(() => showsSession(codeWin, codeSession.id), 10000, 300) : null
    t.check('the Code window shows that session', !!codeShows)
    const mainOps = await waitFor(() => app.evaluate('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops"'), 5000, 200)
    t.check('the main window goes back to Ops and keeps its own session', !!mainOps)

    const sleptTwo = await waitFor(async () => (await runtimeOf(app, idleTwo.id))?.sleeping === true, 150000, 2000)
    t.check('a background Ops session still falls asleep while the Code window is open', !!sleptTwo)
    const codeAlive = await runtimeOf(app, codeSession.id)
    t.check('the session shown in the Code window is never slept', codeAlive?.run === 'running' && !codeAlive.sleeping, js(codeAlive))

    // ---- dock it back: once no window shows the session, it sleeps normally
    const dockButton = codeWin ? await codeWin.evaluate('!!document.querySelector(\'[aria-label="Move Code back to the main window"]\')') : false
    t.check('the Code window offers "Move Code back to the main window"', dockButton === true)
    // The dock closes the Code window, so the click is not awaited through CDP (the reply can be lost); the button
    // and this API are the same path, and e2e-codemode covers the button itself.
    await app.evaluate('window.api.dockCode()')
    const docked = await waitFor(async () => (await app.evaluate('window.api.getWindowState()')).codePoppedOut === false, 10000, 300)
    t.check('docking closes the Code window', !!docked)
    if (codeWin) { codeWin.close(); codeWin = null }
    const backToCode = await waitFor(() => app.evaluate('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code"'), 6000, 200)
    t.check('the main window returns to Code mode', !!backToCode)
    await clickSelector(app, '[data-mode-switch] [data-mode="ops"]')
    const opsMode = await waitFor(() => app.evaluate('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops"'), 5000, 200)
    t.check('the main window switches to Ops, hiding the Code session', !!opsMode)
    const codeSlept = await waitFor(async () => (await runtimeOf(app, codeSession.id))?.sleeping === true, 90000, 2000)
    t.check('once no window shows it, the session falls asleep normally', !!codeSlept)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    if (codeWin) codeWin.close()
    t.summary()
    if (app) app.kill()
  }
}
main()
