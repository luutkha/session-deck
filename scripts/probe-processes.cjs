// Does closing a session really terminate the claude process tree at the OS level? Lists processes before/after.
const { execSync } = require('node:child_process')
const { ROOT, sleep, waitFor, launchApp } = require('./e2e-lib.cjs')

function claudeProcs() {
  const out = execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'claude' -and $_.CommandLine -notmatch 'probe-processes|Get-CimInstance' -and $_.Name -notmatch 'electron' } | ForEach-Object { ('{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, $_.CommandLine.Substring(0, [Math]::Min(110, $_.CommandLine.Length))) }"`,
    { encoding: 'utf8' }
  )
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}

async function main() {
  const baseline = new Set(claudeProcs().map((l) => l.split('|')[0]))
  console.log('claude-related processes already running (ignored):', baseline.size)
  const app = await launchApp({ port: 9367 })
  try {
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'proc probe' })`)
    const id = JSON.stringify(s.id)
    await waitFor(async () => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === s.id && r.run === 'running'), 15000)
    await sleep(9000)
    const during = claudeProcs().filter((l) => !baseline.has(l.split('|')[0]))
    console.log(`\nDURING (${during.length} new processes):`)
    during.forEach((l) => console.log('  ' + l))

    await app.evaluate(`window.api.closeSession(${id})`)
    await waitFor(async () => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === s.id && r.run === 'exited'), 15000)
    await sleep(4000)
    const after = claudeProcs().filter((l) => !baseline.has(l.split('|')[0]))
    console.log(`\nAFTER closeSession (${after.length} new processes still alive):`)
    after.forEach((l) => console.log('  ' + l))
    console.log(after.length === 0 ? '\nRESULT: process tree fully terminated' : '\nRESULT: LEAK - processes survived the close')
  } finally {
    app.kill()
  }
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
