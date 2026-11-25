// E2E (worker tabs): a REAL OpenCode session gets worker tabs for child opencode processes, while a child's
// session-plugin events (different OpenCode session id, busy/idle, statusline cost) never touch the parent:
// opencodeSessionId, activity and cost stay unchanged. The real plugin PACKAGES the app wrote are loaded in this
// process with the parent session's SESSIONDECK_* env and fed OpenCode-shaped events (v2: default export
// {id, setup}, context.event.subscribe() AsyncIterable, payloads under .data), so plugin -> hook server ->
// WorkerHub/AttentionService -> IPC -> tabs are all exercised. Run: node scripts/e2e-opencode-workers.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { sleep, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const MODEL = 'opencode/deepseek-v4.1-flash-free'
const CHILD_OC = 'ses_e2echild00000001'

async function main() {
  // A stale background service would silently swallow the injected plugin config.
  stopOpencodeService()
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-ocworkers-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj, { recursive: true })
    app = await launchApp({ port: 9445 })
    await sleep(1500)
    const s = await app.evaluate(
      `window.api.createSession({ cwd: ${JSON.stringify(proj)}, name: 'oc owner', agent: 'opencode', model: ${JSON.stringify(MODEL)} })`
    )
    await sleep(1500)
    await app.evaluate(
      `[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('oc owner')).click()`
    )
    const sessionOf = async () =>
      (await app.evaluate('window.api.getStore()')).data.sessions.find((x) => x.id === s.id)
    const runtimeOf = async () =>
      (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === s.id)
    const chips = () => app.evaluate(
      `[...document.querySelectorAll('[data-worker-id]')].map((n) => n.getAttribute('data-worker-status') + ':' + n.innerText.trim())`
    )
    const replay = async () => strip((await app.evaluate(`window.api.ptyReplay(${JSON.stringify(s.id)})`)).data)

    // Wait for the real parent TUI to actually draw (run flag alone just means the pty started), then give it a
    // real turn: the TUI creates its conversation lazily on the first prompt, so AgentSession (and the stored
    // conversation id) only arrive after a prompt is submitted.
    await waitFor(async () => (await runtimeOf())?.run === 'running' && /opencode|Ask anything|build/i.test(await replay()), 40000, 1000)
    await sleep(1500)
    await app.evaluate(`window.api.ptyWrite(${JSON.stringify(s.id)}, 'reply with the single word: pong')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${JSON.stringify(s.id)}, '\\r')`)
    const captured = await waitFor(async () => /^ses_/.test((await sessionOf()).opencodeSessionId || ''), 30000, 500)
    t.check('the real parent captured its OpenCode conversation id', !!captured)
    const finishedTurn = await waitFor(async () => (await runtimeOf())?.activity === 'finished', 120000, 500)
    t.check('the parent turn finished before the child-filter checks', !!finishedTurn)
    await sleep(2500) // parent hello/beat + self-report are registered (and dropped) by now
    {
      const mine = await app.evaluate(
        `window.api.getWorkers().then((w) => w.filter((x) => x.ownerSessionIds.includes(${JSON.stringify(s.id)})).length, () => -1)`
      )
      t.check('no worker tab for the parent itself', mine === 0, String(mine))
    }
    const ocId = (await sessionOf()).opencodeSessionId
    const activityBefore = (await runtimeOf())?.activity ?? null
    const costBeforeValue = (await app.evaluate('window.api.getUsage()'))
      .sessions.find((u) => u.sessionId === s.id)?.costUsd ?? null

    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const attentionDir = path.join(app.userData, 'sessiondeck-attention')
    const workerPluginDir = path.join(attentionDir, 'sessiondeck-worker-plugin')
    const sessionPluginDir = path.join(attentionDir, 'sessiondeck-opencode-plugin')
    t.check(
      'the app wrote both plugin packages',
      fs.existsSync(path.join(workerPluginDir, 'package.json')) && fs.existsSync(path.join(sessionPluginDir, 'package.json'))
    )

    // Both plugins load with the PARENT session's env; every body they post carries this process pid as proc,
    // which is NOT the parent's proc: the hub must treat these events as a child worker. v2 shape: the module's
    // default export {id, setup}; events arrive through context.event.subscribe() — here a manual AsyncIterable
    // the test feeds with {type, data} events (the same shape the real v2 event bus delivers).
    const makeFeed = () => {
      const queue = []
      let wake = null
      return {
        push(event) { if (wake) { const w = wake; wake = null; w(event) } else queue.push(event) },
        async *iterate() {
          for (;;) {
            if (queue.length > 0) yield queue.shift()
            else yield await new Promise((r) => { wake = r })
          }
        }
      }
    }
    const plugin = async (dir, sessionId) => {
      process.env.SESSIONDECK_PORT = String(endpoint.port)
      process.env.SESSIONDECK_TOKEN = endpoint.token
      process.env.SESSIONDECK_SESSION_ID = sessionId
      const mod = await import(pathToFileURL(path.join(dir, 'index.mjs')).href + '?t=' + Date.now() + Math.random())
      const feed = makeFeed()
      await mod.default.setup({ directory: proj, event: { subscribe: async () => feed.iterate() } })
      return (type, data) => feed.push({ type, data })
    }
    const worker = await plugin(workerPluginDir, s.id)
    const sessionHook = await plugin(sessionPluginDir, s.id)
    const post = (urlPath, body) => fetch(`http://127.0.0.1:${endpoint.port}${urlPath}`, {
      method: 'POST',
      headers: { 'x-token': endpoint.token, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

    // ---- child worker events build a normal worker tab
    await worker('session.created', { info: { id: CHILD_OC, title: 'New session - child', directory: proj } })
    await worker('session.status', { sessionID: CHILD_OC, status: { type: 'busy' } })
    await worker('message.updated', { info: { id: 'u1', sessionID: CHILD_OC, role: 'user' } })
    await worker('message.part.updated', { part: { id: 't1', sessionID: CHILD_OC, messageID: 'u1', type: 'text', text: 'Refactor the worker module' } })
    await worker('message.updated', { info: { id: 'a1', sessionID: CHILD_OC, role: 'assistant', providerID: 'opencode', modelID: MODEL } })
    await waitFor(async () => (await chips()).length === 1 ? (await chips()) : null, 8000, 300)
    const tab = await chips()
    t.check('a child opencode process shows a worker tab of the OpenCode session', tab.length === 1, JSON.stringify(tab))

    await app.evaluate(`document.querySelector('[data-worker-id]')?.click()`)
    const viewText = await waitFor(async () => {
      const v = await app.evaluate(`document.querySelector('[data-worker-view]')?.innerText ?? null`)
      return v && v.includes('Refactor the worker module') ? v : null
    }, 5000, 300)
    t.check('the read-only view shows the child output', !!viewText, String(viewText ?? '').slice(0, 80))

    // ---- the child's session-plugin events must not touch the parent
    await sessionHook('session.created', { info: { id: 'ses_fakechild0002', title: 'child x', directory: proj } })
    await sessionHook('session.status', { sessionID: 'ses_fakechild0002', status: { type: 'busy' } })
    await sessionHook('session.status', { sessionID: 'ses_fakechild0002', status: { type: 'idle' } })
    // This process pid registered as a WORKER proc (our hello above is not the first for the session), so the
    // app must drop its statusline; a proc-less body would BE the owner and must land (checked further below).
    await post(`/statusline/${s.id}`, { cost: { total_cost_usd: 99.5 }, model: { display_name: 'should-not-land' }, proc: String(process.pid) })
    await sleep(1200)
    const st = await sessionOf()
    t.check('a child AgentSession does not overwrite opencodeSessionId', st.opencodeSessionId === ocId, `${ocId} vs ${st.opencodeSessionId}`)
    const activityAfter = (await runtimeOf())?.activity ?? null
    t.check('a child busy/idle does not change the parent activity (UserPromptSubmit/Stop)', activityAfter === activityBefore, `${String(activityBefore)} -> ${String(activityAfter)}`)
    t.check('a child statusline cost does not land on the parent', ((await app.evaluate('window.api.getUsage()')).sessions.find((u) => u.sessionId === s.id)?.costUsd ?? null) === costBeforeValue, `${String(costBeforeValue)}`)

    // ---- the parent itself is still accepted (no proc / owner proc): a plain statusline updates the cost
    await post(`/statusline/${s.id}`, { cost: { total_cost_usd: 0.25 }, model: { display_name: 'free-model' } })
    const updated = await waitFor(async () => (await app.evaluate('window.api.getUsage()')).sessions.find((u) => u.sessionId === s.id)?.costUsd ?? null, 8000, 300)
    t.check('the parent process statusline still updates usage', updated === 0.25, String(updated))

    // ---- closing the session clears its worker tab
    await app.evaluate(`window.api.closeSession(${JSON.stringify(s.id)})`)
    await sleep(1500)
    t.check('closing the session empties its worker tab', ((await chips()).length === 0) || !JSON.stringify((await chips())).includes('child'), JSON.stringify(await chips()))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
    sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
  }
}
main()
