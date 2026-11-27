// E2E (D79): Jarvis and an OpenCode session. A real `opencode` TUI on a FREE model answers one tiny prompt, then over Jarvis's own
// MCP endpoint (the way a real Jarvis calls it): get_last_answer returns the OpenCode reply from `opencode session export`,
// search_conversations finds OpenCode text, fleet_digest lists every session with its state and reply, and the "ask me" permission
// policy is stored on the session. No model drives Jarvis: the tools are called directly.
// Run: npx electron-vite build && node scripts/e2e-opencode-jarvis.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const PORT = 9507
// The free model is often out of quota (then the export holds an error and no text); the paid flash model answers one word for a fraction of a cent.
const MODEL = process.env.OC_E2E_MODEL || 'opencode-go/deepseek-v4.1-flash'

async function main() {
  stopOpencodeService()
  const t = makeChecker()
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-ocjarvis-'))
  const userData = path.join(rootDir, 'userdata')
  fs.mkdirSync(userData)
  let app
  const created = new Set()
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const cfgFile = path.join(userData, 'jarvis', 'mcp.json')
    await waitFor(() => (fs.existsSync(cfgFile) ? true : null), 20000, 300)
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const tool = async (name, args = {}) => {
      const res = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
      const body = await res.json()
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    const store = () => app.evaluate('window.api.getStore()')
    const sessionOf = async (id) => (await store()).data.sessions.find((s) => s.id === id)
    const runtimeOf = async (id) => (await store()).runtime.find((r) => r.sessionId === id)

    // ---- an OpenCode session answers one prompt
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'oc digest', agent: 'opencode', model: ${JSON.stringify(MODEL)} })`)
    const id = JSON.stringify(s.id)
    t.check('the default OpenCode permission policy is yolo (nothing stored)', s.opencodePermissions === undefined || s.opencodePermissions === 'yolo', String(s.opencodePermissions))
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('oc digest')).click()`)
    const up = await waitFor(async () => (await runtimeOf(s.id))?.run === 'running', 40000, 1000)
    t.check('the OpenCode TUI starts', !!up)
    await sleep(4000)
    await app.evaluate(`window.api.ptyWrite(${id}, 'reply with the single word: pong')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${id}, '\\r')`)
    const finished = await waitFor(async () => (await runtimeOf(s.id))?.activity === 'finished', 90000, 500)
    t.check('the turn finishes (plugin idle event)', !!finished)
    const gotId = await waitFor(async () => /^ses_/.test((await sessionOf(s.id)).opencodeSessionId || ''), 10000, 300)
    t.check('the OpenCode conversation id was captured', !!gotId)
    t.check('the plugin reported, so the card is not flagged "plugin missing"', (await runtimeOf(s.id))?.opencodePlugin !== 'missing', String((await runtimeOf(s.id))?.opencodePlugin))

    // ---- get_last_answer reads the OpenCode conversation
    const answer = await tool('get_last_answer', { session: 'oc digest' })
    t.check('get_last_answer answers for an OpenCode session', !answer.error && /pong/i.test(answer.text) && !/^The last prompt has no reply/.test(answer.text), answer.text.slice(0, 160))
    const convo = await tool('read_conversation', { session: 'oc digest', last: 5 })
    t.check('read_conversation lists the OpenCode messages with roles (D91)', !convo.error && /USER/.test(convo.text) && /ASSISTANT/.test(convo.text) && /pong/i.test(convo.text), convo.text.slice(0, 200))
    const listed = await tool('list_sessions', {})
    t.check('list_sessions still answers', !listed.error)
    t.check('the answer is the saved conversation, not a screen scrape', !/screen/i.test(answer.text.split('\n')[0]), answer.text.split('\n')[0].slice(0, 120))

    // ---- search_conversations finds OpenCode text
    const found = await waitFor(async () => {
      const r = await tool('search_conversations', { query: 'single word: pong' })
      return !r.error && /oc digest/.test(r.text) ? r : null
    }, 20000, 1000)
    t.check('search_conversations finds the OpenCode conversation', !!found, found ? '' : (await tool('search_conversations', { query: 'single word: pong' })).text.slice(0, 200))

    // ---- fleet_digest lists everything
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'plain shell', agent: 'shell' })`)
    await sleep(1500)
    const names = (await (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/list', params: {} }) })).json()).result.tools.map((x) => x.name)
    t.check('tools/list offers fleet_digest (96 tools in all)', names.includes('fleet_digest') && names.length === 96, String(names.length))
    const digest = await tool('fleet_digest')
    t.check('fleet_digest lists both sessions', !digest.error && digest.text.includes('oc digest') && digest.text.includes('plain shell'), digest.text.slice(0, 300))
    t.check('fleet_digest shows the OpenCode reply tail', /reply:[^\r\n]*pong/i.test(digest.text), digest.text.slice(0, 400))
    t.check('fleet_digest names the agent', /opencode/i.test(digest.text) && /shell/i.test(digest.text))
    const limited = await tool('fleet_digest', { limit: 1 })
    t.check('fleet_digest limit says how many were left out', !limited.error && /1 more|not shown/i.test(limited.text), limited.text.slice(-160))
    const bad = await tool('fleet_digest', { limit: 'many' })
    t.check('a bad limit is refused with a message, not a crash', bad.error || /limit/i.test(bad.text), bad.text.slice(0, 160))

    // ---- set_session_model keeps the conversation (sleep + wake with -s), and undo puts the model back
    const ocBefore = (await sessionOf(s.id)).opencodeSessionId
    const other = 'opencode-go/deepseek-v4.1-flash'
    const flag = await tool('set_session_model', { session: 'oc digest', model: '--bad' })
    t.check('set_session_model refuses a flag-looking model', flag.error, flag.text.slice(0, 160))
    const noClaude = await tool('set_session_model', { session: 'plain shell', model: other })
    t.check('set_session_model refuses a shell session', noClaude.error, noClaude.text.slice(0, 160))
    const switched = await tool('set_session_model', { session: 'oc digest', model: 'opencode/deepseek-v4.1-flash-free' })
    t.check('set_session_model changes the model of the live session', !switched.error && (await sessionOf(s.id)).model === 'opencode/deepseek-v4.1-flash-free', switched.text.slice(0, 200))
    const upAgain = await waitFor(async () => (await runtimeOf(s.id))?.run === 'running' && (await runtimeOf(s.id))?.sleeping !== true, 40000, 500)
    t.check('the session is running again after the model switch', !!upAgain)
    t.check('the OpenCode conversation id is unchanged by the model switch', (await sessionOf(s.id)).opencodeSessionId === ocBefore, `${ocBefore} vs ${(await sessionOf(s.id)).opencodeSessionId}`)
    const undone = await tool('undo_last_action')
    t.check('undo_last_action puts the old model back', !undone.error && (await sessionOf(s.id)).model === MODEL, `${undone.text.slice(0, 120)} / ${(await sessionOf(s.id)).model}`)
    await waitFor(async () => (await runtimeOf(s.id))?.run === 'running' && (await runtimeOf(s.id))?.sleeping !== true, 40000, 500)

    // ---- fork of an OpenCode session is a COPY with its own conversation id
    const forked = await tool('fork_session', { session: 'oc digest' })
    t.check('fork_session works for an OpenCode session and says it is a copy', !forked.error && /copy/i.test(forked.text), forked.text.slice(0, 240))
    const copyId = await waitFor(async () => {
      const c = (await store()).data.sessions.find((x) => x.name.includes('(fork)') && x.agent === 'opencode')
      return c && /^ses_/.test(c.opencodeSessionId || '') ? c : null
    }, 20000, 500)
    t.check('the copy is a new SessionDeck session with a different OpenCode conversation id', !!copyId && copyId.opencodeSessionId !== ocBefore, copyId ? copyId.opencodeSessionId : 'none')
    if (copyId) {
      const copyAnswer = await waitFor(async () => {
        const r = await tool('get_last_answer', { session: copyId.name })
        return !r.error && /pong/i.test(r.text) ? r : null
      }, 30000, 1000)
      t.check('the copy carries the original conversation (its last answer is pong)', !!copyAnswer)
    }

    // ---- the "ask me" permission policy is stored and survives a restart of the store read
    const ask = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'oc ask', agent: 'opencode', model: ${JSON.stringify(MODEL)}, opencodePermissions: 'ask' })`)
    t.check('createSession stores opencodePermissions "ask"', (await sessionOf(ask.id)).opencodePermissions === 'ask')
    const claude = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'shell ask', agent: 'shell', opencodePermissions: 'ask' })`).catch(() => null)
    t.check('the option is ignored (or refused) for a non-OpenCode session', claude === null || claude.opencodePermissions === undefined, JSON.stringify(claude && claude.opencodePermissions))
  } catch (error) {
    t.check('e2e ran without an exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    // The OpenCode conversations this run made live in the user's real OpenCode store: remove them (best effort).
    try {
      const st = app ? await store() : null
      for (const x of st ? st.data.sessions : []) if (x.agent === 'opencode' && /^ses_[A-Za-z0-9]+$/.test(x.opencodeSessionId || '')) created.add(x.opencodeSessionId)
    } catch {}
    if (app) app.kill()
    stopOpencodeService()
    for (const id of created) { try { require('node:child_process').execFileSync('opencode', ['session', 'delete', id], { shell: true, stdio: 'ignore', timeout: 20000 }) } catch {} }
    try { fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
    process.exit(t.summary() === 0 ? 0 : 1)
  }
}

main()
