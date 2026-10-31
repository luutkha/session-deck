// E2E (D50): sessions that were running when the app quit start again on the next launch, in the background.
// A fake `claude` on PATH records every start with its arguments (no real Claude, ~/.claude untouched).
// Verifies: running -> resumed with --resume and no click; closed and sleeping -> not started; a crash (hard kill)
// keeps the list too; the Settings > General switch turns it off.
// Run: node scripts/e2e-resume-launch.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9439

function writeFakeClaude(binDir) {
  const events = path.join(binDir, 'events.log')
  fs.writeFileSync(events, '')
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n')
  fs.writeFileSync(
    path.join(binDir, 'fake-claude.js'),
    `const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(events)}, JSON.stringify({ args }) + '\\n')
process.stdout.write('fake claude\\r\\n> ')
process.stdin.resume()
setInterval(() => {}, 1 << 30)
`
  )
  return events
}

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-resume-'))
  const binDir = path.join(root, 'bin')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(binDir)
  fs.mkdirSync(proj)
  const eventsFile = writeFakeClaude(binDir)
  process.env.PATH = binDir + path.delimiter + process.env.PATH
  const js = (value) => JSON.stringify(value)
  const starts = () => fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).args)
  const startsOf = (session) => starts().filter((args) => args.includes(session.claudeSessionId))
  const clearStarts = () => fs.writeFileSync(eventsFile, '')

  const relaunch = async (graceful) => {
    if (graceful) {
      await app.evaluate('window.api.quitApp()').catch(() => undefined)
      await sleep(4000)
    }
    app.kill()
    await sleep(1500)
    clearStarts()
    app = await launchApp({ port: PORT, userData })
    await sleep(500)
  }
  let userData

  try {
    app = await launchApp({ port: PORT })
    userData = app.userData
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const mk = (name) => ev(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)} })`)
    const running = await mk('keeps-running')
    const closed = await mk('gets-closed')
    const slept = await mk('goes-to-sleep')
    await waitFor(() => starts().length >= 3, 15000, 300)
    await ev(`window.api.closeSession(${js(closed.id)})`)
    await ev(`window.api.sleepSession(${js(slept.id)})`)
    await sleep(1800) // let the debounced list reach disk

    // ---- graceful quit and relaunch, no clicks
    await relaunch(true)
    const resumed = await waitFor(() => startsOf(running).length > 0, 15000, 300)
    t.check('the session that was running starts again on launch, without a click', !!resumed)
    t.check('...resuming its conversation (--resume)', (startsOf(running)[0] ?? []).includes('--resume'), js(startsOf(running)))
    await sleep(2000)
    t.check('the closed session is not started', startsOf(closed).length === 0)
    t.check('the sleeping session is not started', startsOf(slept).length === 0)
    const rt = (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === running.id)
    t.check('main reports it running', rt?.run === 'running', js(rt))

    // ---- a crash (hard kill) keeps the list as well
    await sleep(1500)
    await relaunch(false)
    t.check('after a crash the running session starts again too', !!(await waitFor(() => startsOf(running).length > 0, 15000, 300)))

    // ---- Settings > General switch off
    const center = (expr) => app.evaluate(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label) => {
      const point = await waitFor(() => center(expr), 6000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(400)
    }
    await click(`document.querySelector('[aria-label="Settings"]')`, 'Settings')
    const sw = await waitFor(() => app.evaluate(`document.querySelector('#general-resume-running')?.getAttribute('aria-checked') ?? null`), 6000, 200)
    t.check('Settings > General shows the switch, on by default', sw === 'true', String(sw))
    await click(`document.querySelector('#general-resume-running')`, 'resume switch')
    const off = await waitFor(async () => (await app.evaluate('window.api.getStore()')).data.settings?.launch?.resumeRunning === false, 5000, 200)
    t.check('turning it off is saved', !!off)
    await relaunch(true)
    await sleep(4000)
    t.check('with the switch off nothing starts on launch', startsOf(running).length === 0, js(starts()))
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
