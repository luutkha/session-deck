// Benchmark: many chatty sessions (performance work). Not a pass/fail suite; prints numbers to compare before/after a change.
// Starts N Shell sessions that each print a line every ~20 ms, opens every one once (so each gets a terminal pane),
// parks on one session, then measures for DURATION seconds: pty messages per second, renderer busy time (CDP
// Performance.getMetrics), frames per second, long tasks, JS heap, and CPU seconds of the whole app process tree.
// Run: npx electron-vite build && node scripts/bench-sessions.cjs [sessions=20] [seconds=15] [churn] [gpu=real|off|swiftshader] [renderer=auto|webgl|canvas|dom] [flood]
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, launchApp } = require('./e2e-lib.cjs')

const PORT = 9495
const SESSIONS = Number(process.argv[2] ?? 20)
const SECONDS = Number(process.argv[3] ?? 15)
// Third arg `churn`: also change a session's notes 10x/s (a store write + broadcast + re-render each), like a busy fleet of agents does.
const CHURN = process.argv.includes('churn')
// GPU modes, to imitate a VM without a GPU: `gpu=off` (--disable-gpu: no WebGL, software compositing),
// `gpu=swiftshader` (WebGL on the CPU). Default: the real GPU of this PC.
const GPU = (process.argv.find((a) => a.startsWith('gpu=')) ?? 'gpu=real').slice(4)
// `renderer=auto|webgl|canvas|dom` sets the terminal renderer preference (localStorage) before the run.
const RENDERER = (process.argv.find((a) => a.startsWith('renderer=')) ?? 'renderer=auto').slice(9)
// `flood`: each session prints ~4,000 long lines per second (a build log / `cat bigfile`) instead of one line per 20 ms.
const FLOOD = process.argv.includes('flood')
const GPU_ARGS = {
  real: [],
  off: ['--disable-gpu'],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
}[GPU]
if (GPU_ARGS === undefined) throw new Error('gpu= must be real, off or swiftshader')
// `agents=N`: each session also gets N Claude hook events per second (UserPromptSubmit / Stop alternating, POSTed to the
// app's hook server like Claude Code does), so runtime events, attention and status changes flow like with real agents.
const AGENTS_PER_SEC = Number((process.argv.find((a) => a.startsWith('agents=')) ?? 'agents=0').slice(7))
// `profile`: CPU-profile the main process during the measurement (--inspect over CDP) and print its top self-time functions.
const PROFILE = process.argv.includes('profile')
// `rprofile`: the same for the renderer (page) process.
const RPROFILE = process.argv.includes('rprofile')
// `mut`: count DOM mutations per second by area during the measurement (what does an event repaint?).
const MUT = process.argv.includes('mut')
const js = (value) => JSON.stringify(value)

/** Top functions by self time of a V8 CPU profile. */
function summarizeProfile(profile) {
  const self = new Map()
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const dt = profile.timeDeltas
  profile.samples.forEach((id, i) => {
    const n = byId.get(id)
    const f = n.callFrame
    const key = `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*[\/](out|node_modules|src)[\/]/, '$1/')}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0))
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  const idle = [...self.entries()].filter(([k]) => k.startsWith('(idle)') || k.startsWith('(program)')).reduce((a, [, v]) => a + v, 0)
  const top = [...self.entries()].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 25)
  return { totalMs: Math.round(total / 1000), idleMs: Math.round(idle / 1000), top: top.map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`) }
}

/** Starts/stops the V8 CPU profiler of the Electron main process over its inspector port; returns top functions by self time. */
async function mainProfiler(port) {
  const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json())[0]
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('inspector ws error')) })
  let counter = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++counter; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Profiler.enable')
  await send('Profiler.setSamplingInterval', { interval: 500 })
  return {
    start: () => send('Profiler.start'),
    stop: async () => {
      const { result } = await send('Profiler.stop')
      ws.close()
      return summarizeProfile(result.profile)
    }
  }
}

