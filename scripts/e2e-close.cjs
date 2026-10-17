// E2E: closing a session stops its process and marks it closed; reopening resumes it. Run: node scripts/e2e-close.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9341 })
    const session = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'close me' })`)
    const id = JSON.stringify(session.id)
    const running = await waitFor(async () => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === session.id && r.run === 'running'), 15000)
    t.check('session starts and runs', !!running)

    await app.evaluate(`window.api.closeSession(${id})`)
    const closed = await waitFor(async () => {
      const s = await app.evaluate('window.api.getStore()')
      const rec = s.data.sessions.find((x) => x.id === session.id)
      const rt = s.runtime.find((r) => r.sessionId === session.id)
      return rec && typeof rec.closedAt === 'number' && rt && rt.run === 'exited' ? rec : null
    }, 15000)
    t.check('closeSession: marked closed (closedAt) and process stopped', !!closed)
    t.check('closed session keeps name, folder and conversation id', !!closed && closed.name === 'close me' && closed.cwd === ROOT && closed.claudeSessionId === session.claudeSessionId)

    await app.evaluate(`window.api.setActiveSession(${id})`)
    await sleep(2500)
    const stillClosed = (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === session.id)
    t.check('a closed session never auto-starts when selected', !stillClosed || stillClosed.run === 'exited')

    // Reopen right away: must succeed even if the old process is still shutting down.
    let reopenError = null
    try { await app.evaluate(`window.api.reopenSession(${id})`) } catch (e) { reopenError = String(e.message || e) }
    t.check('reopenSession succeeds', reopenError === null, reopenError ?? '')
    const reopened = await waitFor(async () => {
      const s = await app.evaluate('window.api.getStore()')
      const rec = s.data.sessions.find((x) => x.id === session.id)
      const rt = s.runtime.find((r) => r.sessionId === session.id)
      return rec && rec.closedAt === undefined && rt && rt.run === 'running' ? rec : null
    }, 20000)
    t.check('reopened: closedAt cleared and process running again', !!reopened)

    // Race: close and reopen in the same instant (the old process is still shutting down).
    let raceError = null
    try { await app.evaluate(`(async () => { await window.api.closeSession(${id}); await window.api.reopenSession(${id}); return true })()`) } catch (e) { raceError = String(e.message || e) }
    t.check('close then instant reopen works (waits for the old process to exit)', raceError === null, raceError ?? '')
    const racedUp = await waitFor(async () => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === session.id && r.run === 'running'), 20000)
    t.check('and the session is running again afterwards', !!racedUp)

    await app.evaluate(`window.api.closeSession(${id})`)
    await app.evaluate(`window.api.removeSession(${id})`)
    const gone = await waitFor(async () => !(await app.evaluate('window.api.getStore()')).data.sessions.some((x) => x.id === session.id), 10000)
    t.check('a closed session can be removed for good', !!gone)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
