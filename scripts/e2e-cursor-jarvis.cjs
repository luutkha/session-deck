// E2E (D81): every Jarvis tool that controls or reads a session, exercised on a Cursor session like on Claude/OpenCode.
// The app is the real built one (out/main/index.js). A fake `cursor-agent` (a .cmd shim, first on PATH) imitates Cursor:
// it logs its argv, reads the app's hooks.json and runs those hook commands for every prompt line on stdin, so the real
// hook bridge, store, controller, prompt queue, auto status and Jarvis tools all run. A second fake `claude` exists only
// so the set_session_model refusal for Claude sessions can be checked without starting the real Claude CLI.
// Jarvis itself is not started: its tools are called over the app's own MCP endpoint, exactly like a real Jarvis would.
// Checks cover: fresh argv (--yolo --trust), list/read/wait/answer, press_keys, the prompt queue (when=queue + empty),
// queue_change/list/clear on a sleeping session, sleep/wake and close/reopen round trips (same session id + cursorChatId,
// --resume), restart_session, rename, set_status + auto status (Working -> Review), groups, notes, checklist, keep awake
// (pin), set_read/needs_you, attach_files, open_session, terminal_search, a second Cursor session, broadcast_prompt,
// bulk_action, a shell session next to them, fleet_digest, search_conversations, set_session_model (accept/restart/bad
// names/clear/Claude+shell refusals), fork refusal, and a two-step task plan with {{answer}} substitution.
// Nothing here uses the real ~/.cursor or ~/.claude: the userData dir and SESSIONDECK_CURSOR_CONFIG_DIR are temp folders.
// Run: npx electron-vite build && node scripts/e2e-cursor-jarvis.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9516
const HARNESS = path.join(__dirname, '..', 'out', 'main', 'index.js')
const REAL_CURSOR_HOOKS = path.join(os.homedir(), '.cursor', 'hooks.json')

// The fake Cursor CLI: one conversation id per process (the --resume id, or a new one), the app's hooks.json commands
// run for every prompt line, the argv logged next to the shim. It ignores keys (as a TUI would ignore an unknown key).
const FAKE_AGENT_SOURCE = String.raw`'use strict'
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const argv = process.argv.slice(2)
const root = path.resolve(__dirname, '..')
fs.appendFileSync(path.join(root, 'fake-argv.log'), JSON.stringify(argv) + '\n')

const resumeAt = argv.indexOf('--resume')
const chatId = resumeAt >= 0 && argv[resumeAt + 1] ? argv[resumeAt + 1] : randomUUID()

const configDir = process.env.SESSIONDECK_CURSOR_CONFIG_DIR || ''
let hooks = null
try {
  hooks = JSON.parse(fs.readFileSync(path.join(configDir, 'hooks.json'), 'utf8'))
} catch {
  hooks = null
}

process.stdout.write('fake-cursor ready\n')
process.stdout.write('fake-cursor chat ' + chatId + '\n')
if (hooks === null) process.stdout.write('no hooks\n')

function runHooks(event, payload) {
  const list = hooks && hooks.hooks && Array.isArray(hooks.hooks[event]) ? hooks.hooks[event] : []
  for (const entry of list) {
    if (!entry || typeof entry.command !== 'string') continue
    spawnSync(entry.command, {
      shell: true,
      input: JSON.stringify(payload),
      env: process.env,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 10000,
      windowsHide: true
    })
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function turn(line) {
  const base = { conversation_id: chatId, workspace_roots: [process.cwd()], transcript_path: '' }
  runHooks('beforeSubmitPrompt', Object.assign({}, base, { hook_event_name: 'beforeSubmitPrompt', prompt: line }))
  await wait(1500)
  runHooks('afterAgentResponse', Object.assign({}, base, { hook_event_name: 'afterAgentResponse', text: 'FAKE ANSWER: ' + line }))
  runHooks('stop', Object.assign({}, base, { hook_event_name: 'stop' }))
  process.stdout.write('done: ' + line + '\n')
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
let chain = Promise.resolve()
rl.on('line', (line) => {
  if (line.trim().length === 0) return
  chain = chain.then(() => turn(line)).catch(() => {})
})
rl.on('close', () => {
  chain.then(() => process.exit(0))
})
`

// A stand-in Claude CLI: it only has to exist so a Claude session can be created (set_session_model refuses it before
// it ever types). It never runs a turn, so no Claude quota is touched.
const FAKE_CLAUDE_SOURCE = String.raw`'use strict'
process.stdout.write('fake-claude ready\n')
process.stdin.resume()
process.stdin.on('data', () => {})
process.stdin.on('end', () => process.exit(0))
setInterval(() => {}, 1 << 30)
`

