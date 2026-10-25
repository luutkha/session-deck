// E2E (hands-off quota autopilot, D33): the user does nothing. A store file that still holds the OLD
// ask/ask/false quota defaults upgrades itself at boot; with the hands-off settings a 96% five-hour level sleeps
// idle sessions with NO toast to click, and the reset wakes + types "continue" into the session that was cut off by
// the limit (armed with a fake UserPromptSubmit hook, then the limit phrase is pasted — its TUI echo triggers the
// same screen read the real limit message uses). Noise stays notifications + the "Woke N sessions" info.
// Run: node scripts/e2e-handsfree.cjs   (one real "continue" turn on the default Claude model; ~3 min)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const RESET_IN_SEC = 45
const LIMIT_PHRASE = 'You have hit your usage limit, your limit will reset at 5pm'

const DEFAULT_STATUSES = [
  { id: 'todo', name: 'Todo', color: '#9e9e9e' },
  { id: 'working', name: 'Working', color: '#42a5f5' },
  { id: 'waiting', name: 'Waiting', color: '#ffb300' },
  { id: 'review', name: 'Review', color: '#ab47bc' },
  { id: 'done', name: 'Done', color: '#66bb6a' }
]

/** The store file exactly as an app that predates the hands-off defaults saved it (see docs/DECISIONS D33). */
function seededStoreFile(userData) {
  const settings = {
    autoStatus: { enabled: true, working: 'working', needsInput: 'waiting', finished: 'review' },
    tray: { closeToTray: true, desktopNotifications: true, notifyOnlyWhenUnfocused: true },
    quota: {
      enabled: true,
      warnAtPercent: 80,
      criticalAtPercent: 95,
      notifyOnReset: true,
      criticalAction: 'ask',
      resetAction: 'ask',
      continueOnWake: false
    },
    sleep: { enabled: false, afterMinutes: 30, allEnabled: false, allAfterMinutes: 60 },
    agents: { defaultAgent: 'claude', opencodeModel: '' },
    hub: { scrollToBusiest: true },
    away: { enabled: true, afterMinutes: 15 },
    code: { worktreesRoot: '', shell: 'powershell' }
  }
  fs.writeFileSync(path.join(userData, 'sessiondeck-store.json'), JSON.stringify({
    version: 1, sessions: [], groups: [], statuses: DEFAULT_STATUSES, groupOrder: [], settings
  }, null, 2))
}

async function freshDefaults(t) {
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-handsfree-defaults-'))
  try {
    app = await launchApp({ port: 9461, userData: root })
    await sleep(1200)
    const noStored = await app.evaluate('window.api.getStore().then((s) => s.data.settings ?? null)')
    t.check('a fresh install stores no settings', noStored === null, JSON.stringify(noStored))
    const resolved = await app.evaluate('window.api.updateSettings({ quota: {} })')
    t.check(
      'a fresh install runs hands-off: critical=sleep, reset=wake, continue on',
      resolved.quota.criticalAction === 'sleep' && resolved.quota.resetAction === 'wake' && resolved.quota.continueOnWake === true,
      JSON.stringify(resolved.quota)
    )
  } catch (error) {
    t.check('fresh-defaults run completed without exception', false, String((error && error.message) || error))
  } finally {
    if (app) app.kill()
    sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }) } catch { /* leftover temp dir is harmless */ }
  }
}

function cd(dir) {
  return JSON.stringify(dir)
}

