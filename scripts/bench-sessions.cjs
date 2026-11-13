// Benchmark: many chatty sessions (performance work). Not a pass/fail suite; prints numbers to compare before/after a change.
// Starts N Shell sessions that each print a line every ~20 ms, opens every one once (so each gets a terminal pane),
// parks on one session, then measures for DURATION seconds: pty messages per second, renderer busy time (CDP
// Performance.getMetrics), frames per second, long tasks, JS heap, and CPU seconds of the whole app process tree.
// Run: npx electron-vite build && node scripts/bench-sessions.cjs [sessions=20] [seconds=15] [churn] [gpu=real|off|swiftshader]
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
const GPU_ARGS = {
  real: [],
  off: ['--disable-gpu'],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
}[GPU]
if (GPU_ARGS === undefined) throw new Error('gpu= must be real, off or swiftshader')
const js = (value) => JSON.stringify(value)

/** CPU seconds (user+kernel) of the app's whole process tree, via PowerShell. */
function treeCpuSeconds(rootPid) {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', '$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,UserModeTime,KernelModeTime; $p | ConvertTo-Json -Compress'],
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
  const groups = { electron: 0, pty: 0, other: 0 }
  while (stack.length > 0) {
    const pid = stack.pop()
    if (seen.has(pid)) continue
    seen.add(pid)
    const proc = byPid.get(pid)
    if (proc) {
      const seconds = (Number(proc.UserModeTime) + Number(proc.KernelModeTime)) / 1e7
      const name = String(proc.Name).toLowerCase()
      if (name === 'electron.exe') groups.electron += seconds
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
    app = await launchApp({ port: PORT, userData, extraArgs: GPU_ARGS })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    await app.send('Performance.enable')
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
    for (const id of ids) {
      await ev(`(() => { const n = document.querySelector('[data-session-card="${id}"]'); if (n) n.click(); })()`)
      await sleep(250)
      await ev(`window.api.ptyWrite(${js(id)}, ${js(chatty + '\r')})`)
      await sleep(150)
    }
    await ev(`(() => { const n = document.querySelector('[data-session-card="${ids[0]}"]'); if (n) n.click(); })()`)
    await sleep(3000) // let every loop start and the UI settle

    const metrics = async () => Object.fromEntries((await app.send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]))
    const before = { m: await metrics(), b: await ev('({ ...window.__bench })'), cpu: treeCpuSeconds(app.pid), t: Date.now() }
    let churnTimer = null
    if (CHURN) {
      let n = 0
      churnTimer = setInterval(() => { n += 1; void ev(`window.api.setSessionNotes(${js(ids[n % ids.length])}, ${js('note ' + n)})`).catch(() => undefined) }, 100)
    }
    await sleep(SECONDS * 1000)
    if (churnTimer !== null) clearInterval(churnTimer)
    const after = { m: await metrics(), b: await ev('({ ...window.__bench })'), cpu: treeCpuSeconds(app.pid), t: Date.now() }
    const secs = (after.t - before.t) / 1000
    const d = (key) => after.m[key] - before.m[key]
    const row = {
      sessions: SESSIONS,
      gpu: GPU,
      churn: CHURN,
      seconds: Number(secs.toFixed(1)),
      ptyMsgsPerSec: Math.round((after.b.msgs - before.b.msgs) / secs),
      ptyKBPerSec: Math.round((after.b.bytes - before.b.bytes) / secs / 1024),
      framesPerSec: Number(((after.b.frames - before.b.frames) / secs).toFixed(1)),
      longTasksPerSec: Number(((after.b.longTasks - before.b.longTasks) / secs).toFixed(2)),
      rendererBusyPct: Number(((d('TaskDuration') / secs) * 100).toFixed(1)),
      rendererScriptPct: Number(((d('ScriptDuration') / secs) * 100).toFixed(1)),
      jsHeapMB: Number((after.m.JSHeapUsedSize / 1048576).toFixed(0)),
      domNodes: after.m.Nodes,
      cpuElectronPct: Number((((after.cpu.electron - before.cpu.electron) / secs) * 100).toFixed(0)),
      cpuPtyChildrenPct: Number((((after.cpu.pty - before.cpu.pty) / secs) * 100).toFixed(0))
    }
    console.log('BENCH ' + JSON.stringify(row))
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
