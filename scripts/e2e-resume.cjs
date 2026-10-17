// E2E: a session's Claude conversation survives closing and reopening the app. Run: node scripts/e2e-resume.cjs
// Launch 1: create session, tell claude a unique codeword, wait until it answers, kill the app.
// Launch 2 (same user-data dir): session is restored as exited; activating it lazily resumes the SAME conversation.
const { spawn, execSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const PORT = 9334
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sessiondeck-resume-'))
const CODEWORD = `PINEAPPLE${Math.floor(Math.random() * 90000 + 10000)}`
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const strip = (s) => s.replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

async function waitFor(fn, timeoutMs, stepMs = 500) {
  const end = Date.now() + timeoutMs
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* retry */ }
    if (Date.now() > end) return null
    await sleep(stepMs)
  }
}

async function launch() {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const log = fs.openSync(path.join(userData, `app-${Date.now()}.log`), 'w')
  const app = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { stdio: ['ignore', log, log], cwd: ROOT })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && !t.url.startsWith('devtools')) ?? null, 30000)
  if (!target) throw new Error('no CDP page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')) })
  let n = 0; const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const send = (method, params = {}) => new Promise((res) => { const i = ++n; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.result.value }
  const kill = () => { try { ws.close() } catch { /* ignore */ } try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }) } catch { /* ignore */ } }
  return { evaluate, kill }
}

async function main() {
  let app
  try {
    // ---------- launch 1
    app = await launch()
    await waitFor(() => app.evaluate('typeof window.api.getStore === "function"'), 15000)
    await app.evaluate(`(window.__rt = [], window.api.onRuntime((s) => window.__rt.push(s)), true)`)
    const session = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'persist me' })`)
    check('session created with a Claude conversation id', typeof session.claudeSessionId === 'string' && session.claudeSessionId.length > 20, session.claudeSessionId)
    await app.evaluate(`window.api.setActiveSession(null)`)
    await waitFor(async () => { const r = await app.evaluate(`window.api.ptyReplay(${JSON.stringify(session.id)})`); return /[A-Za-z]{6,}/.test(strip(r.data)) }, 40000, 1000)
    for (let i = 0; i < 3; i += 1) { await app.evaluate(`window.api.ptyWrite(${JSON.stringify(session.id)}, '\\r')`); await sleep(2500) }
    await app.evaluate(`window.__rt.length = 0`)
    await app.evaluate(`window.api.ptyWrite(${JSON.stringify(session.id)}, 'Remember the codeword ${CODEWORD}. Reply only with: noted')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${JSON.stringify(session.id)}, '\\r')`)
    const done = await waitFor(async () => (await app.evaluate('window.__rt')).find((r) => r.sessionId === session.id && r.attention === 'done') ?? null, 150000, 1000)
    check('claude answered (conversation exists on disk)', !!done)
    await sleep(2000)
    app.kill()
    await sleep(3000)

    // ---------- launch 2, same user-data
    app = await launch()
    await waitFor(() => app.evaluate('typeof window.api.getStore === "function"'), 15000)
    const store = await app.evaluate('window.api.getStore()')
    const restored = store.data.sessions.find((s) => s.id === session.id)
    check('session is restored after relaunch (name, same conversation id)', !!restored && restored.name === 'persist me' && restored.claudeSessionId === session.claudeSessionId)
    const rt = store.runtime.find((r) => r.sessionId === session.id)
    check('restored session is NOT auto-started (no process at launch)', !rt || rt.run === 'exited')

    await app.evaluate(`window.api.setActiveSession(${JSON.stringify(session.id)})`)
    const resumed = await waitFor(async () => { const s = await app.evaluate('window.api.getStore()'); return s.runtime.find((r) => r.sessionId === session.id && r.run === 'running') ?? null }, 20000)
    check('selecting it lazily starts the process (resume)', !!resumed)
    const hit = await waitFor(async () => { const r = await app.evaluate(`window.api.ptyReplay(${JSON.stringify(session.id)})`); return strip(r.data).includes(CODEWORD) ? r : null }, 60000, 1000)
    check(`resumed terminal shows the earlier conversation (codeword ${CODEWORD})`, !!hit)
    if (!hit) {
      const r = await app.evaluate(`window.api.ptyReplay(${JSON.stringify(session.id)})`)
      console.log('--- replay tail:\n' + strip(r.data).slice(-900))
    }
  } catch (e) {
    check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    const failed = results.filter((x) => !x).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  }
}
main()