function writeFakes(shimDir) {
  fs.mkdirSync(shimDir, { recursive: true })
  fs.writeFileSync(path.join(shimDir, 'fake-cursor.cjs'), FAKE_AGENT_SOURCE, 'utf8')
  fs.writeFileSync(path.join(shimDir, 'cursor-agent.cmd'), '@node "%~dp0fake-cursor.cjs" %*\r\n', 'utf8')
  fs.writeFileSync(path.join(shimDir, 'fake-claude.cjs'), FAKE_CLAUDE_SOURCE, 'utf8')
  fs.writeFileSync(path.join(shimDir, 'claude.cmd'), '@node "%~dp0fake-claude.cjs" %*\r\n', 'utf8')
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function argvLines(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function planStepAnswer(text, stepId) {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.startsWith(`- ${stepId} "`))
  if (at < 0) return ''
  const next = lines[at + 1] ?? ''
  return next.startsWith('  answer: ') ? next.slice('  answer: '.length).trim() : ''
}

/** One session's block of fleet_digest: its header line and the indented lines under it. */
function digestBlock(text, name) {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.startsWith(`"${name}" (`))
  if (at < 0) return ''
  let end = at + 1
  while (end < lines.length && lines[end].startsWith('  ')) end += 1
  return lines.slice(at, end).join('\n')
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const trustPrefix = (argv) => Array.isArray(argv) && argv[0] === '--yolo' && argv[1] === '--trust'

/** The app's Jarvis MCP endpoint (the way a real Jarvis calls the tools) after the app wrote <userData>/jarvis/mcp.json. */
async function connect(app, userData) {
  const cfgFile = path.join(userData, 'jarvis', 'mcp.json')
  const ready = await waitFor(() => (fs.existsSync(cfgFile) ? true : null), 20000, 300)
  if (!ready) throw new Error('the app did not write jarvis/mcp.json')
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
  let rpcId = 0
  const call = async (method, params = {}) => {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { ...cfg.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
    })
    return res.json()
  }
  const tool = async (name, args = {}) => {
    try {
      const body = await call('tools/call', { name, arguments: args })
      if (body.error !== undefined) return { text: JSON.stringify(body.error), error: true }
      const result = body.result
      return { text: (result && result.content && result.content[0] && result.content[0].text) || '', error: result && result.isError === true }
    } catch (error) {
      return { text: error && error.message ? error.message : String(error), error: true }
    }
  }
  const toolNames = async () => ((await call('tools/list', {})).result.tools || []).map((entry) => entry.name)
  return { tool, toolNames }
}

