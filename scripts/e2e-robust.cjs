// E2E robustness: the renderer must not be able to crash or wedge the main process with IPC calls that
// arrive at a bad moment (typing into a stopped session, bogus ids/payloads), and quitting must keep the last changes.
// Run: node scripts/e2e-robust.cjs
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

function appLogText(userData) {
  return fs.readdirSync(userData).filter((f) => /^app-.*\.log$/.test(f)).map((f) => fs.readFileSync(path.join(userData, f), 'utf8')).join('\n')
}
const crashLines = (text) => text.split('\n').filter((l) => /uncaught|unhandled|a javascript error occurred|TypeError|Session not running/i.test(l))

async function main() {
  const t = makeChecker()
  let app
  try {
    console.log('launching...')
    app = await launchApp({ port: 9366 })
    console.log('launched')
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'robust' })`)
    const id = JSON.stringify(s.id)
    await waitFor(async () => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === s.id && r.run === 'running'), 15000)
    console.log('session running; closing')
    await app.evaluate(`window.api.closeSession(${id})`)
    await waitFor(async () => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === s.id && r.run === 'exited'), 15000)

    console.log('closed; sending late IPC')
    // Typing / resizing / attention calls that arrive after the process is gone, and for ids that never existed.
    await app.evaluate(`(() => { window.api.ptyWrite(${id}, 'late keystroke'); window.api.ptyResize(${id}, 80, 24); window.api.clearAttention(${id}); window.api.setActiveSession(${id}); window.api.ptyWrite('no-such-id', 'x'); window.api.ptyResize('no-such-id', 80, 24); window.api.clearAttention('no-such-id'); window.api.setActiveSession('no-such-id'); return true })()`)
    await sleep(1500)
    const alive = await app.evaluate('typeof window.api.getStore === "function"')
    t.check('app still responds after writes/resizes to a stopped or unknown session', alive)
    const bad = crashLines(appLogText(app.userData))
    t.check('main process logged no uncaught exception for those calls', bad.length === 0, bad.slice(0, 2).join(' | ').slice(0, 200))

    // Payload validation on the invoke channels.
    const rejected = await app.evaluate(`(async () => { try { await window.api.createSession({ cwd: 42, claudeArgs: 'rm -rf' }); return false } catch (e) { return true } })()`)
    t.check('createSession with a malformed payload is rejected', rejected)
    const rejectedArgs = await app.evaluate(`(async () => { try { await window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, claudeArgs: ['a b', '&calc'] }); return false } catch (e) { return true } })()`)
    t.check('createSession with unsafe claudeArgs is rejected', rejectedArgs)
    const storeAfter = (await app.evaluate('window.api.getStore()')).data.sessions.filter((x) => x.name !== 'robust' && x.cwd === ROOT).length
    t.check('rejected requests did not leave sessions behind', storeAfter === 0, `leftover=${storeAfter}`)

    // Quit must persist the very last change (the saver is debounced).
    await app.evaluate(`window.api.renameSession(${id}, 'renamed right before quit')`)
    // Close the window like a user does: that runs the app's graceful quit path (a hard kill would skip it).
    await app.evaluate('window.close()').catch(() => undefined)
    await sleep(6000)
    app.kill() // only cleans up stragglers if the app failed to exit by itself
    await sleep(1500)
    app = await launchApp({ port: 9366, userData: app.userData })
    const after = (await app.evaluate('window.api.getStore()')).data.sessions.find((x) => x.id === s.id)
    t.check('a change made just before the app is closed is still saved', !!after && after.name === 'renamed right before quit', after ? after.name : 'session missing')
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
