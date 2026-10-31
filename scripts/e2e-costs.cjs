// E2E (D51): the cost report and the per-session cost strip, through the real UI.
// A store and a timeline file are seeded into a fresh user-data folder (turns on several past days), then one live
// turn is added through the real hook server (UserPromptSubmit, statusLine cost, Stop).
// Verifies: palette "Show cost report" opens the dialog; the tiles, chart and per-session table add up; a live turn
// updates it; the Hub header total opens it; a table row opens the session; the Activity tab shows the strip.
// Run: node scripts/e2e-costs.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9441
const CTRL = 2
const SHIFT = 8

function dayAt(daysAgo, hour) {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.getTime()
}

function seed(userData, proj) {
  const session = (id, name) => ({ id, name, cwd: proj, groupId: null, statusId: null, order: 0, createdAt: dayAt(20, 9), claudeArgs: [], agent: 'opencode' })
  fs.writeFileSync(path.join(userData, 'sessiondeck-store.json'), JSON.stringify({
    version: 1, sessions: [session('s-api', 'API work'), session('s-docs', 'Docs work')], groups: [], statuses: [], groupOrder: []
  }))
  const turn = (sessionId, daysAgo, costUsd) => {
    const startedAt = dayAt(daysAgo, 11)
    return { id: `${sessionId}-${daysAgo}-${costUsd}`, sessionId, prompt: 'seeded', startedAt, endedAt: startedAt + 60000, end: 'finished', costUsd, neededYou: false }
  }
  // API: today 1.00, 2 days ago 2.00, 10 days ago 4.00, 20 days ago 8.00 (outside the chart, inside 30 days)
  // Docs: 1 day ago 0.50, plus one turn with an unknown cost that must not count
  const turns = [turn('s-api', 0, 1), turn('s-api', 2, 2), turn('s-api', 10, 4), turn('s-api', 20, 8), turn('s-docs', 1, 0.5), turn('s-docs', 3, null)]
  fs.writeFileSync(path.join(userData, 'sessiondeck-timeline.json'), JSON.stringify({ version: 1, turns }))
}

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-costs-'))
  const userData = path.join(root, 'user-data')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(userData)
  fs.mkdirSync(proj)
  seed(userData, proj)
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  const js = (value) => JSON.stringify(value)

  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expression) => app.evaluate(expression)
    const key = async (k, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await sleep(150)
    }
    const center = (expr) => ev(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label) => {
      const point = await waitFor(() => center(expr), 6000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(350)
    }
    const hover = async (expr) => {
      const point = await center(expr)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' })
      await sleep(250)
    }
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const tile = (label) => ev(`document.querySelector('[data-cost-tile=${js(label)}] span:last-child')?.innerText ?? null`)
    const row = (name) => ev(`[...document.querySelectorAll('[data-cost-row=${js(name)}] td')].map((c) => c.innerText.trim())`)
    const openReport = async () => {
      await ev('document.activeElement && document.activeElement.blur(); true')
      await key('K', 'KeyK', 75, CTRL | SHIFT)
      await waitFor(() => ev('!!document.querySelector("[cmdk-input]")'), 3000, 100)
      await app.send('Input.insertText', { text: 'cost report' })
      await sleep(300)
      await key('Enter', 'Enter', 13)
      return waitFor(() => ev('!!document.querySelector("[data-cost-dialog]")'), 5000, 200)
    }

    // ---- open from the palette
    t.check('palette "Show cost report" opens the dialog', !!(await openReport()))
    await waitFor(async () => (await tile('Last 30 days')) === '$15.50', 5000, 200)
    t.check('tiles: today $1.00, 7 days $3.50, 30 days $15.50 (unknown costs not counted)',
      (await tile('Today')) === '$1.00' && (await tile('Last 7 days')) === '$3.50' && (await tile('Last 30 days')) === '$15.50',
      js([await tile('Today'), await tile('Last 7 days'), await tile('Last 30 days')]))
    t.check('the chart has 14 day columns', (await ev(`document.querySelectorAll('[data-cost-dialog] [data-cost-day]').length`)) === 14)
    await hover(`document.querySelector('[data-cost-dialog] [data-cost-day="13"]')`)
    const tip = await ev(`document.querySelector('[data-cost-tooltip]')?.innerText ?? ''`)
    t.check('hovering today shows its cost and turn count', /\$1\.00/.test(tip) && /1 turn/.test(tip), tip)
    await shot('cost-report')
    t.check('the table lists API work first (most expensive) with 30-day $15.00', js(await row('API work')) === js(['API work', '$1.00', '$3.00', '$15.00', '4']), js(await row('API work')))
    t.check('...and Docs work with $0.50', js(await row('Docs work')) === js(['Docs work', '$0.00', '$0.50', '$0.50', '1']), js(await row('Docs work')))

    // ---- a live turn updates the open report
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const post = (url, body) => fetch(`http://127.0.0.1:${endpoint.port}${url}`, { method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status)
    await post('/statusline/s-docs', { cost: { total_cost_usd: 0.10 } })
    await post('/hook/s-docs/UserPromptSubmit', { prompt: 'live turn' })
    await post('/statusline/s-docs', { cost: { total_cost_usd: 0.35 } })
    await post('/hook/s-docs/Stop', {})
    const live = await waitFor(async () => (await tile('Today')) === '$1.25', 8000, 200)
    t.check('a live turn ($0.25) updates the open report', !!live, String(await tile('Today')))

    // ---- a row opens the session
    await click(`document.querySelector('[data-cost-row="Docs work"]')`, 'Docs row')
    const opened = await waitFor(async () => (await ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)) === 's-docs', 5000, 200)
    t.check('clicking a row opens that session and closes the report', !!opened && !(await ev('!!document.querySelector("[data-cost-dialog]")')))

    // ---- the Activity tab strip for the session on screen
    await click(`document.querySelector('[aria-label="Notes and checklist"]')`, 'side panel toggle')
    await click(`document.querySelector('[data-side-tab="activity"]')`, 'Activity tab')
    const strip = await waitFor(() => ev(`document.querySelector('[data-session-cost]')?.innerText ?? null`), 5000, 200)
    t.check('the Activity tab shows this session\'s 14-day cost strip', !!strip && /\$0\.75/.test(strip) && /today \$0\.25/.test(strip), String(strip))
    await shot('cost-strip')

    // ---- the Hub header total opens it too
    await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Hub')?.click()`)
    await sleep(600)
    await click(`document.querySelector('[data-hub-total-cost]')`, 'Hub total cost')
    t.check('the Hub header total opens the cost report', !!(await waitFor(() => ev('!!document.querySelector("[data-cost-dialog]")'), 5000, 200)))
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
