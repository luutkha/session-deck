// Manual smoke test for OpenCode prompt/context parity (free model, needs `opencode` on PATH):
// one REAL turn in an OpenCode session must record its prompt in the timeline and report a context %
// through the plugin-injected statusline. Run: node scripts/smoke-opencode-parity.cjs
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const MODEL = 'opencode/deepseek-v4.1-flash-free'
const store = (app) => app.evaluate('window.api.getStore()')
const sessionOf = async (app, id) => (await store(app)).data.sessions.find((s) => s.id === id)
const runtimeOf = async (app, id) => (await store(app)).runtime.find((r) => r.sessionId === id)
const replay = async (app, id) => strip((await app.evaluate(`window.api.ptyReplay(${JSON.stringify(id)})`)).data)

async function main() {
  // A stale background service would silently swallow the injected plugin config.
  stopOpencodeService()
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9459 })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'oc parity', agent: 'opencode', model: ${JSON.stringify(MODEL)} })`)
    const id = JSON.stringify(s.id)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('oc parity')).click()`)

    const up = await waitFor(async () => (await runtimeOf(app, s.id))?.run === 'running' && /opencode|Ask anything|build/i.test(await replay(app, s.id)), 40000, 1000)
    t.check('opencode TUI starts in the pty', !!up)

    await sleep(3000)
    const prompt = 'reply with the single word: pong'
    await app.evaluate(`window.api.ptyWrite(${id}, ${JSON.stringify(prompt)})`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${id}, '\\r')`)

    const working = await waitFor(async () => (await runtimeOf(app, s.id))?.activity === 'working', 30000, 300)
    t.check('prompt submitted -> activity "working"', !!working)
    const finished = await waitFor(async () => (await runtimeOf(app, s.id))?.activity === 'finished', 120000, 500)
    t.check('turn done -> activity "finished"', !!finished)

    // ---- A: the timeline row carries the prompt the user typed (was blank for OpenCode before)
    const turns = await app.evaluate(`window.api.getTimeline(${id})`)
    const turn = turns[turns.length - 1]
    t.check('the timeline turn has the prompt text', !!turn && typeof turn.prompt === 'string' && turn.prompt.includes('pong'), JSON.stringify(turns))
    t.check('the turn finished with the normal end state', !!turn && turn.end === 'finished', JSON.stringify(turn && turn.end))

    // ---- B: the plugin's statusline fills the context % (model catalog limit + latest step tokens)
    const usage = await waitFor(async () => {
      const state = await app.evaluate('window.api.getUsage()')
      const entry = state.sessions.find((x) => x.sessionId === s.id)
      return entry !== undefined && entry.contextPercent !== null ? entry : null
    }, 20000, 500)
    t.check('the session usage reports a context %', !!usage, JSON.stringify(await app.evaluate('window.api.getUsage()')))
    t.check('the context % is in 0..100', !!usage && usage.contextPercent >= 0 && usage.contextPercent <= 100, String(usage && usage.contextPercent))
    console.log('\nUSAGE:\n' + JSON.stringify(usage))
    const st = await sessionOf(app, s.id)
    t.check('the real OpenCode conversation id was still captured', /^ses_/.test(st.opencodeSessionId || ''), String(st.opencodeSessionId))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
