// End-to-end smoke test: launches the built Electron app and drives it through CDP. Run: node briefs/e2e.cjs
const { spawn, execSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const PORT = 9333
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sessiondeck-e2e-'))
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeoutMs, stepMs = 500) {
  const end = Date.now() + timeoutMs
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* retry */ }
    if (Date.now() > end) return null
    await sleep(stepMs)
  }
}

async function connect() {
  const targets = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`)
    const list = await res.json()
    return list.find((t) => t.type === 'page' && !t.url.startsWith('devtools')) ?? null
  }, 30000)
  if (!targets) throw new Error('no CDP page target')
  const ws = new WebSocket(targets.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } }
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.result.value
  }
  return { evaluate, send, close: () => ws.close() }
}

async function main() {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const logFile = path.join(userData, 'app.log')
  const out = fs.openSync(logFile, 'w')
  const app = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { stdio: ['ignore', out, out], cwd: ROOT })
  let page
  try {
    page = await connect()
    check('app window opens and renderer loads', true)
    check('preload bridge exposes the API', (await page.evaluate('typeof window.api.getStore')) === 'function')
    const empty = await waitFor(() => page.evaluate('document.body.innerText.length > 0 ? document.body.innerText : null'), 10000)
    check('UI renders text (not a white screen)', !!empty, JSON.stringify((empty || '').slice(0, 80)))

    await page.evaluate(`(window.__rt = [], window.api.onRuntime((s) => window.__rt.push(s)), true)`)
    const group = await page.evaluate(`window.api.createGroup('Work')`)
    check('create group', group && group.name === 'Work')
    const session = await page.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'e2e one', groupId: ${JSON.stringify(group.id)} })`)
    check('create session returns it with name and group', session.name === 'e2e one' && session.groupId === group.id)

    const running = await waitFor(async () => { const s = await page.evaluate('window.api.getStore()'); return s.runtime.find((r) => r.sessionId === session.id && r.run === 'running') ?? null }, 15000)
    check('pty process is running for the new session', !!running)
    const replay = await waitFor(async () => { const r = await page.evaluate(`window.api.ptyReplay(${JSON.stringify(session.id)})`); return r.seq > 0 && r.data.length > 50 ? r : null }, 40000, 1000)
    check('claude produced terminal output (replay has data and seq)', !!replay, replay ? `seq=${replay.seq} bytes=${replay.data.length}` : '')

    const dom = await waitFor(() => page.evaluate(`(() => { const t = document.body.innerText; return t.includes('e2e one') && t.includes('Work') ? t : null })()`), 10000)
    check('sidebar shows the group and session names', !!dom)
    await page.evaluate(`window.api.setSessionStatus(${JSON.stringify(session.id)}, 'working')`)
    await page.evaluate(`window.api.renameSession(${JSON.stringify(session.id)}, 'renamed deck')`)
    const renamed = await waitFor(() => page.evaluate(`document.body.innerText.includes('renamed deck') ? 1 : 0`), 8000)
    check('rename is reflected in the UI', !!renamed)
    const store = await page.evaluate('window.api.getStore()')
    const stored = store.data.sessions.find((s) => s.id === session.id)
    check('status and name persisted in the store', stored && stored.statusId === 'working' && stored.name === 'renamed deck')

    // Select the session by clicking its sidebar row, then check the terminal really mounts and renders.
    await page.evaluate(`(() => { const el = [...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('renamed deck')); if (el) el.click(); return !!el })()`)
    const term = await waitFor(() => page.evaluate(`(() => { const x = document.querySelector('.xterm'); return x ? { canvases: x.querySelectorAll('canvas').length, rows: !!x.querySelector('.xterm-rows'), w: x.clientWidth, h: x.clientHeight } : null })()`), 15000)
    check('clicking a session mounts an xterm terminal with real size', !!term && term.w > 200 && term.h > 100, JSON.stringify(term))
    check('GPU (WebGL) canvas renderer active', !!term && term.canvases > 0, term ? `canvases=${term.canvases}` : '')
    // Wait until claude has actually drawn its first screen (the replay contains readable text), then let xterm paint it.
    await waitFor(async () => { const r = await page.evaluate(`window.api.ptyReplay(${JSON.stringify(session.id)})`); return /[A-Za-z]{6,}/.test(r.data.replace(/\\x1b\\[[0-9;?<>]*[A-Za-z]/g, '')) }, 40000, 1000)
    await sleep(2000)
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(ROOT, 'briefs', 'screenshot.png'), Buffer.from(shot.result.data, 'base64'))
    await page.evaluate(`window.api.setActiveSession(null)`)
    const idle =await waitFor(async () => (await page.evaluate('window.__rt')).find((r) => r.sessionId === session.id && r.attention === 'idle') ?? null, 60000, 1000)
    check('idle fallback flags a session waiting on a first-run dialog', !!idle)
    // Dismiss claude's first-run dialogs (default highlighted option) until the prompt box is ready, then send a real prompt.
    for (let i = 0; i < 3; i += 1) { await page.evaluate(`window.api.ptyWrite(${JSON.stringify(session.id)}, '\\r')`); await sleep(2500) }
    await page.evaluate(`window.api.clearAttention(${JSON.stringify(session.id)})`)
    await page.evaluate(`window.__rt.length = 0`)
    await page.evaluate(`window.api.ptyWrite(${JSON.stringify(session.id)}, 'Reply with the single word ok')`)
    await sleep(500)
    await page.evaluate(`window.api.ptyWrite(${JSON.stringify(session.id)}, '\\r')`)
    const hook = await waitFor(async () => (await page.evaluate('window.__rt')).find((r) => r.sessionId === session.id && (r.attention === 'done' || r.attention === 'permission')) ?? null, 150000, 1000)
    check('REAL hook path: attention done/permission raised (claude hook -> http server -> state)', !!hook, hook ? `reason=${hook.attention}` : '')

    if (process.env.E2E_DEBUG) {
      const rep = await page.evaluate(`window.api.ptyReplay(${JSON.stringify(session.id)})`)
      console.log('--- replay (escapes stripped):\n' + rep.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').slice(-1500))
      console.log('--- runtime events:', JSON.stringify(await page.evaluate('window.__rt')))
    }
    await page.evaluate(`window.api.clearAttention(${JSON.stringify(session.id)})`)
    await page.evaluate(`window.api.removeSession(${JSON.stringify(session.id)})`)
    const gone = await waitFor(async () => !(await page.evaluate('window.api.getStore()')).data.sessions.some((s) => s.id === session.id), 5000)
    check('remove session', !!gone)
  } catch (e) {
    check('test run completed without exception', false, String(e.message || e))
  } finally {
    try { page && page.close() } catch { /* ignore */ }
    try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }) } catch { /* ignore */ }
    await sleep(1500)
    const log = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /error|exception|unhandled/i.test(l) && !/network_service|Autofill|dbus|GPU process|gpu_process/i.test(l))
    console.log('\napp stderr/stdout error lines:', log.length ? '\n' + log.slice(0, 8).join('\n') : 'none')
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  }
}
main()
