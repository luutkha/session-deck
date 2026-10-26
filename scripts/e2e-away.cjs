// E2E (D29): timeline + "While you were away". Hook events and statusLine costs are posted to the real hook server
// (the same requests Claude/OpenCode make); idle OpenCode sessions are used so no real usage data interferes.
// Checks the Activity tab, the away dialog after a real 1-minute absence (real key presses), the palette action, and
// that the timeline survives a restart. Takes ~2 min. Run: node scripts/e2e-away.cjs  (E2E_SHOT_DIR=<dir> for shots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const CTRL = 2
const SHIFT = 8

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-away-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9403, userData })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const mk = (name) => app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)}, agent: 'opencode' })`)
    const a = await mk('away-a')
    const b = await mk('away-b')
    await sleep(1500)
    await app.evaluate('window.api.updateSettings({ away: { enabled: true, afterMinutes: 1 } })')
    let endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))

    const post = async (url, body) => {
      const res = await fetch(`http://127.0.0.1:${endpoint.port}${url}`, {
        method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      return res.status
    }
    const hook = (id, event, body = {}) => post(`/hook/${encodeURIComponent(id)}/${event}`, body)
    const cost = (id, usd) => post(`/statusline/${encodeURIComponent(id)}`, { cost: { total_cost_usd: usd } })
    const key = async (k, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    }
    const shift = () => key('Shift', 'ShiftLeft', 16)
    const clickCard = (name) => app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))?.click()`)
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }

    // ---- one turn on A, with a cost delta
    await cost(a.id, 0.10)
    t.check('UserPromptSubmit with a prompt is accepted', (await hook(a.id, 'UserPromptSubmit', { prompt: 'Fix the login\nbug please' })) === 204)
    await sleep(500)
    const running = await app.evaluate(`window.api.getTimeline(${js(a.id)})`)
    t.check('a running turn is recorded with the prompt (whitespace collapsed)', running.length === 1 && running[0].end === null && running[0].prompt === 'Fix the login bug please', js(running))
    await cost(a.id, 0.35)
    await hook(a.id, 'Stop')
    const done = await waitFor(async () => { const r = await app.evaluate(`window.api.getTimeline(${js(a.id)})`); return r[0]?.end === 'finished' && Math.abs((r[0].costUsd ?? -1) - 0.25) < 1e-9 ? r : null }, 5000, 200)
    t.check('Stop ends it as finished with the cost delta ($0.25)', !!done, js(await app.evaluate(`window.api.getTimeline(${js(a.id)})`)))

    // ---- out-of-order follow-up: the late Stop and late cost belong to the OLD turn
    const c = await mk('away-c')
    await sleep(1200)
    await cost(c.id, 0.10)
    await hook(c.id, 'UserPromptSubmit', { prompt: 'long first turn' })
    await sleep(600)
    await cost(c.id, 0.30)
    await hook(c.id, 'UserPromptSubmit', { prompt: 'quick follow-up' })
    await sleep(600)
    // The first turn's final cost arrives after the second prompt.
    await cost(c.id, 0.55)
    await hook(c.id, 'Stop')
    const outOfOrder = await waitFor(async () => {
      const r = await app.evaluate(`window.api.getTimeline(${js(c.id)})`)
      return r.length === 2 && r[0].end === null && r[1].end === 'finished' && Math.abs((r[1].costUsd ?? -1) - 0.45) < 1e-9 ? r : null
    }, 5000, 200)
    t.check('a late Stop ends the OLD turn and keeps the new one running', !!outOfOrder, js(await app.evaluate(`window.api.getTimeline(${js(c.id)})`)))
    t.check('the late cost belongs to the old turn, not the new one', !!outOfOrder && outOfOrder[0].costUsd === null && Math.abs(outOfOrder[1].costUsd - 0.45) < 1e-9, js(outOfOrder))
    const secondStart = outOfOrder?.[0]?.startedAt
    t.check('the old turn ends at the late Stop arrival, not at the new prompt', !!outOfOrder && outOfOrder[1].endedAt > secondStart, js(outOfOrder?.[1]))
    await hook(c.id, 'Stop')
    const settled = await waitFor(async () => {
      const r = await app.evaluate(`window.api.getTimeline(${js(c.id)})`)
      return r.every((x) => x.end === 'finished') ? r : null
    }, 5000, 200)
    t.check('the new turn then ends normally on its own Stop', !!settled, js(await app.evaluate(`window.api.getTimeline(${js(c.id)})`)))

    // ---- Activity tab shows it
    await clickCard('away-a')
    await sleep(800)
    const toggle = `document.querySelector('[aria-label="Notes and checklist"]')`
    if ((await app.evaluate(`${toggle}?.getAttribute('aria-pressed')`)) !== 'true') await app.evaluate(`${toggle}.click()`)
    await sleep(500)
    await app.evaluate(`[...document.querySelectorAll('button, [role=tab]')].find((n) => n.innerText.trim() === 'Activity')?.click()`)
    const row = await waitFor(() => app.evaluate('document.querySelector("[data-turn-id]")?.innerText ?? null'), 4000, 200)
    t.check('the Activity tab lists the turn with prompt, Finished and cost', !!row && row.includes('Fix the login bug please') && row.includes('Finished') && row.includes('$0.25'), String(row))
    await shot('activity-tab')

    // ---- away for > 1 minute while B finishes and A asks for permission
    await shift()
    const leftAt = Date.now()
    await sleep(4000)
    await hook(b.id, 'UserPromptSubmit', { prompt: 'Write the tests' })
    await sleep(1000)
    await hook(b.id, 'Stop')
    await hook(a.id, 'UserPromptSubmit', { prompt: 'Deploy it' })
    await hook(a.id, 'Notification', { message: 'Claude needs your permission to use Bash' })
    await sleep(Math.max(0, 62000 - (Date.now() - leftAt)))
    t.check('no away dialog while still away', !(await app.evaluate('[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("While you were away"))')))
    await shift() // coming back
    const dialog = await waitFor(() => app.evaluate('[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("While you were away"))?.innerText ?? null'), 5000, 200)
    t.check('coming back after 1 min shows "While you were away"', !!dialog, String(dialog))
    t.check('the headline counts 1 finished and 1 needing you', !!dialog && dialog.includes('1 finished') && /1 needs? you/.test(dialog), String(dialog))
    const rows = await app.evaluate('[...document.querySelectorAll("[data-away-row]")].map((n) => n.getAttribute("data-away-row"))')
    t.check('both sessions are listed', rows.includes(a.id) && rows.includes(b.id), js(rows))
    await shot('away-dialog')
    await app.evaluate(`document.querySelector('[data-away-row=${js(b.id)}]').click()`)
    const opened = await waitFor(async () => (await app.evaluate(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)) === b.id, 5000, 200)
    t.check('clicking a row opens that session and closes the dialog', !!opened && !(await app.evaluate('[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("While you were away"))')))

    // ---- palette reopens the last summary (after the away dialog has finished closing)
    await waitFor(() => app.evaluate('!document.querySelector("[role=dialog]")'), 3000, 100)
    await key('K', 'KeyK', 75, CTRL | SHIFT)
    await waitFor(() => app.evaluate('!!document.querySelector("[cmdk-input]")'), 3000, 100)
    await app.send('Input.insertText', { text: 'away' })
    await sleep(300)
    await key('Enter', 'Enter', 13)
    const again = await waitFor(() => app.evaluate('[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("While you were away"))'), 4000, 200)
    t.check('the palette action shows the last summary again', !!again)
    await key('Escape', 'Escape', 27)

    // ---- the timeline survives a restart
    await app.evaluate('window.api.quitApp()').catch(() => undefined)
    await sleep(3000)
    app.kill()
    app = await launchApp({ port: 9403, userData })
    await sleep(1500)
    const after = await app.evaluate(`window.api.getTimeline(${js(a.id)})`)
    t.check('after a restart the timeline is still there', after.some((x) => x.prompt === 'Fix the login bug please' && x.end === 'finished'), js(after))
    t.check('a turn left running at quit comes back as ended', after.every((x) => x.end !== null), js(after.map((x) => x.end)))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