async function main() {
  const t = makeChecker()
  await freshDefaults(t)

  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-handsfree-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    seededStoreFile(root)
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9462, userData: root })
    await sleep(1200)

    // ---- boot migration: the seeded store still holds the old ask/ask/false defaults
    const seeded = await app.evaluate('window.api.getStore().then((s) => s.data?.settings?.quota ?? null)')
    t.check(
      'a store with the old ask/ask/false quota defaults upgrades itself at boot',
      seeded !== null && seeded.criticalAction === 'sleep' && seeded.resetAction === 'wake' && seeded.continueOnWake === true && seeded.notifyOnReset === true,
      JSON.stringify(seeded)
    )

    const cut = await app.evaluate(
      `window.api.createSession({ cwd: ${cd(proj)}, name: 'cut', agent: 'claude' })`
    )
    const sleeper = await app.evaluate(
      `window.api.createSession({ cwd: ${cd(proj)}, name: 'sleeper', agent: 'opencode' })`
    )
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const post = async (url, body) => (await fetch(`http://127.0.0.1:${endpoint.port}${url}`, {
      method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: JSON.stringify(body)
    })).status
    const runtimeOf = async (id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)
    const running = async (id) => { const r = await runtimeOf(id); return r?.run === 'running' && r.sleeping !== true }
    const asleep = async (id) => (await runtimeOf(id))?.sleeping === true
    const write = async (id, data) => app.evaluate(`window.api.ptyWrite(${JSON.stringify(id)}, ${JSON.stringify(data)})`)
    const screen = async (id) => app.evaluate(
      `window.api.ptyReplay(${JSON.stringify(id)}).then((r) => r.data.replace(/\\x1b\\[[0-9;?<>]*[A-Za-z]/g, '').replace(/\\x1b\\][^\\x07]*\\x07/g, '').slice(-4200))`
    )
    const autopilot = () => app.evaluate('window.api.getQuotaAutopilot()')
    const sleepToast = () => app.evaluate("document.querySelector('[data-quota-action=sleep]')?.innerText ?? null")
    const wakeToast = () => app.evaluate("document.querySelector('[data-quota-action=wake]')?.innerText ?? null")

    // Start 'cut' and get its Claude TUI to a ready prompt (trust + bypass-permission dialogs, "No" preselected).
    // NEVER send a blind Enter: before the dialog renders, a CR would land on it later and confirm "No, exit".
    await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('cut'))?.click()`)
    await sleep(5000)
    for (let i = 0; i < 40; i++) {
      const visible = await screen(cut.id)
      // Redraws overlap in the replay, so spacing is not reliable: match on collapsed text.
      const flat = visible.replace(/\s+/g, '')
      if (process.env.E2E_DEBUG) {
        const rt = await runtimeOf(cut.id)
        console.log(`[dlg ${i}] run=${rt?.run} sleeping=${rt?.sleeping} dialog=${flat.includes('No,exit')} footer=${flat.includes('bypasspermissionson')}`)
      }
      if (flat.includes('bypasspermissionson')) break
      if (flat.includes('No,exit')) {
        await write(cut.id, '\x1b[B') // Down: "Yes" is not preselected
        await sleep(400)
        await write(cut.id, '\r')
        await sleep(2000)
        continue
      }
      await sleep(1500) // TUI still starting (or an unrecognized dialog): wait, do not press anything
    }
    const ready = (await screen(cut.id)).replace(/\s+/g, '').includes('bypasspermissionson')
    if (process.env.E2E_DEBUG) console.log('---- cut screen after dialog loop ----\n' + (await screen(cut.id)))
    t.check("the Claude TUI of 'cut' is at its prompt", ready)

    // Start 'sleeper' (an idle OpenCode session reports no usage itself, so the fake numbers stand).
    await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('sleeper'))?.click()`)
    await waitFor(async () => running(sleeper.id), 20000, 400)

    // ---- arm the limit edge, then paste the limit phrase: the TUI echo = the screen the real limit message would show
    await post(`/hook/${encodeURIComponent(cut.id)}/UserPromptSubmit`, { prompt: 'work that gets cut off' })
    await sleep(400)
    await write(cut.id, LIMIT_PHRASE)
    const held = await waitFor(async () => (await autopilot()).stoppedAtLimit.includes(cut.id) ? (await autopilot()) : null, 10000, 300)
    t.check('the limit message holds the session for the reset (stoppedAtLimit)', !!held, JSON.stringify(held))
    await write(cut.id, '\x1b') // clear the input: the paste was only the screen signal, not a prompt
    await sleep(600)

    // ---- fake plan usage: 96% of the five-hour window, reset in RESET_IN_SEC
    const resetAt = Math.floor(Date.now() / 1000) + RESET_IN_SEC
    t.check('a statusLine with 96% is accepted', (await post(`/statusline/${encodeURIComponent(sleeper.id)}`, {
      rate_limits: { five_hour: { used_percentage: 96, resets_at: resetAt }, seven_day: { used_percentage: 10, resets_at: resetAt + 86400 } }
    })) === 204)
    await sleep(4000) // give the critical alert its chance to render anything clickable

    // ---- critical level sleeps the idle session by itself, with NO toast to click
    t.check(
      'no "Sleep idle sessions" toast is offered at the critical level (hands-off, not ask)',
      (await sleepToast()) === null,
      String(await sleepToast())
    )
    const autoSlept = await waitFor(async () => (await asleep(sleeper.id) ? (await autopilot()) : null), 12000, 300)
    t.check('the idle session was slept by itself at the critical level', !!autoSlept && autoSlept.sleptForQuota.includes(sleeper.id), JSON.stringify(autoSlept))
    t.check('the limit-cut session is not interrupted (its hook says working)', await running(cut.id))
    const chip = await waitFor(async () => app.evaluate("document.querySelector('[data-quota-held]')?.innerText ?? null"), 4000, 200)
    t.check('the status bar holds the reset info ("1 waiting for reset")', typeof chip === 'string' && chip.includes('waiting for reset'), String(chip))

    // ---- the reset arrives by the clock alone: wake, no click
    const woke = await waitFor(async () => (running(sleeper.id) && (await autopilot()).sleptForQuota.length === 0 && (await autopilot()).stoppedAtLimit.length === 0 ? running(sleeper.id) : null), (RESET_IN_SEC + 30) * 1000, 1000)
    t.check('the reset woke the sleeping session by itself', !!woke)
    t.check(
      'no "Wake sessions" toast was offered at the reset either',
      (await wakeToast()) === null,
      String(await wakeToast())
    )
    const info = await app.evaluate(
      "[...document.querySelectorAll(\"[aria-label='Quota alerts'] [role=status]\")].map((n) => n.innerText).join(' | ')"
    )
    t.check('the user only hears it: an info says "Woke N sessions"', /Woke \d+ sessions?\./.test(info), String(info))

    // ---- "continue" reaches the limit-cut session (typed + Enter into its prompt)
    const typed = await waitFor(async () => ((await screen(cut.id)).includes('continue') ? (await screen(cut.id)) : null), 20000, 500)
    t.check('"continue" reached the cut-off session (shown in its transcript)', !!typed, String(typed).slice(-220))

    // ---- ask mode still exists when the user chooses to be asked again
    await app.evaluate(`window.api.updateSettings({ quota: { criticalAction: 'ask' } })`)
    await post(`/statusline/${encodeURIComponent(sleeper.id)}`, {
      rate_limits: { five_hour: { used_percentage: 96, resets_at: Math.floor(Date.now() / 1000) + 120 }, seven_day: { used_percentage: 10, resets_at: Math.floor(Date.now() / 1000) + 86400 } }
    })
    const askOffer = await waitFor(() => sleepToast(), 8000, 300)
    t.check('flipping criticalAction back to ask brings the "Sleep" toast back', !!askOffer && /Sleep/.test(String(askOffer)), String(askOffer))
    await app.evaluate(`window.api.updateSettings({ quota: { criticalAction: 'sleep' } })`)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }) } catch { /* leftover temp dir is harmless */ }
  }
}
main()