async function main() {
  if (!fs.existsSync(HARNESS)) {
    console.log(`FAIL  the built app is missing (${HARNESS}); run: npx electron-vite build`)
    process.exit(1)
  }
  const t = makeChecker()
  let number = 0
  const check = (name, ok, detail = '') => t.check(`${++number}: ${name}`, ok, detail)
  const skip = (what) => console.log(`SKIP ${++number}: ${what}`)

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-cursor-jarvis-'))
  const userData = path.join(rootDir, 'userdata')
  const workDir = path.join(rootDir, 'work')
  const shimDir = path.join(rootDir, 'shim')
  const cursorHome = path.join(rootDir, 'cursor-home')
  const hooksFile = path.join(cursorHome, 'hooks.json')
  const argvFile = path.join(rootDir, 'fake-argv.log')
  const storeFile = path.join(userData, 'sessiondeck-store.json')
  for (const dir of [userData, workDir, cursorHome]) fs.mkdirSync(dir, { recursive: true })

  const originalPath = process.env.PATH ?? ''
  const originalCursorConfigDir = process.env.SESSIONDECK_CURSOR_CONFIG_DIR
  const realHomeBefore = (() => {
    try {
      const stat = fs.statSync(REAL_CURSOR_HOOKS)
      return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
      return { exists: false }
    }
  })()
  const apps = []
  let app = null
  let NAME = 'cursor jarvis'
  let id = ''
  let chatId = ''
  let secondId = ''

  try {
    // A foreign hook and key prove the app's hooks.json merge still leaves other tools alone (as scripts/e2e-cursor.cjs).
    fs.writeFileSync(hooksFile, JSON.stringify({
      version: 1,
      foreignKey: { keep: true },
      hooks: { stop: [{ command: 'echo foreign', timeout: 10 }] }
    }, null, 2), 'utf8')
    writeFakes(shimDir)
    process.env.PATH = shimDir + path.delimiter + originalPath
    process.env.SESSIONDECK_CURSOR_CONFIG_DIR = cursorHome

    app = await launchApp({ port: PORT, userData })
    apps.push(app)
    await sleep(1500)
    const { tool, toolNames } = await connect(app, userData)
    const names = await toolNames()

    // ---- helpers reading the real store / argv log
    const snapshot = () => app.evaluate('window.api.getStore()')
    const storeData = async () => (await snapshot()).data
    const sessionById = async (sid) => (await storeData()).sessions.find((s) => s.id === sid)
    const runtimeOf = async (sid) => (await snapshot()).runtime.find((r) => r.sessionId === sid)
    const statusIdOf = async (sid) => (await sessionById(sid))?.statusId ?? null
    const argvCount = () => argvLines(argvFile).length
    const newArgvSince = (count, predicate, timeout = 30000) =>
      waitFor(() => {
        const fresh = argvLines(argvFile).slice(count)
        return fresh.find(predicate) ?? null
      }, timeout, 200)
    const waitRuntime = (sid, predicate, timeout = 40000) =>
      waitFor(async () => {
        const runtime = await runtimeOf(sid)
        return runtime !== undefined && predicate(runtime) ? runtime : null
      }, timeout, 150)
    const waitStatus = (sid, statusId, timeout = 10000) =>
      waitFor(async () => ((await statusIdOf(sid)) === statusId ? true : null), timeout, 150)

    const needed = [
      'list_sessions', 'read_screen', 'get_activity', 'search_conversations', 'wait_for_session', 'get_last_answer',
      'create_session', 'send_prompt', 'broadcast_prompt', 'press_keys', 'sleep_session', 'wake_session',
      'restart_session', 'close_session', 'fork_session', 'set_session_model', 'rename_session', 'set_status',
      'move_to_group', 'create_group', 'set_notes', 'set_keep_awake', 'open_session', 'queue_list', 'queue_change',
      'checklist_get', 'checklist_change', 'bulk_action', 'needs_you', 'set_read', 'fleet_digest', 'attach_files',
      'terminal_search', 'get_screen_state', 'status_change', 'update_settings', 'plan_create', 'plan_status'
    ]
    const missing = needed.filter((name) => !names.includes(name))
    check('the built app serves every Jarvis tool this e2e uses', missing.length === 0 && names.length >= 90, `${names.length} tools; missing: ${missing.join(', ') || 'none'}`)

    // ================= create the Cursor session =================
    const created = await tool('create_session', { folder: workDir, name: NAME, agent: 'cursor', model: 'gpt-5' })
    check('create_session starts a Cursor session with model gpt-5', !created.error && /Created/.test(created.text) && /cursor/.test(created.text), created.text.slice(0, 240))
    const row = await waitFor(async () => (await storeData()).sessions.find((s) => s.name === NAME) ?? null, 10000, 200)
    id = row ? row.id : ''
    if (id === '') throw new Error('the Cursor session was not created')

    const fresh = await waitFor(() => argvLines(argvFile)[0] ?? null, 20000, 200)
    check('a fresh Cursor session starts with --yolo --trust in that order', trustPrefix(fresh), JSON.stringify(fresh))
    check('...then --model gpt-5 and no --resume (a new chat)', !!fresh && fresh[2] === '--model' && fresh[3] === 'gpt-5' && !fresh.includes('--resume'), JSON.stringify(fresh))

    const listed = await tool('list_sessions')
    const listedLine = listed.text.split('\n').find((line) => line.includes(`"${NAME}"`)) ?? ''
    check('list_sessions shows the Cursor agent and the model', !listed.error && listedLine.includes('· cursor ·') && listedLine.includes('model gpt-5'), listedLine)

    // ================= first turn: send_prompt when=now =================
    const sent1 = await tool('send_prompt', { session: NAME, text: 'hello cursor', when: 'now' })
    check('send_prompt when=now starts a turn in the Cursor session', !sent1.error && /started working/.test(sent1.text), sent1.text.slice(0, 200))
    const working1 = await waitRuntime(id, (runtime) => runtime.activity === 'working', 10000)
    check('the beforeSubmitPrompt hook moves the Cursor session to working', working1 !== null)
    const autoWorking = await waitStatus(id, 'working', 5000)
    check('auto status moves the Cursor session to Working while the turn runs', autoWorking === true, String(await statusIdOf(id)))

    const waited1 = await tool('wait_for_session', { session: NAME, timeout_seconds: 60 })
    check('wait_for_session returns when the Cursor turn finishes', !waited1.error && !/still working/.test(waited1.text) && /waited \d+ s/.test(waited1.text), waited1.text.slice(0, 200))
    const finished1 = await waitRuntime(id, (runtime) => runtime.activity === 'finished', 10000)
    check('the stop hook moves the Cursor session to finished', finished1 !== null)
    const autoReview = await waitStatus(id, 'review', 5000)
    check('auto status moves the Cursor session to Review after the turn', autoReview === true, String(await statusIdOf(id)))

    const answer1 = await tool('get_last_answer', { session: NAME })
    check('get_last_answer returns the Cursor reply', !answer1.error && /FAKE ANSWER: hello cursor/.test(answer1.text), answer1.text.slice(0, 200))

    const screen1 = await tool('read_screen', { session: NAME, lines: 300 })
    check('read_screen shows the fake Cursor screen and the finished prompt', !screen1.error && /fake-cursor ready/.test(screen1.text) && /done: hello cursor/.test(screen1.text), screen1.text.slice(0, 220))
    const fakeChatId = (screen1.text.match(/fake-cursor chat ([A-Za-z0-9_-]{8,80})/) || [])[1]
    const storedChatId = await waitFor(() => {
      const data = readJson(storeFile)
      const stored = data && data.sessions.find((session) => session.id === id)
      return stored && stored.cursorChatId ? stored.cursorChatId : null
    }, 15000, 300)
    chatId = storedChatId ?? ''
    check('the store keeps cursorChatId, equal to the fake conversation id', !!fakeChatId && storedChatId === fakeChatId, `fake=${fakeChatId ?? '?'} stored=${storedChatId ?? '?'}`)

    // Enter alone is a blank line the fake ignores: keys are accepted, and no extra turn is invented (a TUI key would
    // arrive without a newline and stay in the line buffer, which would pollute the next prompt).
    const keys = await tool('press_keys', { session: NAME, keys: ['enter'] })
    const aliveAfterKeys = await waitRuntime(id, (runtime) => runtime.run === 'running', 10000)
    check('press_keys is accepted and the Cursor session stays alive', !keys.error && /Pressed enter/.test(keys.text) && aliveAfterKeys !== null, keys.text.slice(0, 200))

    const activity = await waitFor(async () => {
      const result = await tool('get_activity', { session: NAME })
      return !result.error && /1 turn\(s\) recorded|turn\(s\) recorded/.test(result.text) && /hello cursor/.test(result.text) ? result : null
    }, 10000, 300)
    check('get_activity records the Cursor turn through its hooks', !!activity, activity ? activity.text.slice(0, 200) : (await tool('get_activity', { session: NAME })).text.slice(0, 200))

    const opened = await tool('open_session', { session: NAME })
    check('open_session shows the Cursor session in the window', !opened.error && /Showing "cursor jarvis"/.test(opened.text), opened.text.slice(0, 160))

    const search = await tool('terminal_search', { action: 'find', query: 'fake-cursor ready', session: NAME })
    const screenState = await waitFor(async () => {
      const state = await tool('get_screen_state')
      return !state.error && /Terminal search: "fake-cursor ready"/.test(state.text) && !/Terminal search: "fake-cursor ready" \(No matches\)/.test(state.text) ? state : null
    }, 8000, 200)
    check('terminal_search finds text in the Cursor session on screen', !search.error && /Searching "cursor jarvis" for "fake-cursor ready"/.test(search.text) && screenState !== null && !/No matches/.test(screenState.text.split('\n').find((line) => line.includes('Terminal search')) ?? 'No matches'), `${search.text.slice(0, 140)} / ${screenState ? (screenState.text.split('\n').find((line) => line.includes('Terminal search')) ?? '') : 'no search line'}`)
    await tool('terminal_search', { action: 'close' })

    // ================= the prompt queue: when=queue typed after the turn =================
    const queueTurn = await tool('send_prompt', { session: NAME, text: 'queue turn one', when: 'now' })
    const queueWorking = await waitRuntime(id, (runtime) => runtime.activity === 'working', 10000)
    check('(setup) a Cursor turn runs before queueing', !queueTurn.error && queueWorking !== null, queueTurn.text.slice(0, 160))
    const queued = await tool('send_prompt', { session: NAME, text: 'queued turn two', when: 'queue' })
    check('send_prompt when=queue queues the prompt while the session works', !queued.error && /Queued for "cursor jarvis" \(position 1\)/.test(queued.text), queued.text.slice(0, 200))
    const queueListed = await tool('queue_list', { session: NAME })
    check('queue_list shows the queued prompt', !queueListed.error && /queued turn two/.test(queueListed.text), queueListed.text.slice(0, 200))
    const waitedQueue = await tool('wait_for_session', { session: NAME, timeout_seconds: 90 })
    const answer2 = await waitFor(async () => {
      const result = await tool('get_last_answer', { session: NAME })
      return !result.error && /FAKE ANSWER: queued turn two/.test(result.text) ? result : null
    }, 40000, 700)
    check('the queued prompt is typed in after the turn and answered', !!answer2 && !waitedQueue.error, answer2 ? answer2.text.slice(0, 160) : waitedQueue.text.slice(0, 160))
    const queueAfter = await tool('queue_list', { session: NAME })
    const rowAfterQueue = await sessionById(id)
    check('the queue is empty afterwards', /no queued prompts/.test(queueAfter.text) && (rowAfterQueue?.queue ?? []).length === 0, queueAfter.text.slice(0, 160))

    // ================= sleep, queue tools on the sleeping session, wake via send_prompt =================
    const slept = await tool('sleep_session', { session: NAME })
    const sleeping = await waitRuntime(id, (runtime) => runtime.sleeping === true, 15000)
    check('sleep_session puts the Cursor session to sleep', !slept.error && /is asleep/.test(slept.text) && sleeping !== null, slept.text.slice(0, 160))
    const queueAdd = await tool('queue_change', { session: NAME, action: 'add', text: 'parked prompt' })
    const parked = await tool('queue_list', { session: NAME })
    check('queue_change add and queue_list work on the sleeping Cursor session', !queueAdd.error && /Queued as number 1/.test(queueAdd.text) && /parked prompt/.test(parked.text), `${queueAdd.text.slice(0, 120)} / ${parked.text.slice(0, 120)}`)
    const queueRemove = await tool('queue_change', { session: NAME, action: 'remove', item: 1 })
    check('queue_change remove clears the parked prompt', !queueRemove.error && /Removed "parked prompt"/.test(queueRemove.text), queueRemove.text.slice(0, 160))
    const queueAdd2 = await tool('queue_change', { session: NAME, action: 'add', text: 'clear me' })
    const queueClear = await tool('queue_change', { session: NAME, action: 'clear' })
    check('queue_change clear empties the queue', !queueAdd2.error && !queueClear.error && /Cleared 1 queued prompt/.test(queueClear.text), queueClear.text.slice(0, 160))

    const beforeWake = argvCount()
    const woke = await tool('send_prompt', { session: NAME, text: 'woke up' })
    check('send_prompt wakes a sleeping Cursor session', !woke.error && /^Woke it first\./.test(woke.text), woke.text.slice(0, 200))
    const wakeArgv = await newArgvSince(beforeWake, (argv) => argv.includes('--resume'))
    check('the woken process resumes the same chat (--resume <stored id>)', !!wakeArgv && trustPrefix(wakeArgv) && wakeArgv[wakeArgv.indexOf('--resume') + 1] === chatId, JSON.stringify(wakeArgv))
    const answerWoke = await waitFor(async () => {
      const result = await tool('get_last_answer', { session: NAME })
      return !result.error && /FAKE ANSWER: woke up/.test(result.text) ? result : null
    }, 40000, 700)
    check('the woken Cursor session answers the prompt', !!answerWoke, answerWoke ? answerWoke.text.slice(0, 160) : 'no answer yet')
    const rowWoke = await sessionById(id)
    const runtimeWoke = await runtimeOf(id)
    check('sleep/wake keeps the session id and cursorChatId', rowWoke?.id === id && rowWoke?.cursorChatId === chatId && runtimeWoke?.run === 'running', `${rowWoke?.id === id} / ${rowWoke?.cursorChatId === chatId} / ${runtimeWoke?.run}`)

    // ================= close, reopen via send_prompt, then wake_session on a closed session =================
    const closed = await tool('close_session', { session: NAME })
    const closedRow = await waitFor(async () => {
      const current = await sessionById(id)
      return current !== undefined && current.closedAt !== undefined ? current : null
    }, 10000, 200)
    check('close_session closes the Cursor session', !closed.error && /is closed/.test(closed.text) && closedRow !== null, closed.text.slice(0, 160))
    // Let the killed process leave the pty map: reopenSession refuses while the old process is still stopping.
    await sleep(1200)
    const beforeReopen = argvCount()
    const reopened = await tool('send_prompt', { session: NAME, text: 'after close' })
    check('send_prompt reopens a closed Cursor session', !reopened.error && /^Reopened it first\./.test(reopened.text), reopened.text.slice(0, 200))
    const reopenArgv = await newArgvSince(beforeReopen, (argv) => argv.includes('--resume'))
    check('the reopened process uses --resume <the same chat id>', !!reopenArgv && trustPrefix(reopenArgv) && reopenArgv[reopenArgv.indexOf('--resume') + 1] === chatId, JSON.stringify(reopenArgv))
    const answerClose = await waitFor(async () => {
      const result = await tool('get_last_answer', { session: NAME })
      return !result.error && /FAKE ANSWER: after close/.test(result.text) ? result : null
    }, 40000, 700)
    check('the reopened Cursor session answers the prompt', !!answerClose, answerClose ? answerClose.text.slice(0, 160) : 'no answer yet')
    await tool('close_session', { session: NAME })
    await sleep(1200)
    const wokeClosed = await tool('wake_session', { session: NAME })
    const upAgain = await waitRuntime(id, (runtime) => runtime.run === 'running' && runtime.sleeping !== true, 40000)
    check('wake_session reopens a closed Cursor session', !wokeClosed.error && /was reopened/.test(wokeClosed.text) && upAgain !== null, wokeClosed.text.slice(0, 160))
    const rowReopen = await sessionById(id)
    check('close/reopen keeps the session id and cursorChatId', rowReopen?.id === id && rowReopen?.cursorChatId === chatId && rowReopen?.closedAt === undefined, `${rowReopen?.id === id} / ${rowReopen?.cursorChatId === chatId}`)

    // ================= restart_session =================
    const beforeRestart = argvCount()
    const restarted = await tool('restart_session', { session: NAME })
    const restartArgv = await newArgvSince(beforeRestart, (argv) => argv.includes('--resume'))
    check('restart_session restarts the Cursor session with --resume <the same chat id>', !restarted.error && /restarted/.test(restarted.text) && !!restartArgv && trustPrefix(restartArgv) && restartArgv[restartArgv.indexOf('--resume') + 1] === chatId, `${restarted.text.slice(0, 120)} ${JSON.stringify(restartArgv)}`)
    const restartTurn = await tool('send_prompt', { session: NAME, text: 'after restart' })
    const answerRestart = await waitFor(async () => {
      const result = await tool('get_last_answer', { session: NAME })
      return !result.error && /FAKE ANSWER: after restart/.test(result.text) ? result : null
    }, 40000, 700)
    check('the restarted Cursor session answers a prompt', !restartTurn.error && !!answerRestart, restartTurn.text.slice(0, 160))

    // ================= rename, status, group, notes, checklist, keep awake, unread =================
    NAME = 'cursor main'
    const renamed = await tool('rename_session', { session: 'cursor jarvis', name: NAME })
    const renamedRow = await sessionById(id)
    check('rename_session renames the Cursor session', !renamed.error && /Renamed "cursor jarvis" to "cursor main"/.test(renamed.text) && renamedRow?.name === NAME, renamed.text.slice(0, 160))
    const listed2 = await tool('list_sessions')
    const listed2Line = listed2.text.split('\n').find((line) => line.startsWith(`- "${NAME}"`)) ?? ''
    check('list_sessions shows the renamed Cursor session with agent and model', !listed2.error && listed2Line.includes('· cursor ·') && listed2Line.includes('model gpt-5'), listed2Line)

    const statusCreated = await tool('status_change', { action: 'create', name: 'Focus', color: '#123456' })
    const focusId = (await storeData()).statuses.find((status) => status.name === 'Focus')?.id ?? null
    const statusSet = await tool('set_status', { session: NAME, status: 'Focus' })
    check('set_status puts a custom status on the Cursor session', !statusCreated.error && !statusSet.error && /is now "Focus"/.test(statusSet.text) && (await sessionById(id))?.statusId === focusId, statusSet.text.slice(0, 160))

    const groupMade = await tool('create_group', { name: 'Cursor group' })
    const grouped = await tool('move_to_group', { session: NAME, group: 'Cursor group' })
    const groupId = (await storeData()).groups.find((group) => group.name === 'Cursor group')?.id ?? null
    check('create_group and move_to_group work on the Cursor session', !groupMade.error && !grouped.error && /Moved "cursor main" to "Cursor group"/.test(grouped.text) && (await sessionById(id))?.groupId === groupId, grouped.text.slice(0, 160))

    await tool('set_notes', { session: NAME, notes: 'note one' })
    const notesAppended = await tool('set_notes', { session: NAME, notes: 'note two', append: true })
    const notes = (await sessionById(id))?.notes ?? ''
    check('set_notes appends on the Cursor session', !notesAppended.error && notes.includes('note one') && notes.includes('note two') && notes.indexOf('note one') < notes.indexOf('note two'), JSON.stringify(notes))

    const checklistAdd = await tool('checklist_change', { session: NAME, action: 'add', items: ['first step', 'second step'] })
    const checklistCheck = await tool('checklist_change', { session: NAME, action: 'check', item: 1 })
    const checklistGet = await tool('checklist_get', { session: NAME })
    check('checklist_change and checklist_get work on the Cursor session', !checklistAdd.error && !checklistCheck.error && /\(1\/2 done\)/.test(checklistGet.text) && /1\. \[x\] first step/.test(checklistGet.text), checklistGet.text.slice(0, 160))

    const pinned = await tool('set_keep_awake', { session: NAME, keep_awake: true })
    check('set_keep_awake pins the Cursor session awake', !pinned.error && /Keep awake is on/.test(pinned.text) && (await sessionById(id))?.keepAwake === true, pinned.text.slice(0, 160))

    const unread = await tool('set_read', { session: NAME, read: false })
    const needs = await tool('needs_you')
    check('set_read marks the Cursor session unread and needs_you lists it', !unread.error && /marked unread/.test(unread.text) && new RegExp(`"${escapeRe(NAME)}": `).test(needs.text), needs.text.slice(0, 220))
    await tool('set_read', { session: NAME, read: true })

    // ---- auto status after a custom status: Working during the turn, Review after it
    const autoTurn = await tool('send_prompt', { session: NAME, text: 'auto status turn', when: 'now' })
    const autoWork = await waitStatus(id, 'working', 8000)
    check('auto status moves the Cursor session to Working again while a turn runs', !autoTurn.error && autoWork === true, `${autoTurn.text.slice(0, 120)} status=${await statusIdOf(id)}`)
    await tool('wait_for_session', { session: NAME, timeout_seconds: 60 })
    const autoDone = await waitStatus(id, 'review', 10000)
    check('auto status moves it back to Review when the turn stops', autoDone === true, String(await statusIdOf(id)))

    // ================= attach_files =================
    const attachFile = path.join(workDir, 'attach.txt')
    fs.writeFileSync(attachFile, 'attachment\n', 'utf8')
    const attached = await tool('attach_files', { session: NAME, paths: [attachFile] })
    check('attach_files types the file path into the Cursor session', !attached.error && /Attached 1 file\(s\)/.test(attached.text), attached.text.slice(0, 200))
    const attachTurn = await tool('send_prompt', { session: NAME, text: 'attached check' })
    const answerAttach = await waitFor(async () => {
      const result = await tool('get_last_answer', { session: NAME })
      return !result.error && /FAKE ANSWER:[\s\S]*attached check/.test(result.text) ? result : null
    }, 40000, 700)
    check('the attached path is sent with the next prompt and answered', !attachTurn.error && !!answerAttach, answerAttach ? answerAttach.text.slice(0, 200) : attachTurn.text.slice(0, 200))

    // ================= a second Cursor session, broadcast, a shell next to them, bulk =================
    const beforeSecond = argvCount()
    const created2 = await tool('create_session', { folder: workDir, name: 'cursor second', agent: 'cursor' })
    const secondRow = await waitFor(async () => (await storeData()).sessions.find((s) => s.name === 'cursor second') ?? null, 10000, 200)
    secondId = secondRow ? secondRow.id : ''
    const secondArgv = await waitFor(() => argvLines(argvFile)[beforeSecond] ?? null, 20000, 200)
    check('a second fresh Cursor session has --yolo --trust and no --model/--resume', !created2.error && !!secondId && trustPrefix(secondArgv) && !secondArgv.includes('--model') && !secondArgv.includes('--resume'), JSON.stringify(secondArgv))

    const broadcast = await tool('broadcast_prompt', { sessions: [NAME, 'cursor second'], text: 'broadcast hello' })
    check('broadcast_prompt reaches both Cursor sessions', !broadcast.error && /Sent to "cursor main"/.test(broadcast.text) && /Sent to "cursor second"/.test(broadcast.text), broadcast.text.slice(0, 260))
    const broadcastAnswers = await waitFor(async () => {
      const first = await tool('get_last_answer', { session: NAME })
      const other = await tool('get_last_answer', { session: 'cursor second' })
      return /FAKE ANSWER: broadcast hello/.test(first.text) && /FAKE ANSWER: broadcast hello/.test(other.text) ? { first, other } : null
    }, 60000, 800)
    check('both Cursor sessions answer the broadcast', !!broadcastAnswers, broadcastAnswers ? broadcastAnswers.other.text.slice(0, 160) : 'one or both answers missing')

    const shellCreated = await tool('create_session', { folder: workDir, name: 'shell sanity', agent: 'shell' })
    check('a shell session starts next to the Cursor sessions (sanity)', !shellCreated.error && /Created/.test(shellCreated.text), shellCreated.text.slice(0, 200))
    const shellSent = await tool('send_prompt', { session: 'shell sanity', text: 'echo shell-alive' })
    check('send_prompt types into the shell as before', !shellSent.error && /Typed into the shell/.test(shellSent.text), shellSent.text.slice(0, 160))
    const shellScreen = await waitFor(async () => {
      const result = await tool('read_screen', { session: 'shell sanity', lines: 100 })
      return !result.error && /shell-alive/.test(result.text) ? result : null
    }, 30000, 500)
    check('the shell runs the command (it is unaffected)', !!shellScreen, shellScreen ? 'shell-alive on screen' : 'shell-alive not on screen')

    const bulk = await tool('bulk_action', { action: 'keep_awake', value: true, sessions: [NAME, 'cursor second', 'shell sanity'] })
    const bulkRows = [await sessionById(id), await sessionById(secondId)]
    check('bulk_action reaches the Cursor sessions and the shell', !bulk.error && /keep_awake on 3 session\(s\)/.test(bulk.text) && bulkRows.every((entry) => entry?.keepAwake === true), bulk.text.slice(0, 220))

    // ================= fleet_digest, search =================
    const digest = await tool('fleet_digest')
    const mainBlock = digestBlock(digest.text, NAME)
    const secondBlock = digestBlock(digest.text, 'cursor second')
    const shellBlock = digestBlock(digest.text, 'shell sanity')
    check('fleet_digest lists the Cursor sessions with agent, state and last answer', !digest.error && mainBlock.includes('(cursor)') && /running, idle/.test(mainBlock) && /reply:[\s\S]*FAKE ANSWER: broadcast hello/.test(mainBlock) && secondBlock.includes('(cursor)') && shellBlock.includes('(shell)'), mainBlock || digest.text.slice(0, 240))
    check('fleet_digest still shows the shell session next to them', shellBlock.includes('shell sanity') && shellBlock.includes('(shell)'), shellBlock)

    const searchConversations = await tool('search_conversations', { query: 'FAKE ANSWER' })
    check('search_conversations answers without an error (Cursor replies live in memory, so it finds 0)', !searchConversations.error && /0 match\(es\)/.test(searchConversations.text), searchConversations.text.slice(0, 200))

    // ================= set_session_model =================
    const modelBefore = argvCount()
    const modelSet = await tool('set_session_model', { session: NAME, model: 'sonnet-4-thinking' })
    const modelStored = (await sessionById(id))?.model
    check('set_session_model accepts a plain Cursor model', !modelSet.error && modelStored === 'sonnet-4-thinking', `${modelSet.text.slice(0, 160)} / store=${String(modelStored)}`)
    const modelArgv = await newArgvSince(modelBefore, (argv) => argv.includes('--model') && argv.includes('sonnet-4-thinking'), 40000)
    check('the running Cursor session is restarted on the new model', !!modelArgv, modelArgv ? JSON.stringify(modelArgv) : 'no new process with --model sonnet-4-thinking')
    check('the restarted argv has --model sonnet-4-thinking before --resume <the same id>', !!modelArgv && trustPrefix(modelArgv) && modelArgv.indexOf('--model') < modelArgv.indexOf('--resume') && modelArgv[modelArgv.indexOf('--resume') + 1] === chatId, JSON.stringify(modelArgv))
    const modelTurn = await tool('send_prompt', { session: NAME, text: 'model turn' })
    const modelAnswer = await waitFor(async () => {
      const result = await tool('get_last_answer', { session: NAME })
      return !result.error && /FAKE ANSWER: model turn/.test(result.text) ? result : null
    }, 50000, 700)
    check('the session still answers after the model switch', !modelTurn.error && !!modelAnswer, modelTurn.text.slice(0, 160))
    const afterModelRow = await sessionById(id)
    check('the model switch keeps the session id and cursorChatId', afterModelRow?.id === id && afterModelRow?.cursorChatId === chatId, `${afterModelRow?.id === id} / ${afterModelRow?.cursorChatId === chatId}`)

    const flagModel = await tool('set_session_model', { session: NAME, model: '--evil' })
    check('set_session_model refuses a flag-like model', flagModel.error && /flag|not a Cursor model|not a model/i.test(flagModel.text), flagModel.text.slice(0, 200))
    const spaceModel = await tool('set_session_model', { session: NAME, model: 'a b' })
    check('set_session_model refuses a model with a space', spaceModel.error && /not a Cursor model|not a model[^.]*letters|allowed/i.test(spaceModel.text), spaceModel.text.slice(0, 200))

    const cleared = await tool('set_session_model', { session: NAME, model: '' })
    check('set_session_model with an empty model clears the Cursor model', !cleared.error && (await sessionById(id))?.model === undefined, `${cleared.text.slice(0, 160)} / store=${String((await sessionById(id))?.model)}`)
    const beforeClearRestart = argvCount()
    const clearRestart = await tool('restart_session', { session: NAME })
    const clearedArgv = await newArgvSince(beforeClearRestart, () => true, 40000)
    check('the next argv has no --model (and still resumes the same chat)', !clearRestart.error && !!clearedArgv && trustPrefix(clearedArgv) && !clearedArgv.includes('--model') && clearedArgv[clearedArgv.indexOf('--resume') + 1] === chatId, JSON.stringify(clearedArgv))

    const shellRefused = await tool('set_session_model', { session: 'shell sanity', model: 'sonnet-4-thinking' })
    check('set_session_model refuses a shell session with the right text', shellRefused.error && /shell session/.test(shellRefused.text) && /no model/.test(shellRefused.text), shellRefused.text.slice(0, 200))
    const claudeCreated = await tool('create_session', { folder: workDir, name: 'claude sanity', agent: 'claude' })
    if (claudeCreated.error) {
      skip(`set_session_model on a Claude session (the fake Claude session could not be created: ${claudeCreated.text.slice(0, 120)})`)
    } else {
      const claudeRefused = await tool('set_session_model', { session: 'claude sanity', model: 'sonnet-4-thinking' })
      check('set_session_model refuses a Claude session with the right text', claudeRefused.error && /Claude session/.test(claudeRefused.text) && /launch setting/.test(claudeRefused.text), claudeRefused.text.slice(0, 220))
    }

    const forked = await tool('fork_session', { session: NAME })
    check('fork_session refuses a Cursor session with the clear error', forked.error && /Forking a Cursor session is not supported yet/.test(forked.text), forked.text.slice(0, 240))

    // ================= a two-step plan: Cursor session -> second Cursor session with {{answer}} =================
    const plansOn = await tool('update_settings', { changes: { jarvis: { plansEnabled: true } } })
    check('task plans can be switched on', !plansOn.error, plansOn.text.slice(0, 160))
    const plan = await tool('plan_create', {
      goal: 'two cursor sessions in order',
      steps: [
        { id: 'a', title: 'first cursor step', prompt: 'plan step one', session: NAME },
        { id: 'b', title: 'second cursor step', prompt: 'plan step two gets {{a}}', session: 'cursor second', depends_on: ['a'] }
      ]
    })
    const planId = (plan.text.match(/^Plan ([0-9a-f]{8}):/m) || [])[1]
    check('plan_create starts two steps on the Cursor sessions', !plan.error && !!planId && /: running/.test(plan.text.split('\n')[0]), plan.text.split('\n')[0] ?? plan.text.slice(0, 200))
    const planEnd = planId === undefined ? null : await waitFor(async () => {
      const status = await tool('plan_status', { id: planId })
      return /^Plan \w+: (done|failed)\b/.test(status.text) ? status : null
    }, 180000, 700)
    const stepA = planEnd ? planStepAnswer(planEnd.text, 'a') : ''
    const stepB = planEnd ? planStepAnswer(planEnd.text, 'b') : ''
    check('the two-step Cursor plan finishes done', planEnd !== null && /^Plan \w+: done\b/.test(planEnd.text), planEnd ? planEnd.text.split('\n').slice(0, 3).join(' | ').slice(0, 320) : 'plan did not finish')
    check('the first Cursor step has its FAKE ANSWER', /FAKE ANSWER: plan step one/.test(stepA), stepA.slice(0, 200))
    check('the second Cursor step ran after it and used {{a}}', /FAKE ANSWER: plan step two gets FAKE ANSWER: plan step one/.test(stepB), stepB.slice(0, 240))

    // ================= tools this e2e cannot reach =================
    skip('interrupt: there is no tool named interrupt (press_keys ctrl+c is the interrupt path and press_keys was checked above)')
    skip('Jarvis watch mode on Cursor: it needs an open Jarvis agent plus its watch tick (watchEveryMinutes >= 1, ~60 s) and a Cursor "waiting" bell the fake CLI does not emit; scripts/e2e-jarvis-watch.cjs covers the watch loop, and fleet_digest above reads the same collectWatchRows data for the Cursor session')
    skip('schedule_add/schedule_list/schedule_remove: they schedule instructions for Jarvis, not actions on a session; there is nothing session-specific to prove here')
    skip('remove_session: it asks the user to confirm in the window, which an unattended e2e cannot answer; close_session (checked) is the non-destructive path')
  } catch (error) {
    check('e2e ran without an exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    for (const running of apps) {
      try {
        running.kill()
      } catch {
        // already gone
      }
    }
    await sleep(1000)
    if (originalCursorConfigDir === undefined) delete process.env.SESSIONDECK_CURSOR_CONFIG_DIR
    else process.env.SESSIONDECK_CURSOR_CONFIG_DIR = originalCursorConfigDir
    process.env.PATH = originalPath
    const realHomeAfter = (() => {
      try {
        const stat = fs.statSync(REAL_CURSOR_HOOKS)
        return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size }
      } catch {
        return { exists: false }
      }
    })()
    const untouched = realHomeBefore.exists === realHomeAfter.exists && (!realHomeBefore.exists || (realHomeBefore.mtimeMs === realHomeAfter.mtimeMs && realHomeBefore.size === realHomeAfter.size))
    check('the real ~/.cursor/hooks.json was not created or modified', untouched, `${JSON.stringify(realHomeBefore)} -> ${JSON.stringify(realHomeAfter)}`)
    try { fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
    process.exit(t.summary() === 0 ? 0 : 1)
  }
}

main()
