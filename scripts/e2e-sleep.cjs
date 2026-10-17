// E2E: session sleep. Manual sleep + wake (same conversation id), then the idle timer (1 minute, so this takes ~2 min).
// Run: node scripts/e2e-sleep.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const runtimeOf = async (app, id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)
const click = (app, text) =>
  app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes(${JSON.stringify(text)})).click()`)

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9396 })
    await sleep(1500)
    const a = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'sleeper' })`)
    const b = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'other' })`)
    await sleep(2000)
    await click(app, 'other') // 'other' is the active one; 'sleeper' is in the background

    // ---- manual sleep
    await app.evaluate(`window.api.sleepSession(${JSON.stringify(a.id)})`)
    const asleep = await waitFor(async () => (await runtimeOf(app, a.id))?.sleeping === true, 8000, 300)
    t.check('sleepSession marks the session sleeping', !!asleep)
    const st = await runtimeOf(app, a.id)
    t.check('a sleeping session is not "running"', st?.run === 'exited')
    const stored = (await app.evaluate('window.api.getStore()')).data.sessions.find((s) => s.id === a.id)
    t.check('the card is kept (not closed), same claude conversation id', stored && stored.closedAt === undefined && !!stored.claudeSessionId)
    const convo = stored.claudeSessionId

    // ---- wake by activating it
    await click(app, 'sleeper')
    const awake = await waitFor(async () => { const r = await runtimeOf(app, a.id); return r?.run === 'running' && !r.sleeping }, 20000, 400)
    t.check('opening a sleeping session wakes it (running, not sleeping)', !!awake)
    const after = (await app.evaluate('window.api.getStore()')).data.sessions.find((s) => s.id === a.id)
    t.check('it resumed the same conversation id', after?.claudeSessionId === convo)

    // ---- idle timer
    await click(app, 'other')
    await app.evaluate('window.api.updateSettings({ sleep: { enabled: true, afterMinutes: 1 } })')
    const timed = await waitFor(async () => (await runtimeOf(app, a.id))?.sleeping === true, 150000, 2000)
    t.check('idle timer puts the background session to sleep (1 min)', !!timed)
    const activeStill = await runtimeOf(app, b.id)
    t.check('the active session is never put to sleep', activeStill?.run === 'running' && !activeStill.sleeping)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
