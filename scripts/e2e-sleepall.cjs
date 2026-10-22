// E2E: "Sleep everything when idle". Turned on through the real Settings switch, 1 minute. A real key press
// postpones it; then every session sleeps, the one on screen too, except a Keep-awake session. Takes ~4 min.
// Run: node scripts/e2e-sleepall.cjs   (E2E_SHOT_DIR=<dir> saves a screenshot of the settings block)
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const runtimeOf = async (app, id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)
const isAsleep = async (app, id) => (await runtimeOf(app, id))?.sleeping === true
const clickCard = (app, text) =>
  app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes(${JSON.stringify(text)})).click()`)
const clickButton = (app, text) =>
  app.evaluate(`[...document.querySelectorAll('[role=dialog] button')].find((n) => n.innerText.trim() === ${JSON.stringify(text)}).click()`)

async function pressShift(app) {
  await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
}

async function pressEscape(app) {
  await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

async function shot(app, name) {
  const dir = process.env.E2E_SHOT_DIR
  if (!dir) return
  const r = await app.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(dir, name), Buffer.from(r.result.data, 'base64'))
}

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9397 })
    await sleep(1500)
    const create = (name) => app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: ${JSON.stringify(name)} })`)
    const front = await create('front')
    const back = await create('back')
    const kept = await create('kept')
    await app.evaluate(`window.api.setKeepAwake(${JSON.stringify(kept.id)}, true)`)
    await sleep(1500)
    await clickCard(app, 'front')

    // ---- Settings > Automation: the new switch, clicked for real
    await app.evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
    await waitFor(() => app.evaluate('!!document.querySelector("[role=dialog]")'), 6000)
    await clickButton(app, 'Automation')
    const shown = await waitFor(() => app.evaluate('!!document.getElementById("automation-sleep-all-enabled")'), 5000)
    t.check('Settings > Automation shows "Sleep everything when idle"', !!shown)
    const disabledBefore = await app.evaluate('document.getElementById("automation-sleep-all-after").disabled')
    t.check('the minutes box is disabled while the switch is off', disabledBefore === true)
    await app.evaluate('document.getElementById("automation-sleep-all-enabled").click()')
    const on = await waitFor(async () => (await app.evaluate('window.api.getStore()')).data.settings?.sleep?.allEnabled === true, 5000)
    t.check('clicking the switch saves sleep.allEnabled = true', !!on)
    const enabledAfter = await waitFor(() => app.evaluate('document.getElementById("automation-sleep-all-after").disabled === false'), 3000)
    t.check('the minutes box is enabled after switching on', !!enabledAfter)
    await app.evaluate('window.api.updateSettings({ sleep: { allAfterMinutes: 1 } })')
    await sleep(500)
    await shot(app, 'settings-sleepall.png')
    const bad = await app.evaluate('window.api.updateSettings({ sleep: { allAfterMinutes: 0 } }).then(() => "accepted", () => "rejected")')
    t.check('allAfterMinutes 0 is rejected by main', bad === 'rejected')
    const perSession = (await app.evaluate('window.api.getStore()')).data.settings?.sleep?.enabled
    t.check('the per-session idle timer stays off (only sleep-all is on)', perSession === false)
    await pressEscape(app) // last user input before the idle wait
    const lastInputAt = Date.now()

    // ---- a real key press postpones it
    await sleep(45000)
    await pressShift(app)
    const pingAt = Date.now()
    await sleep(50000) // without the key press it would have fired by now (60 s idle + 30 s tick)
    const early = (await isAsleep(app, front.id)) || (await isAsleep(app, back.id))
    t.check('a key press postpones sleep-all (nothing asleep 95 s after the last Escape)', !early, `${Math.round((Date.now() - lastInputAt) / 1000)} s`)

    // ---- then everything sleeps, except Keep awake
    const all = await waitFor(async () => (await isAsleep(app, front.id)) && (await isAsleep(app, back.id)), 120000, 2000)
    const firedAfter = Math.round((Date.now() - pingAt) / 1000)
    t.check('after 1 idle minute every session sleeps', !!all, `${firedAfter} s after the key press`)
    t.check('it did not fire before a full minute after the key press', firedAfter >= 60, `${firedAfter} s`)
    t.check('the session on screen slept too', await isAsleep(app, front.id))
    const keptState = await runtimeOf(app, kept.id)
    t.check('the Keep-awake session is still running', keptState?.run === 'running' && !keptState.sleeping)

    // ---- waking still works
    await clickCard(app, 'back')
    const awake = await waitFor(async () => { const r = await runtimeOf(app, back.id); return r?.run === 'running' && !r.sleeping }, 20000, 400)
    t.check('opening a slept session wakes it', !!awake)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