/** CPU seconds (user+kernel) of the app's whole process tree, via PowerShell. */
function treeCpuSeconds(rootPid) {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', '$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,UserModeTime,KernelModeTime,CommandLine; $p | ConvertTo-Json -Compress'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const all = JSON.parse(out)
  const byParent = new Map()
  for (const proc of all) {
    const list = byParent.get(proc.ParentProcessId) ?? []
    list.push(proc)
    byParent.set(proc.ParentProcessId, list)
  }
  const byPid = new Map(all.map((proc) => [proc.ProcessId, proc]))
  const stack = [rootPid]
  const seen = new Set()
  const groups = { electron: 0, main: 0, gpu: 0, renderer: 0, utility: 0, pty: 0, other: 0 }
  while (stack.length > 0) {
    const pid = stack.pop()
    if (seen.has(pid)) continue
    seen.add(pid)
    const proc = byPid.get(pid)
    if (proc) {
      const seconds = (Number(proc.UserModeTime) + Number(proc.KernelModeTime)) / 1e7
      const name = String(proc.Name).toLowerCase()
      if (name === 'electron.exe') {
        groups.electron += seconds
        const type = /--type=([a-z-]+)/.exec(String(proc.CommandLine ?? ''))?.[1] ?? 'main'
        const key = type === 'gpu-process' ? 'gpu' : type === 'renderer' ? 'renderer' : type === 'main' ? 'main' : 'utility'
        groups[key] += seconds
      }
      else if (name.includes('conhost') || name.includes('openconsole') || name === 'cmd.exe' || name.includes('powershell') || name === 'node.exe') groups.pty += seconds
      else groups.other += seconds
    }
    for (const child of byParent.get(pid) ?? []) stack.push(child.ProcessId)
  }
  return groups
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-bench-'))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const work = path.join(root, 'work')
  fs.mkdirSync(work)
  let app
  try {
    // A measurement run must not restart itself (the first-run no-GPU restart).
    process.env.SESSIONDECK_GPU_NO_RESTART = '1'
    const endpointFile = path.join(root, 'endpoint.json')
    if (AGENTS_PER_SEC > 0) process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
    app = await launchApp({ port: PORT, userData, extraArgs: [...GPU_ARGS, ...(PROFILE ? ['--inspect=9231'] : [])] })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    await app.send('Performance.enable')
    await ev(`localStorage.setItem('sessiondeck.renderer.v1', ${js(RENDERER)})`)
    const effectsArg = process.argv.find((a) => a.startsWith('effects='))
    if (effectsArg) await ev(`localStorage.setItem('sessiondeck.effects.v1', ${js(effectsArg.slice(8))})`)
    await ev('location.reload()').catch(() => undefined)
    await sleep(2500)
    await waitFor(() => ev('typeof window.api.getStore === "function"'), 15000, 300)
    await ev(`(() => {
      window.__bench = { msgs: 0, bytes: 0, frames: 0, longTasks: 0, longMs: 0 }
      window.api.onPtyData((id, data) => { window.__bench.msgs += 1; window.__bench.bytes += data.length })
      const tick = () => { window.__bench.frames += 1; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      try { new PerformanceObserver((list) => { for (const e of list.getEntries()) { window.__bench.longTasks += 1; window.__bench.longMs += e.duration } }).observe({ entryTypes: ['longtask'] }) } catch {}
    })()`)

    const ids = []
    for (let i = 0; i < SESSIONS; i += 1) {
      const session = await ev(`window.api.createSession({ cwd: ${js(work)}, name: ${js('bench-' + String(i).padStart(2, '0'))}, agent: 'shell' })`)
      ids.push(session.id)
    }
    await waitFor(() => ev(`document.querySelectorAll('[data-session-card]').length >= ${SESSIONS} || null`), 15000, 200)
    // Open each session once (creates its pane), start the chatty loop, then move on.
    const chatty = `node -e "setInterval(()=>process.stdout.write('bench line '+Date.now()+' xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\r\\n'),20)"`
    const flood = `node -e "setInterval(()=>{let s='';for(let i=0;i<200;i++)s+='flood '+i+' '+'z'.repeat(100)+String.fromCharCode(13,10);process.stdout.write(s)},50)"`
    const loadCommand = FLOOD ? flood : chatty
    for (const id of ids) {
      await ev(`(() => { const n = document.querySelector('[data-session-card="${id}"]'); if (n) n.click(); })()`)
      await sleep(250)
      await ev(`window.api.ptyWrite(${js(id)}, ${js(loadCommand + '\r')})`)
      await sleep(150)
    }
    await ev(`(() => { const n = document.querySelector('[data-session-card="${ids[0]}"]'); if (n) n.click(); })()`)
    await sleep(3000) // let every loop start and the UI settle

    const metrics = async () => Object.fromEntries((await app.send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]))
    const before = { m: await metrics(), b: await ev('({ ...window.__bench })'), cpu: treeCpuSeconds(app.pid), t: Date.now() }
    let churnTimer = null
    let agentTimer = null
    let hookCount = 0
    if (AGENTS_PER_SEC > 0) {
      const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
      const events = ['UserPromptSubmit', 'Stop']
      let k = 0
      const perTick = Math.max(1, Math.round((SESSIONS * AGENTS_PER_SEC) / 20)) // 20 ticks per second
      agentTimer = setInterval(() => {
        for (let i = 0; i < perTick; i += 1) {
          const id = ids[k % ids.length]
          const event = events[Math.floor(k / ids.length) % 2]
          k += 1
          hookCount += 1
          fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, { method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined)
        }
      }, 50)
    }
    if (MUT) {
      await ev(`(() => {
        window.__mut = {}
        const area = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; if (!el) return '(none)'; const hit = el.closest('[data-session-card],[data-testid],[role=tablist],[role=tree],aside,header,footer,.xterm,[class*=statusbar]'); if (!hit) return 'other:' + el.tagName; return hit.hasAttribute('data-session-card') ? 'session-card' : hit.getAttribute('data-testid') || hit.getAttribute('role') || hit.tagName + '.' + String(hit.className).split(' ')[0] }
        new MutationObserver((records) => { for (const r of records) { const k = r.type + ' ' + area(r.target); window.__mut[k] = (window.__mut[k] || 0) + 1 } }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
      })()`)
    }
    const profiler = PROFILE ? await mainProfiler(9231) : null
    if (profiler) await profiler.start()
    if (RPROFILE) { await app.send('Profiler.enable'); await app.send('Profiler.setSamplingInterval', { interval: 500 }); await app.send('Profiler.start') }
    if (CHURN) {
      let n = 0
      churnTimer = setInterval(() => { n += 1; void ev(`window.api.setSessionNotes(${js(ids[n % ids.length])}, ${js('note ' + n)})`).catch(() => undefined) }, 100)
    }
    await sleep(SECONDS * 1000)
    if (churnTimer !== null) clearInterval(churnTimer)
    if (agentTimer !== null) clearInterval(agentTimer)
    const mutResult = MUT ? await ev('window.__mut') : null
    const profileResult = profiler ? await profiler.stop() : null
    const rProfileResult = RPROFILE ? summarizeProfile((await app.send('Profiler.stop')).result.profile) : null
    const after = { m: await metrics(), b: await ev('({ ...window.__bench })'), cpu: treeCpuSeconds(app.pid), t: Date.now() }
    const secs = (after.t - before.t) / 1000
    const d = (key) => after.m[key] - before.m[key]
    const row = {
      sessions: SESSIONS,
      load: FLOOD ? 'flood' : 'chatty',
      gpu: GPU,
      renderer: RENDERER,
      churn: CHURN,
      agentEventsPerSec: AGENTS_PER_SEC > 0 ? Math.round(hookCount / ((Date.now() - before.t) / 1000)) : 0,
      seconds: Number(secs.toFixed(1)),
      ptyMsgsPerSec: Math.round((after.b.msgs - before.b.msgs) / secs),
      ptyKBPerSec: Math.round((after.b.bytes - before.b.bytes) / secs / 1024),
      framesPerSec: Number(((after.b.frames - before.b.frames) / secs).toFixed(1)),
      longTasksPerSec: Number(((after.b.longTasks - before.b.longTasks) / secs).toFixed(2)),
      rendererBusyPct: Number(((d('TaskDuration') / secs) * 100).toFixed(1)),
      rendererLayoutPct: Number(((d('LayoutDuration') / secs) * 100).toFixed(1)),
      rendererStylePct: Number(((d('RecalcStyleDuration') / secs) * 100).toFixed(1)),
      rendererScriptPct: Number(((d('ScriptDuration') / secs) * 100).toFixed(1)),
      jsHeapMB: Number((after.m.JSHeapUsedSize / 1048576).toFixed(0)),
      domNodes: after.m.Nodes,
      cpuMainPct: Number((((after.cpu.main - before.cpu.main) / secs) * 100).toFixed(0)),
      cpuGpuPct: Number((((after.cpu.gpu - before.cpu.gpu) / secs) * 100).toFixed(0)),
      cpuRendererPct: Number((((after.cpu.renderer - before.cpu.renderer) / secs) * 100).toFixed(0)),
      cpuUtilityPct: Number((((after.cpu.utility - before.cpu.utility) / secs) * 100).toFixed(0)),
      cpuElectronPct: Number((((after.cpu.electron - before.cpu.electron) / secs) * 100).toFixed(0)),
      cpuPtyChildrenPct: Number((((after.cpu.pty - before.cpu.pty) / secs) * 100).toFixed(0))
    }
    console.log('BENCH ' + JSON.stringify(row))
    if (mutResult) console.log('DOM MUTATIONS/s: ' + JSON.stringify(Object.fromEntries(Object.entries(mutResult).map(([k, v]) => [k, Math.round(v / SECONDS)]).sort((a, b) => b[1] - a[1]).slice(0, 15)), null, 1))
    if (rProfileResult) console.log('RENDERER PROFILE (self time, busy ' + (rProfileResult.totalMs - rProfileResult.idleMs) + ' ms of ' + rProfileResult.totalMs + ' ms)' + String.fromCharCode(10) + rProfileResult.top.join(String.fromCharCode(10)))
    if (profileResult) console.log('MAIN PROFILE (self time, busy ' + (profileResult.totalMs - profileResult.idleMs) + ' ms of ' + profileResult.totalMs + ' ms)' + String.fromCharCode(10) + profileResult.top.join(String.fromCharCode(10)))
  } finally {
    if (app) app.kill()
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
