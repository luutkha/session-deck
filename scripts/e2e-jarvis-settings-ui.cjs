// E2E (D80): the two opt-in Jarvis switches in the real built app, driven through the real Settings dialog.
// Settings > Agents: "Watch the fleet" (+ "Check every N minutes") and "Task plans". No Jarvis session and no model
// is needed: everything is checked through the UI, the stored settings and a restart with the same userData.
// Run: node scripts/e2e-jarvis-settings-ui.cjs   (needs the built app in out/, CDP port 9511)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9511
// The exact user-facing texts of src/renderer/settings/AgentsSection.tsx.
const WATCH_LABEL = 'Watch the fleet'
const MINUTES_LABEL = 'Check every N minutes'
const MINUTES_MESSAGE = 'Enter a whole number from 1 to 120.'
const WATCH_HELP =
  "Jarvis checks your sessions on a timer and is told when one waits for you for 3+ minutes or looks stuck for 20+ minutes. Off by default. It uses Jarvis's model only when something needs attention."
const PLANS_LABEL = 'Task plans'
const PLANS_HELP =
  'Lets Jarvis split a goal into steps that run in several sessions (plan_create). Off by default. Turning it off cancels plans that are running; sessions already working are left alone.'

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`
const byLabel = (label) => `[aria-label="${label}"]`

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-jarvis-settings-'))
  const shotPath = path.join(userData, 'agents-watch-on.png')
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    let ev = (expression) => app.evaluate(expression)

    // Renderer errors: the lib does not expose CDP event listeners, so hook the page itself (uncaught errors,
    // unhandled rejections and console.error all land in window.__e2eErrors).
    const hookErrors = async () =>
      ev(`(() => {
        window.__e2eErrors = window.__e2eErrors || []
        window.addEventListener('error', (e) => window.__e2eErrors.push('uncaught: ' + String((e && (e.message || e.error)) || '')))
        window.addEventListener('unhandledrejection', (e) => window.__e2eErrors.push('rejection: ' + String(e && e.reason)))
        if (!window.__e2eConsoleHooked) {
          window.__e2eConsoleHooked = true
          const original = console.error
          console.error = (...args) => { window.__e2eErrors.push('console.error: ' + args.map((a) => String(a)).join(' ')); original(...args) }
        }
        return true
      })()`)

    const centerOf = (pick) =>
      ev(`(() => { const el = ${pick}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const press = async (point) => {
      if (!point) throw new Error('nothing to click')
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
      await sleep(400)
    }
    const click = async (pick, label) => {
      const point = await waitFor(() => centerOf(pick), 8000, 200)
      if (!point) throw new Error(`target not found: ${label}`)
      await press(point)
    }
    const keyDown = (key, code, vk, modifiers = 0) =>
      app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    const keyUp = (key, code, vk, modifiers = 0) =>
      app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    const pressKey = async (key, code, vk) => { await keyDown(key, code, vk); await keyUp(key, code, vk); await sleep(250) }
    const escape = async () => { await pressKey('Escape', 'Escape', 27); await sleep(400) }

    // Real typing (char events, so a number input filters letters exactly as a person would see).
    const typeText = async (text) => {
      for (const ch of text) {
        await app.send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch })
        await sleep(40)
      }
      await sleep(150)
    }
    const clearMinutes = async () => {
      await ev(`${q(byLabel(MINUTES_LABEL))}.focus()`)
      await keyDown('a', 'KeyA', 65, 2)
      await keyUp('a', 'KeyA', 65, 2)
      await pressKey('Backspace', 'Backspace', 8)
      await sleep(150)
    }
    // Blur by moving focus to a neutral field of the section (a real focusout, no accidental clicks on labels).
    const blurMinutes = async () => {
      await ev(`${q('#agents-jarvis-model')}.focus()`)
      await sleep(350)
    }
    // StoreData.settings is absent until the first write, which means DEFAULT_APP_SETTINGS (both off, 10 minutes).
    const STORE_DEFAULTS = { watchEnabled: false, watchEveryMinutes: 10, plansEnabled: false }
    const jarvisSettings = async () => {
      const store = await ev('window.api.getStore()')
      const settings = store && store.data ? store.data.settings : null
      return settings && settings.jarvis ? settings.jarvis : STORE_DEFAULTS
    }
    const switchChecked = (label) => ev(`${q(byLabel(label))}?.getAttribute('aria-checked') ?? null`)
    const minutesValue = () => ev(`${q(byLabel(MINUTES_LABEL))}?.value ?? null`)
    const alerts = () => ev(`[...document.querySelectorAll('[role=dialog] [role=alert]')].map((n) => ({ text: n.innerText.trim(), red: /text-destructive/.test(n.className) }))`)
    const dialogText = () => ev(`document.querySelector('[role=dialog]')?.innerText ?? ''`)

    const openSettings = async (label) => {
      await click(`[...document.querySelectorAll('[aria-label="Settings"]')].find((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 })`, label)
      const open = await waitFor(() => ev(`document.querySelector('[role=dialog]') !== null`), 6000, 200)
      if (!open) throw new Error('the Settings dialog did not open')
      await click(`[...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText.trim() === 'Agents')`, 'Agents nav')
      const agents = await waitFor(() => ev(`!!${q(byLabel(WATCH_LABEL))}`), 6000, 200)
      if (!agents) throw new Error('the Agents section did not show the watch switch')
    }

    // ---- 1. the Agents section: both switches off, no minutes field, both help texts visible
    await hookErrors()
    await openSettings('Settings button')
    t.check('the Settings button opens the dialog and the Agents section is shown', true)

    const watchOff = await waitFor(async () => (await switchChecked(WATCH_LABEL)) === 'false', 5000, 200)
    t.check('"Watch the fleet" shows OFF', !!watchOff, String(await switchChecked(WATCH_LABEL)))
    const plansOff = (await switchChecked(PLANS_LABEL)) === 'false'
    t.check('"Task plans" shows OFF', plansOff, String(await switchChecked(PLANS_LABEL)))
    const stored0 = await jarvisSettings()
    t.check('both are off in the stored settings (D80 defaults)', stored0.watchEnabled === false && stored0.plansEnabled === false && stored0.watchEveryMinutes === 10, js(stored0))
    t.check('no "Check every N minutes" field while watch is off', await ev(`${q(byLabel(MINUTES_LABEL))} === null`))

    const text0 = norm(await dialogText())
    t.check('the WATCH_HELP text is visible', text0.includes(norm(WATCH_HELP)))
    t.check('the PLANS_HELP text is visible', text0.includes(norm(PLANS_HELP)))

    // ---- 2. clicking "Watch the fleet" turns it on, the minutes field appears with the stored 10
    await click(q(byLabel(WATCH_LABEL)), 'watch switch')
    const watchOn = await waitFor(async () => (await switchChecked(WATCH_LABEL)) === 'true', 6000, 200)
    t.check('clicking "Watch the fleet" turns the switch on', !!watchOn, String(await switchChecked(WATCH_LABEL)))
    const stored1 = await waitFor(async () => { const s = await jarvisSettings(); return s.watchEnabled === true ? s : null }, 6000, 200)
    t.check('the stored settings get jarvis.watchEnabled = true', !!stored1, js(await jarvisSettings()))
    const field = await waitFor(async () => (await minutesValue()) !== null, 5000, 200)
    t.check('the minutes field appears', !!field)
    t.check('the minutes field shows the stored 10', (await minutesValue()) === '10', String(await minutesValue()))

    // ---- 3. the minutes field rejects 0, 121, 2.5, abc and empty, and keeps the stored 10
    const bad = ['0', '121', '2.5', 'abc', '']
    for (const value of bad) {
      await clearMinutes()
      if (value !== '') await typeText(value)
      const typed = await minutesValue()
      await blurMinutes()
      const shown = await waitFor(async () => (await alerts()).find((a) => a.text === MINUTES_MESSAGE), 4000, 200)
      t.check(`typing ${JSON.stringify(value)} and blurring shows the red message`, !!shown && shown.red === true, `field=${JSON.stringify(typed)} alerts=${js(await alerts())}`)
      const stored = await jarvisSettings()
      t.check(`after ${JSON.stringify(value)} the stored watchEveryMinutes is still 10`, stored.watchEveryMinutes === 10, String(stored.watchEveryMinutes))
    }

    // ---- 3b. 25 + Enter stores 25; 30 + blur stores 30
    await clearMinutes()
    await typeText('25')
    await pressKey('Enter', 'Enter', 13)
    const stored25 = await waitFor(async () => (await jarvisSettings()).watchEveryMinutes === 25, 6000, 200)
    t.check('typing 25 and pressing Enter stores watchEveryMinutes = 25', !!stored25, String((await jarvisSettings()).watchEveryMinutes))
    const field25 = (await minutesValue()) === '25'
    const noAlert = (await alerts()).length === 0
    t.check('the field keeps 25 and the error message is gone', field25 && noAlert, js(await alerts()))

    await clearMinutes()
    await typeText('30')
    await blurMinutes()
    const stored30 = await waitFor(async () => (await jarvisSettings()).watchEveryMinutes === 30, 6000, 200)
    t.check('typing 30 and blurring stores watchEveryMinutes = 30', !!stored30, String((await jarvisSettings()).watchEveryMinutes))

    // ---- 4. "Task plans": click on, click off
    await click(q(byLabel(PLANS_LABEL)), 'plans switch')
    const plansOn = await waitFor(async () => { const s = await jarvisSettings(); return s.plansEnabled === true && (await switchChecked(PLANS_LABEL)) === 'true' ? s : null }, 6000, 200)
    t.check('clicking "Task plans" stores plansEnabled = true and shows the switch on', !!plansOn, js(await jarvisSettings()))
    await click(q(byLabel(PLANS_LABEL)), 'plans switch again')
    const plansBack = await waitFor(async () => { const s = await jarvisSettings(); return s.plansEnabled === false && (await switchChecked(PLANS_LABEL)) === 'false' ? s : null }, 6000, 200)
    t.check('clicking it again stores plansEnabled = false', !!plansBack, js(await jarvisSettings()))

    // ---- 5. changes made from outside the dialog reach the open UI
    await ev(`window.api.updateSettings({ jarvis: { watchEveryMinutes: 45 } })`)
    const outside45 = await waitFor(async () => (await minutesValue()) === '45', 6000, 200)
    t.check('updateSettings({ jarvis: { watchEveryMinutes: 45 } }) outside the dialog updates the open field to 45', !!outside45, String(await minutesValue()))

    await ev(`window.api.updateSettings({ jarvis: { watchEnabled: false } })`)
    const outsideOff = await waitFor(async () => (await switchChecked(WATCH_LABEL)) === 'false' && (await ev(`${q(byLabel(MINUTES_LABEL))} === null`)), 6000, 200)
    t.check('switching watch off from outside hides the field and shows the switch off', !!outsideOff)

    await ev(`window.api.updateSettings({ jarvis: { watchEnabled: true } })`)
    const outsideOn = await waitFor(async () => (await switchChecked(WATCH_LABEL)) === 'true' && (await minutesValue()) === '45', 6000, 200)
    t.check('switching watch on from outside shows the switch on and the stored 45 again', !!outsideOn, `${await switchChecked(WATCH_LABEL)} / ${await minutesValue()}`)

    // ---- 7. keyboard: focus the Task plans switch and press Space
    await ev(`${q(byLabel(PLANS_LABEL))}.focus()`)
    await sleep(200)
    const focused = await ev(`document.activeElement === ${q(byLabel(PLANS_LABEL))}`)
    t.check('the switch takes keyboard focus', focused)
    await pressKey(' ', 'Space', 32)
    const spaceOn = await waitFor(async () => (await jarvisSettings()).plansEnabled === true, 6000, 200)
    t.check('Space toggles the switch on', !!spaceOn, js((await jarvisSettings()).plansEnabled))
    await pressKey(' ', 'Space', 32)
    const spaceOff = await waitFor(async () => (await jarvisSettings()).plansEnabled === false, 6000, 200)
    t.check('Space toggles it off again', !!spaceOff, js((await jarvisSettings()).plansEnabled))

    // ---- screenshot with watch on (temp folder, not the repo)
    await ev(`${q(byLabel(PLANS_LABEL))}.scrollIntoView({ block: 'center' })`)
    await sleep(500)
    await app.send('Page.enable')
    const shot = await app.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))
    t.check('screenshot of the Agents section with watch on was saved', fs.existsSync(shotPath) && fs.statSync(shotPath).size > 1000, shotPath)

    // ---- 6a. close and reopen the dialog: the switches and the minutes value reflect the stored values
    await escape()
    const closed = await waitFor(() => ev(`document.querySelector('[role=dialog]') === null`), 5000, 200)
    t.check('Escape closes the dialog', !!closed)
    await openSettings('Settings button (2)')
    const reopenOk = await waitFor(async () => (await switchChecked(WATCH_LABEL)) === 'true' && (await minutesValue()) === '45' && (await switchChecked(PLANS_LABEL)) === 'false', 6000, 200)
    t.check('reopening the dialog shows watch on, 45 minutes and task plans off', !!reopenOk, `${await switchChecked(WATCH_LABEL)} / ${await minutesValue()} / ${await switchChecked(PLANS_LABEL)}`)

    const errorsBefore = await ev('window.__e2eErrors.slice()')
    t.check('no renderer console errors or uncaught exceptions while using the switches', Array.isArray(errorsBefore) && errorsBefore.length === 0, js(errorsBefore))

    // ---- 6b. restart with the same userData: the stored values and the switches survive
    await escape()
    app.kill()
    app = null
    const portFree = await waitFor(async () => { try { await fetch(`http://127.0.0.1:${PORT}/json`); return false } catch { return true } }, 20000, 500)
    t.check('the app is gone and the CDP port is free', !!portFree)
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    ev = (expression) => app.evaluate(expression)
    await hookErrors()
    const afterRestart = await jarvisSettings()
    t.check('after a restart the stored settings are still watch on, 45 minutes, task plans off', afterRestart.watchEnabled === true && afterRestart.watchEveryMinutes === 45 && afterRestart.plansEnabled === false, js(afterRestart))
    await openSettings('Settings button (after restart)')
    const uiAfterRestart = await waitFor(async () => (await switchChecked(WATCH_LABEL)) === 'true' && (await minutesValue()) === '45' && (await switchChecked(PLANS_LABEL)) === 'false', 8000, 200)
    t.check('after a restart the switches and the minutes value show the stored values', !!uiAfterRestart, `${await switchChecked(WATCH_LABEL)} / ${await minutesValue()} / ${await switchChecked(PLANS_LABEL)}`)

    await escape()
    const errorsAfter = await ev('window.__e2eErrors.slice()')
    t.check('no renderer console errors or uncaught exceptions after the restart', Array.isArray(errorsAfter) && errorsAfter.length === 0, js(errorsAfter))

    // ---- 8. the app's own log for this profile has no errors
    const logs = fs.readdirSync(userData).filter((f) => f.startsWith('app-') && f.endsWith('.log'))
    const badLines = []
    for (const name of logs) {
      for (const line of fs.readFileSync(path.join(userData, name), 'utf8').split(/\r?\n/)) {
        if (/\bError\b/.test(line)) badLines.push(`${name}: ${line.trim().slice(0, 160)}`)
      }
    }
    t.check('the app log for this profile has no "Error" lines', badLines.length === 0, badLines.slice(0, 5).join(' | '))
    console.log(`\nscreenshot: ${shotPath}`)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
