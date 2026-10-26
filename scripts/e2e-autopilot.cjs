// E2E (D30): quota autopilot. Fake plan usage is posted to the real hook server's statusLine endpoint (the request
// Claude Code makes every turn). Idle OpenCode sessions are used because they never report plan usage themselves.
// 1) ask mode: critical toast -> real click "Sleep N idle sessions" -> only the idle one sleeps (busy + Keep awake
//    stay), held chip shows; the reset timer fires at resets_at with no further usage update -> "Wake" -> it runs.
// 2) automatic mode: a new window at 97% sleeps it by itself, and the reset wakes it by itself.
// Takes ~3 min. Run: node scripts/e2e-autopilot.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const RESET_IN_SEC = 50

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-autopilot-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9404 })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const mk = (name) => app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)}, agent: 'opencode' })`)
    const idle = await mk('idle-one')
    const busy = await mk('busy-one')
    const kept = await mk('kept-one')
    await app.evaluate(`window.api.setKeepAwake(${js(kept.id)}, true)`)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const post = async (url, body) => (await fetch(`http://127.0.0.1:${endpoint.port}${url}`, {
      method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: JSON.stringify(body)
    })).status
    const usage = (percent, resetsAt) => post(`/statusline/${encodeURIComponent(busy.id)}`, {
      rate_limits: { five_hour: { used_percentage: percent, resets_at: resetsAt }, seven_day: { used_percentage: 10, resets_at: resetsAt + 86400 } }
    })
    const runtimeOf = async (id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)
    const running = async (id) => { const r = await runtimeOf(id); return r?.run === 'running' && r.sleeping !== true }
    const asleep = async (id) => (await runtimeOf(id))?.sleeping === true
    const toastButton = (kind) => `document.querySelector('[data-quota-action=${kind}]')`
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }

    // Start all three (activating each starts its process), then make one busy.
    for (const s of [idle, busy, kept]) {
      await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(s.name)}))?.click()`)
      await waitFor(() => running(s.id), 20000, 400)
    }
    await post(`/hook/${encodeURIComponent(busy.id)}/UserPromptSubmit`, { prompt: 'long job' })
    await sleep(500)
    t.check('three sessions running, one of them working', (await running(idle.id)) && (await running(busy.id)) && (await running(kept.id)) && (await runtimeOf(busy.id))?.activity === 'working')

    // ---------- 1) ask mode (explicit: D33 made the shipped defaults hands-off)
    await app.evaluate(`window.api.updateSettings({ quota: { criticalAction: 'ask', resetAction: 'ask' } })`)
    const resetA = Math.floor(Date.now() / 1000) + RESET_IN_SEC
    t.check('a statusLine with 96% is accepted', (await usage(96, resetA)) === 204)
    const offer = await waitFor(() => app.evaluate(`${toastButton('sleep')}?.innerText ?? null`), 8000, 200)
    t.check('the critical toast offers "Sleep 1 idle session"', !!offer && /Sleep 1 idle session/.test(offer), String(offer))
    await shot('autopilot-critical-toast')
    await app.evaluate(`${toastButton('sleep')}.click()`)
    const slept = await waitFor(() => asleep(idle.id), 8000, 300)
    t.check('clicking it sleeps the idle session', !!slept)
    t.check('the working session is not interrupted', await running(busy.id))
    t.check('the Keep-awake session keeps running', await running(kept.id))
    const state = await app.evaluate('window.api.getQuotaAutopilot()')
    t.check('autopilot holds it for the reset', state.sleptForQuota.includes(idle.id) && state.resetsAt === resetA, js(state))
    const chip = await waitFor(() => app.evaluate('document.querySelector("[data-quota-held]")?.innerText ?? null'), 4000, 200)
    t.check('the status bar shows "1 waiting for reset"', !!chip && chip.includes('1 waiting for reset'), String(chip))

    // The reset arrives by the clock alone: no further statusLine is posted.
    const wakeOffer = await waitFor(() => app.evaluate(`${toastButton('wake')}?.innerText ?? null`), (RESET_IN_SEC + 20) * 1000, 1000)
    t.check('at the reset time a toast offers "Wake 1 session" (no usage update needed)', !!wakeOffer && /Wake 1 session/.test(wakeOffer), String(wakeOffer))
    t.check('it has the "continue" checkbox', await app.evaluate('!!document.querySelector("[data-quota-continue]")'))
    await shot('autopilot-reset-toast')
    await app.evaluate(`${toastButton('wake')}.click()`)
    const woke = await waitFor(() => running(idle.id), 20000, 400)
    t.check('clicking Wake starts the session again', !!woke)
    const active = await app.evaluate(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)
    t.check('waking does not switch the session on screen', active === kept.id, String(active))
    const cleared = await app.evaluate('window.api.getQuotaAutopilot()')
    t.check('nothing is held any more and the chip is gone', cleared.sleptForQuota.length === 0 && !(await app.evaluate('!!document.querySelector("[data-quota-held]")')), js(cleared))

    // ---------- 2) automatic mode
    await app.evaluate(`window.api.updateSettings({ quota: { criticalAction: 'sleep', resetAction: 'wake' } })`)
    const resetB = Math.floor(Date.now() / 1000) + RESET_IN_SEC
    await usage(97, resetB)
    const autoSlept = await waitFor(() => asleep(idle.id), 8000, 300)
    t.check('automatic: a new window at 97% sleeps the idle session by itself', !!autoSlept)
    t.check('automatic: busy and Keep-awake still run', (await running(busy.id)) && (await running(kept.id)))
    const autoWoke = await waitFor(() => running(idle.id), (RESET_IN_SEC + 25) * 1000, 1000)
    t.check('automatic: the reset wakes it by itself', !!autoWoke)
    const info = await app.evaluate('[...document.querySelectorAll("[aria-label=\'Quota alerts\'] [role=status]")].map((n) => n.innerText).join(" | ")')
    t.check('automatic: a toast says it woke the session', /Woke 1 session/.test(info), info)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
