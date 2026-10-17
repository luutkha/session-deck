// E2E: OpenCode workers started from a Claude session show up as read-only tabs next to that session's tabs.
// The worker is faked the way oc-run does it: a registration file plus a growing JSONL log in <folder>/.opencode-runs.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const NL = String.fromCharCode(10)
const BOM = String.fromCharCode(0xfeff)
const ev = (o) => JSON.stringify(o) + NL

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-workers-'))
  try {
    const projA = path.join(root, 'projA')
    const projB = path.join(root, 'projB')
    fs.mkdirSync(projA)
    fs.mkdirSync(projB)
    app = await launchApp({ port: 9375 })
    await sleep(1200)
    const mk = (name, cwd) => app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(cwd)}, name: ${JSON.stringify(name)} })`)
    await mk('claude-a', projA)
    await mk('claude-b', projB)
    await sleep(1500)
    const clickSession = (name) => app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${JSON.stringify(name)}))?.click()`)
    const chips = () => app.evaluate(`[...document.querySelectorAll('[data-worker-id]')].map((n) => n.getAttribute('data-worker-status') + ':' + n.innerText.trim())`)
    const viewText = () => app.evaluate(`document.querySelector('[data-worker-view]')?.innerText ?? null`)

    await clickSession('claude-a')
    await sleep(800)

    const runs = path.join(projA, '.opencode-runs')
    fs.mkdirSync(path.join(runs, 'sessions'), { recursive: true })
    const log = path.join(runs, '20261017-000000-demo.jsonl')
    const register = (status) =>
      fs.writeFileSync(path.join(runs, 'sessions', 'demo.json'), BOM + JSON.stringify({ sessionID: 'ses_demo123', model: 'opencode-go/glm-5.3-flash', status, log }))
    fs.writeFileSync(log, ev({ type: 'text', timestamp: Date.now(), part: { text: 'Reading the brief' } }))
    register('running')

    const appeared = await waitFor(async () => ((await chips()).length === 1 ? chips() : null), 8000, 400)
    t.check('a worker tab appears for the session', appeared && appeared[0].startsWith('running:') && appeared[0].includes('demo'), JSON.stringify(appeared))

    await app.evaluate(`document.querySelector('[data-worker-id]')?.click()`)
    const first = await waitFor(async () => { const v = await viewText(); return v && v.includes('Reading the brief') ? v : null }, 5000, 300)
    t.check('clicking it opens the read-only view with the worker output', !!first, String(first).slice(0, 120))
    t.check('the view says Read-only and shows the model', !!first && first.includes('Read-only') && first.includes('glm-5.3-flash'))

    fs.appendFileSync(log, ev({ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed', input: { command: 'npm test' } } } }) + ev({ type: 'step_finish', part: { cost: 0.0123, tokens: { total: 4200 } } }))
    const live = await waitFor(async () => { const v = await viewText(); return v && v.includes('npm test') && v.includes('4.2k') ? v : null }, 5000, 300)
    t.check('new output streams into the open view live', !!live, String(live).slice(0, 160))

    register('ok')
    const done = await waitFor(async () => ((await chips())[0] || '').startsWith('done:'), 5000, 300)
    t.check('the tab flips to done when the worker finishes', !!done, JSON.stringify(await chips()))

    await clickSession('claude-a')
    await sleep(600)
    const back = await app.evaluate(`document.querySelector('[data-worker-view]') === null`)
    t.check('selecting the Claude session returns to its terminal', back)

    await clickSession('claude-b')
    await sleep(800)
    t.check('another folder does not see the worker', (await chips()).length === 0, JSON.stringify(await chips()))

    await clickSession('claude-a')
    await sleep(600)
    await app.evaluate(`document.querySelector('[data-worker-id] button[aria-label="Hide worker tab"]')?.click()`)
    await sleep(500)
    t.check('the hide button closes the worker tab', (await chips()).length === 0)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
