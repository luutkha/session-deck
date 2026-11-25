// E2E: OpenCode workers started from a Claude session show up as read-only tabs of that session.
// The REAL worker plugin PACKAGE the app wrote is loaded in this process with the session's SESSIONDECK_* env and fed
// OpenCode-shaped events (v2: default export {id, setup}, context.event.subscribe() AsyncIterable), so plugin ->
// hook server -> worker hub -> IPC -> tabs and view are all exercised.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { sleep, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const OC = 'ses_e2eworker000001'
const OC2 = 'ses_e2eworker000002'

async function main() {
  // A stale background service would silently swallow the injected plugin config.
  stopOpencodeService()
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-workers-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const projA = path.join(root, 'anywhere', 'deep', 'projA') // deliberately unrelated to any registry folder
    const projB = path.join(root, 'projB')
    fs.mkdirSync(projA, { recursive: true })
    fs.mkdirSync(projB)
    app = await launchApp({ port: 9375 })
    await sleep(1200)
    const mk = (name, cwd) => app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(cwd)}, name: ${JSON.stringify(name)} })`)
    const a = await mk('claude-a', projA)
    const b = await mk('claude-b', projB)
    await sleep(1500)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const pluginDir = path.join(app.userData, 'sessiondeck-attention', 'sessiondeck-worker-plugin')
    t.check('the app wrote the worker plugin and exposes its hook endpoint', fs.existsSync(path.join(pluginDir, 'package.json')) && endpoint.port > 0, pluginDir)

    const startPlugin = async (sessionId) => {
      process.env.SESSIONDECK_PORT = String(endpoint.port)
      process.env.SESSIONDECK_TOKEN = endpoint.token
      process.env.SESSIONDECK_SESSION_ID = sessionId
      const mod = await import(pathToFileURL(path.join(pluginDir, 'index.mjs')).href + '?t=' + Date.now() + Math.random())
      const queue = []
      let wake = null
      const push = (event) => { if (wake) { const w = wake; wake = null; w(event) } else queue.push(event) }
      async function* iterate() {
        for (;;) {
          if (queue.length > 0) yield queue.shift()
          else yield await new Promise((r) => { wake = r })
        }
      }
      await mod.default.setup({ directory: projA, event: { subscribe: async () => iterate() } })
      return (type, data) => push({ type, data })
    }
    const clickSession = (name) => app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${JSON.stringify(name)}))?.click()`)
    const chips = () => app.evaluate(`[...document.querySelectorAll('[data-worker-id]')].map((n) => n.getAttribute('data-worker-status') + ':' + n.innerText.trim())`)
    const viewText = () => app.evaluate(`document.querySelector('[data-worker-view]')?.innerText ?? null`)

    await clickSession('claude-a')
    await sleep(800)

    const send = await startPlugin(a.id)
    await send('session.created', { info: { id: OC, title: 'New session - 2026', directory: projA } })
    await send('session.status', { sessionID: OC, status: { type: 'busy' } })
    await send('message.updated', { info: { id: 'm1', sessionID: OC, role: 'user' } })
    await send('message.part.updated', { part: { id: 'u1', sessionID: OC, messageID: 'm1', type: 'text', text: '# Build the todo backend\nmore detail' } })
    await send('message.updated', { info: { id: 'm2', sessionID: OC, role: 'assistant', providerID: 'opencode-go', modelID: 'glm-5.3-flash' } })
    await send('message.part.updated', { part: { id: 'a1', sessionID: OC, messageID: 'm2', type: 'text', text: 'Reading the brief', time: { end: 1 } } })

    const appeared = await waitFor(async () => { const c = await chips(); return c.length === 1 ? c : null }, 8000, 300)
    t.check('a worker tab appears for the Claude session, named from its prompt', !!appeared && appeared[0].startsWith('running:') && appeared[0].includes('Build the todo backend'), JSON.stringify(appeared))

    await app.evaluate(`document.querySelector('[data-worker-id]')?.click()`)
    const first = await waitFor(async () => { const v = await viewText(); return v && v.includes('Reading the brief') ? v : null }, 5000, 300)
    t.check('clicking it opens the read-only view with the output', !!first, String(first).slice(0, 100))
    t.check('the view shows Read-only and the model', !!first && first.includes('Read-only') && first.includes('glm-5.3-flash'))

    await send('message.part.updated', { part: { id: 'k1', sessionID: OC, messageID: 'm2', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'npm test' } } } })
    await send('message.part.updated', { part: { id: 's1', sessionID: OC, messageID: 'm2', type: 'step-finish', cost: 0.0123, tokens: { total: 4200 } } })
    const live = await waitFor(async () => { const v = await viewText(); return v && v.includes('npm test') && v.includes('4.2k') ? v : null }, 5000, 300)
    t.check('new output streams into the open view live', !!live, String(live).slice(0, 140))

    await send('session.idle', { sessionID: OC })
    const done = await waitFor(async () => ((await chips())[0] || '').startsWith('done:'), 5000, 300)
    t.check('the tab flips to done when the worker goes idle', !!done, JSON.stringify(await chips()))

    await send('message.updated', { info: { id: 'm3', sessionID: OC2, role: 'assistant', modelID: 'x', error: { name: 'APIError', data: { message: 'Go usage limit exceeded' } } } })
    await send('session.idle', { sessionID: OC2 })
    const failed = await waitFor(async () => ((await chips()).find((c) => c.startsWith('failed:')) ? true : null), 5000, 300)
    t.check('a worker that hit an error shows as failed', !!failed, JSON.stringify(await chips()))

    await clickSession('claude-a')
    await sleep(600)
    t.check('selecting the Claude session returns to its terminal', await app.evaluate(`document.querySelector('[data-worker-view]') === null`))

    await clickSession('claude-b')
    await sleep(800)
    t.check('another Claude session does not see them', (await chips()).length === 0, JSON.stringify(await chips()))

    const bad = await fetch(`http://127.0.0.1:${endpoint.port}/worker/${a.id}/event`, { method: 'POST', headers: { 'x-token': 'wrong' }, body: '{}' })
    t.check('the hook server refuses a wrong token', bad.status === 401, String(bad.status))

    await clickSession('claude-a')
    await sleep(600)
    await app.evaluate(`document.querySelector('[data-worker-id] button[aria-label="Hide worker tab"]')?.click()`)
    await sleep(500)
    t.check('the hide button closes a worker tab', (await chips()).length === 1, JSON.stringify(await chips()))
    void b
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
