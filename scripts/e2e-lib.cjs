// Shared helpers for the end-to-end scripts: launch the built Electron app and drive it over the Chrome DevTools Protocol.
const { spawn, execSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const strip = (s) => s.replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

async function waitFor(fn, timeoutMs, stepMs = 500) {
  const end = Date.now() + timeoutMs
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* retry until the deadline */ }
    if (Date.now() > end) return null
    await sleep(stepMs)
  }
}

function makeChecker() {
  const results = []
  return {
    check(name, ok, detail = '') { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) },
    summary() { const failed = results.filter((r) => !r).length; console.log(`\n${results.length - failed}/${results.length} checks passed`); return failed }
  }
}

/**
 * Launch the built app with an isolated user-data dir. By default it runs the dev build from out/ through the
 * local Electron binary; pass `exePath` to launch a packaged executable instead (e.g. release/win-unpacked/SessionDeck.exe).
 * `extraArgs` are extra Chromium/Electron switches (e.g. to imitate a PC without a GPU).
 * Returns { evaluate, send, kill, userData, pid }.
 */
async function launchApp({ port, userData, exePath, extraArgs = [] } = {}) {
  const debugPort = port ?? 9340
  const dataDir = userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sessiondeck-e2e-'))
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  // A stale app on this port would make the new run attach to the wrong window (and mix two suites' state).
  try {
    await fetch(`http://127.0.0.1:${debugPort}/json`)
    throw new Error(`CDP port ${debugPort} is already in use: a previous e2e run is still holding it`)
  } catch (error) {
    if (String(error instanceof Error ? error.message : error).includes('already in use')) throw error
  }
  const log = fs.openSync(path.join(dataDir, `app-${Date.now()}.log`), 'w')
  const args = exePath
    ? [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${dataDir}`, ...extraArgs]
    : [ROOT, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${dataDir}`, ...extraArgs]
  const app = spawn(exePath ?? electron, args, { stdio: ['ignore', log, log], cwd: exePath ? path.dirname(exePath) : ROOT })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page' && !t.url.startsWith('devtools')) ?? null, 30000)
  if (!target) throw new Error('no CDP page target')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  let counter = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id).resolve(d); pending.delete(d.id) } }
  // A call whose socket closes (or that never answers) used to wait forever and hang the whole run (e.g. quitApp over the socket it kills).
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('CDP socket closed')); pending.clear() }
  const CALL_DEADLINE_MS = 5 * 60 * 1000
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++counter
    const timer = setTimeout(() => { pending.delete(i); reject(new Error('CDP call timed out: ' + method)) }, CALL_DEADLINE_MS)
    pending.set(i, { resolve: (d) => { clearTimeout(timer); resolve(d) }, reject: (e) => { clearTimeout(timer); reject(e) } })
    try { ws.send(JSON.stringify({ id: i, method, params })) } catch (e) { clearTimeout(timer); pending.delete(i); reject(e) }
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.result.value
  }
  const kill = () => { try { ws.close() } catch { /* already closed */ } try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }) } catch { /* already gone */ } }
  await waitFor(() => evaluate('typeof window.api.getStore === "function"'), 15000)
  return { evaluate, send, kill, userData: dataDir, logFile: log, pid: app.pid }
}

/**
 * Stops a possibly running OpenCode background service ("opencode service stop"). SessionDeck injects its plugin
 * environment per process: a service spawned by foreign callers never sees it, so any `opencode` run that attaches
 * to a stale service silently skips the plugins. The e2e suites neutralize the service first, so `opencode run`
 * children spawned in this test run cold-start their own service and inherit this run's environment. Best effort:
 * if OpenCode is not installed the suites would fail anyway.
 */
function stopOpencodeService() {
  try {
    execSync('opencode service stop', { stdio: 'ignore' })
  } catch { /* nothing running or opencode missing */ }
}

module.exports = { ROOT, sleep, strip, waitFor, makeChecker, launchApp, stopOpencodeService }
