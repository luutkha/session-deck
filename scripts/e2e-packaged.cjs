// Smoke test for the PACKAGED app (release/win-unpacked/SessionDeck.exe), not the dev build.
// Proves: the window shows, the preload API works, node-pty (native, unpacked from asar) spawns a real `claude`
// session, real claude output arrives through ptyReplay, and closing the session leaves no process tree behind.
// Run after `npm run dist:dir`:  npm run e2e:packaged
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, sleep, waitFor, strip, makeChecker, launchApp } = require('./e2e-lib.cjs')

const EXE = path.join(ROOT, 'release', 'win-unpacked', 'SessionDeck.exe')
const PORT = 9345
const APP_IMAGE = 'sessiondeck.exe'
const CLAUDE_ENTER_PRESSES = 3

/** All processes as a parent->children index. Windows only (uses CIM). */
function processTable() {
  const json = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"',
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const rows = JSON.parse(json.trim() || '[]')
  return Array.isArray(rows) ? rows : [rows]
}

/** Descendants of `rootPid` (not including it). */
function descendantsOf(rootPid, table) {
  const children = new Map()
  for (const row of table) {
    if (!children.has(row.ParentProcessId)) children.set(row.ParentProcessId, [])
    children.get(row.ParentProcessId).push(row)
  }
  const out = []
  const stack = [rootPid]
  while (stack.length) {
    const pid = stack.pop()
    for (const child of children.get(pid) ?? []) {
      out.push(child)
      stack.push(child.ProcessId)
    }
  }
  return out
}

/** Session PTY tree: every descendant of the app that is not an Electron process of the app itself. */
const ptyTree = (rootPid) => descendantsOf(rootPid, processTable()).filter((p) => (p.Name ?? '').toLowerCase() !== APP_IMAGE)
const describe = (rows) => rows.map((p) => `${p.ProcessId} ${p.Name} <- ${p.ParentProcessId}`).join('; ')

async function main() {
  const check = makeChecker()
  if (!fs.existsSync(EXE)) {
    check.check('packaged exe exists', false, `${EXE} (run npm run dist:dir first)`)
    return check.summary()
  }
  check.check('packaged exe exists', true, path.relative(ROOT, EXE))

  const app = await launchApp({ port: PORT, exePath: EXE })
  try {
    const shown = await waitFor(() => {
      try { return fs.readFileSync(path.join(app.userData, 'window-events.log'), 'utf8').includes(' show') } catch { return false }
    }, 15000)
    check.check('window is shown (window-events.log has show)', !!shown)

    const apiOk = await app.evaluate('typeof window.api === "object" && typeof window.api.createSession === "function" && typeof window.api.ptyReplay === "function"')
    check.check('window.api preload bridge exists', apiOk === true)

    const text = await waitFor(() => app.evaluate('document.body.innerText.trim().length > 0 ? document.body.innerText.slice(0, 200) : null'), 10000)
    check.check('UI renders text (not a blank window)', !!text)

    const session = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'packaged probe' })`)
    const id = JSON.stringify(session.id)
    check.check('createSession returns a session', !!session?.id)

    const running = await waitFor(async () => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === session.id && r.run === 'running'), 30000)
    check.check('PTY starts (runtime.run === running)', !!running)

    const table = await waitFor(() => { const t = ptyTree(app.pid); return t.length > 0 ? t : null }, 15000)
    check.check('session process tree exists under the packaged app', !!table, table ? describe(table.slice(0, 4)) : 'no non-Electron descendants')

    // Real claude output: letters from the TUI, not just escape codes. Enter is pressed a few times to get past
    // first-run prompts (folder trust); extra Enters on an idle prompt are harmless.
    let enters = 0
    let lastReplay = ''
    const gotOutput = await waitFor(async () => {
      const rep = await app.evaluate(`window.api.ptyReplay(${id})`)
      lastReplay = strip(rep.data)
      if (rep.seq > 0 && /[A-Za-z]{6,}/.test(lastReplay)) return true
      if (enters < CLAUDE_ENTER_PRESSES) {
        enters += 1
        await app.evaluate(`window.api.ptyWrite(${id}, '\\r')`)
      }
      return null
    }, 90000, 2500)
    check.check('real claude output arrives via ptyReplay (letters)', !!gotOutput, gotOutput ? '' : 'no letters in replay')
    const mentionsClaude = /claude/i.test(lastReplay)
    check.check('claude output mentions "Claude"', mentionsClaude)
    console.log('--- last replay (escapes stripped, tail):\n' + lastReplay.replace(/\s+/g, ' ').slice(-400))

    await app.evaluate(`window.api.closeSession(${id})`)
    const exited = await waitFor(async () => {
      const r = (await app.evaluate('window.api.getStore()')).runtime.find((x) => x.sessionId === session.id)
      return !r || r.run !== 'running'
    }, 20000)
    check.check('closeSession stops the runtime', !!exited)

    // A bare conhost.exe (Windows console host) can outlive a closed session by design of ConPTY; it dies with the app. Only real session processes count.
    const sessionProcs = () => ptyTree(app.pid).filter((p) => (p.Name ?? '').toLowerCase() !== 'conhost.exe')
    const gone = await waitFor(() => sessionProcs().length === 0, 20000, 1000)
    const left = sessionProcs()
    check.check('closing leaves no session process tree behind', !!gone, gone ? '' : describe(left))

    const errorsLog = path.join(app.userData, 'main-errors.log')
    check.check('no main-process errors logged', !fs.existsSync(errorsLog), fs.existsSync(errorsLog) ? fs.readFileSync(errorsLog, 'utf8').slice(0, 300) : '')
  } catch (error) {
    check.check('smoke test ran to completion', false, error.message)
  } finally {
    app.kill()
  }
  return check.summary()
}

main().then((failed) => { process.exitCode = failed ? 1 : 0 }).catch((error) => { console.log('ERR', error.message); process.exitCode = 1 })
