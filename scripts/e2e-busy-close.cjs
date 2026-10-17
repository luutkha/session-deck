// A BUSY session (claude running a long shell command) is closed with the real tab "x" button.
// Are claude AND its child processes (the shell command) really gone afterwards?
const { execSync } = require('node:child_process')
const { ROOT, sleep, waitFor, strip, launchApp } = require('./e2e-lib.cjs')

const marker = `127.0.0.${Math.floor(Math.random() * 200 + 20)}`
function procs() {
  const out = execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -match 'claude' -or $_.CommandLine -match '${marker.replace(/\./g, '\\.')}') -and $_.CommandLine -notmatch 'probe-busy|Get-CimInstance' -and $_.Name -notmatch 'electron' } | ForEach-Object { ('{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, $_.CommandLine.Substring(0, [Math]::Min(100, $_.CommandLine.Length))) }"`,
    { encoding: 'utf8' }
  )
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}
const centerOf = (app, pick) => app.evaluate(`(() => { const el = (${pick}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
async function clickAt(app, c) {
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
}

async function main() {
  const baseline = new Set(procs().map((l) => l.split('|')[0]))
  const app = await launchApp({ port: 9368 })
  try {
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'busy probe' })`)
    const id = JSON.stringify(s.id)
    await sleep(1500)
    await clickAt(app, await waitFor(() => centerOf(app, `[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('busy probe'))`), 8000))
    await waitFor(async () => /[A-Za-z]{6,}/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 40000, 1000)
    for (let i = 0; i < 3; i += 1) { await app.evaluate(`window.api.ptyWrite(${id}, '\\r')`); await sleep(2500) }
    await app.evaluate(`window.api.ptyWrite(${id}, 'Run this shell command and wait for it: ping -n 600 ${marker}')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${id}, '\\r')`)
    const pinging = await waitFor(() => procs().some((l) => !baseline.has(l.split('|')[0]) && /ping/i.test(l.split('|')[2])), 120000, 2000)
    const during = procs().filter((l) => !baseline.has(l.split('|')[0]))
    console.log(`DURING: claude started a ping child: ${!!pinging}; ${during.length} related processes:`)
    during.forEach((l) => console.log('  ' + l))

    // Real UI: click the tab's close (x) button.
    const x = await centerOf(app, `[...document.querySelectorAll('[role="tab"]')].find((n) => n.innerText.includes('busy probe'))?.querySelector('button')`)
    console.log('tab close button at', JSON.stringify(x))
    await clickAt(app, x)
    await sleep(500)
    const closed = await waitFor(async () => { const st = await app.evaluate('window.api.getStore()'); const rec = st.data.sessions.find((q) => q.id === s.id); return rec && typeof rec.closedAt === 'number' }, 15000)
    console.log('session marked closed by the tab x button:', !!closed)
    await sleep(5000)
    const after = procs().filter((l) => !baseline.has(l.split('|')[0]))
    console.log(`AFTER: ${after.length} related processes still alive`)
    after.forEach((l) => console.log('  ' + l))
    console.log(after.length === 0 ? 'RESULT: everything was terminated' : 'RESULT: LEAK - processes survived closing the tab')
    process.exitCode = after.length === 0 && pinging ? 0 : 1
    // clean up any leak so it does not keep running
    for (const l of after) { try { execSync(`taskkill /PID ${l.split('|')[0]} /T /F`, { stdio: 'ignore' }) } catch { /* gone */ } }
  } finally {
    app.kill()
  }
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
