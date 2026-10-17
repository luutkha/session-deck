// E2E: a Claude session started with Remote Control is detected (runtime flag + RC badge) and the New Session dialog
// offers the Remote Control checkbox. Starts one real claude session, no prompt is sent.
// Run: node scripts/e2e-remote.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const runtimeOf = async (app, id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9396 })
    await sleep(1500)

    // ---- the dialog: Remote Control checkbox -> --remote-control in the created session
    await app.evaluate(`document.querySelector('[aria-label="New session"], [aria-label="New Session"]')?.click()`)
    const dlg = await waitFor(() => app.evaluate(`!!document.querySelector('[role=dialog] #new-session-remote')`), 5000, 300)
    t.check('New Session dialog shows a Remote Control checkbox (Claude)', !!dlg)
    await app.evaluate(`document.querySelector('[role=dialog] #new-session-remote')?.click()`)
    await sleep(300)
    t.check('checkbox toggles on', await app.evaluate(`document.querySelector('[role=dialog] #new-session-remote')?.getAttribute('data-state') === 'checked'`))
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(400)

    // ---- a Remote Control session: detected from the footer, badge shown, not put to sleep
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'rc session', claudeArgs: ['--remote-control'] })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('rc session')).click()`)
    const on = await waitFor(async () => (await runtimeOf(app, s.id))?.remoteControl === true, 60000, 1000)
    t.check('runtime.remoteControl becomes true once the footer shows /rc active', !!on)
    t.check('the session is auto-marked Keep awake', (await app.evaluate('window.api.getStore()')).data.sessions.find((x) => x.id === s.id).keepAwake === true)
    const badge = await waitFor(() => app.evaluate(`!!document.querySelector('[role=tab] [aria-label="Remote Control active"]')`), 5000, 300)
    t.check('the tab shows the RC badge', !!badge)
    const cardBadge = await app.evaluate(`!![...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('rc session'))?.querySelector('[aria-label="Remote Control active"]')`)
    t.check('the sidebar card shows the RC badge', cardBadge)
    const shot = await app.send('Page.captureScreenshot', { format: 'png' })
    require('node:fs').mkdirSync(require('node:path').join(ROOT, 'scripts', 'visual'), { recursive: true })
    require('node:fs').writeFileSync(require('node:path').join(ROOT, 'scripts', 'visual', 'remote-control.png'), Buffer.from(shot.result.data, 'base64'))

    // ---- manual sleep still works and clears the flag (a restart must re-detect it)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'other' })`)
    await sleep(2000)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('other')).click()`)
    await sleep(800)
    await app.evaluate(`window.api.sleepSession(${JSON.stringify(s.id)})`)
    await waitFor(async () => (await runtimeOf(app, s.id))?.sleeping === true, 8000, 300)
    t.check('manual sleep drops the flag', (await runtimeOf(app, s.id))?.remoteControl !== true)
    await sleep(2500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('rc session')).click()`)
    const back = await waitFor(async () => (await runtimeOf(app, s.id))?.remoteControl === true, 60000, 1000)
    t.check('after wake the resumed process reconnects Remote Control (flag saved in args)', !!back)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
