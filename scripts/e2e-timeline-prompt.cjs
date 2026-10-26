// E2E (D29 OpenCode parity): the exact bodies the OpenCode plugin now posts — a UserPromptSubmit with the
// user's prompt text and a statusline with model/display name + context_window — reach the Activity tab,
// the away summary, the session usage chip and the Hub card. Fake hooks (real hook server), no model turn.
// Run: node scripts/e2e-timeline-prompt.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const SHIFT_VK = 16

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-timeline-prompt-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9457 })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const session = await app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: 'parity-one', agent: 'opencode' })`)
    await sleep(1500)
    await app.evaluate('window.api.updateSettings({ away: { enabled: true, afterMinutes: 1 } })')
    // Activate the session: the status-bar usage chip shows the ACTIVE session's usage.
    await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('parity-one'))?.click()`)
    await sleep(1000)

    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const post = async (url, body) => {
      const res = await fetch(`http://127.0.0.1:${endpoint.port}${url}`, {
        method: 'POST',
        headers: { 'x-token': endpoint.token, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      return res.status
    }
    const hook = (event, body = {}) => post(`/hook/${encodeURIComponent(session.id)}/${event}`, body)
    // The shape the plugin posts after the model catalog lookup (session.step.ended tokens ask for 45%).
    const statusline = () =>
      post(`/statusline/${encodeURIComponent(session.id)}`, {
        model: { display_name: 'Model A' },
        cost: { total_cost_usd: 0.42 },
        context_window: { used_percentage: 45 }
      })
    const shiftKey = async () => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: SHIFT_VK })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: SHIFT_VK })
    }
    const sessionUsage = async () => {
      const usage = await app.evaluate('window.api.getUsage()')
      return usage.sessions.find((s) => s.sessionId === session.id) ?? null
    }
    const chipLabels = () => app.evaluate('[...document.querySelectorAll("[role=group][aria-label]")].map((n) => n.getAttribute("aria-label"))')
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }

    // ---- the prompt text (OpenCode v2 session.inbox.enqueued payload) is recorded like Claude's
    t.check('UserPromptSubmit with the OpenCode prompt is accepted', (await hook('UserPromptSubmit', { prompt: 'Add the release notes' })) === 204)
    const recorded = await waitFor(async () => {
      const turns = await app.evaluate(`window.api.getTimeline(${js(session.id)})`)
      return turns.length === 1 && turns[0].prompt === 'Add the release notes' ? turns : null
    }, 5000, 200)
    t.check('the running turn carries the prompt text (not a blank row)', !!recorded, js(await app.evaluate(`window.api.getTimeline(${js(session.id)})`)))
    await hook('Stop')

    // ---- the statusline body (model display name + context_window) fills the usage chip
    t.check('the plugin statusline body is accepted', (await statusline()) === 204)
    const usage = await waitFor(async () => {
      const s = await sessionUsage()
      return s !== null && s.contextPercent === 45 && s.model === 'Model A' ? s : null
    }, 5000, 200)
    t.check('the session usage has 45% context and the catalog display name', !!usage, js(await sessionUsage()))
    const chip = await waitFor(async () => (await chipLabels()).find((l) => l.includes('Context: 45%')) ?? null, 5000, 200)
    t.check('the status-bar session chip shows "Context: 45%"', !!chip && chip.includes('Model A'), String(chip))

    // ---- Activity tab shows the prompt (the OpenCode parity bug was a blank prompt there)
    const toggle = `document.querySelector('[aria-label="Notes and checklist"]')`
    if ((await app.evaluate(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await app.evaluate(`${toggle}.click()`)
    await sleep(400)
    await app.evaluate(`[...document.querySelectorAll('button, [role=tab]')].find((n) => n.innerText.trim() === 'Activity')?.click()`)
    const row = await waitFor(() => app.evaluate('document.querySelector("[data-turn-id]")?.innerText ?? null'), 4000, 200)
    t.check('the Activity tab lists the prompt and Finished', !!row && row.includes('Add the release notes') && row.includes('Finished'), String(row))
    await shot('parity-activity-and-context-chip')

    // ---- Hub card: the same context warning source as Claude sessions
    await app.evaluate('document.querySelector(\'[aria-label="Open Hub"]\')?.click()')
    const hubCard = await waitFor(
      () => app.evaluate(`[...document.querySelectorAll('main [role=group][aria-label]')].map((n) => n.getAttribute('aria-label')).find((l) => l.includes('Context: 45%')) ?? null`),
      5000,
      200
    )
    t.check('the Hub card shows the OpenCode context %', !!hubCard, String(hubCard))

    // ---- away summary: a turn that finishes while the user is away lists its prompt
    await shiftKey()
    const leftAt = Date.now()
    await sleep(3000)
    await hook('UserPromptSubmit', { prompt: 'Ship the release notes' })
    await sleep(700)
    await hook('Stop')
    await sleep(Math.max(0, 62000 - (Date.now() - leftAt)))
    t.check('no away dialog while still away', !(await app.evaluate('[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("While you were away"))')))
    await shiftKey()
    const dialog = await waitFor(
      () => app.evaluate('[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("While you were away"))?.innerText ?? null'),
      5000,
      200
    )
    t.check('the away summary lists the OpenCode prompt', !!dialog && dialog.includes('Ship the release notes'), String(dialog))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    const failed = t.summary()
    if (app) app.kill()
    await sleep(400)
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(failed ? 1 : 0)
  }
}
main()
