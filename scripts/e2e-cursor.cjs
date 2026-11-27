// E2E (D81): the Cursor agent (agent: 'cursor') in the real built app, without a real Cursor install.
// A fake `cursor-agent` (a .cmd shim, first on PATH) imitates Cursor: it logs its argv, reads the app's hooks.json,
// and for every prompt line on stdin runs the hook commands Cursor would run (beforeSubmitPrompt, afterAgentResponse,
// stop). So the app's real hook bridge, store, controller, Jarvis tools and the sidebar badge are all exercised.
// The run uses a temp userData and a temp SESSIONDECK_CURSOR_CONFIG_DIR; the real ~/.cursor is checked untouched.
// Checks: startup on an empty store; create_session agent cursor model gpt-5 -> argv; hooks.json contents and merge with
// a foreign hook/key (no duplicates on a second session); prompt -> working -> finished; get_last_answer; cursorChatId
// stored; sleep/wake resumes with --resume <id>; hooks still flow after resume; fork refused; a task plan step in the
// Cursor session; a clear "Cursor CLI not found" without the CLI; a real-CLI smoke when one is installed.
// Run: npx electron-vite build && node scripts/e2e-cursor.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9515
const HARNESS = path.join(ROOT, 'out', 'main', 'index.js')
const REAL_CURSOR_HOOKS = path.join(os.homedir(), '.cursor', 'hooks.json')

// The fake Cursor CLI. It lives next to its fake-argv.log in <temp>/ (the shim dir is <temp>/shim), reads the config
// dir from the environment like Cursor would, and keeps one conversation id per process (the --resume id, or a new one).
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

function writeFakeAgent(shimDir) {
  fs.mkdirSync(shimDir, { recursive: true })
  fs.writeFileSync(path.join(shimDir, 'fake-cursor.cjs'), FAKE_AGENT_SOURCE, 'utf8')
  fs.writeFileSync(path.join(shimDir, 'cursor-agent.cmd'), '@node "%~dp0fake-cursor.cjs" %*\r\n', 'utf8')
}

function fileState(file) {
  try {
    const stat = fs.statSync(file)
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return { exists: false }
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function ownHooks(root, event) {
  const list = root && root.hooks && Array.isArray(root.hooks[event]) ? root.hooks[event] : []
  return list.filter((entry) => entry && typeof entry.command === 'string' && entry.command.includes('sessiondeck-cursor-hook'))
}

function allHooks(root, event) {
  return root && root.hooks && Array.isArray(root.hooks[event]) ? root.hooks[event] : []
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-cursor-'))
  const userData = path.join(rootDir, 'userdata')
  const userData2 = path.join(rootDir, 'userdata-missing')
  const userData3 = path.join(rootDir, 'userdata-real')
  const workDir = path.join(rootDir, 'work')
  const shimDir = path.join(rootDir, 'shim')
  const cursorHome = path.join(rootDir, 'cursor-home')
  const cursorHome2 = path.join(rootDir, 'cursor-home-missing')
  const cursorHome3 = path.join(rootDir, 'cursor-home-real')
  const hooksFile = path.join(cursorHome, 'hooks.json')
  const argvFile = path.join(rootDir, 'fake-argv.log')
  const storeFile = path.join(userData, 'sessiondeck-store.json')
  for (const dir of [userData, userData2, userData3, workDir]) fs.mkdirSync(dir, { recursive: true })

  const originalPath = process.env.PATH ?? ''
  const originalCursorConfigDir = process.env.SESSIONDECK_CURSOR_CONFIG_DIR
  const nodeDir = path.dirname(process.execPath)
  const restrictedPath = [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), nodeDir].join(path.delimiter)
  const realHomeBefore = fileState(REAL_CURSOR_HOOKS)
  const apps = []
  let realInstall = null

  try {
    // ---- preseed the Cursor config dir BEFORE anything launches: a foreign hook and a foreign top-level key.
    fs.mkdirSync(cursorHome, { recursive: true })
    const preseed = {
      version: 1,
      foreignKey: { keep: true },
      hooks: { stop: [{ command: 'echo foreign', timeout: 10 }] }
    }
    fs.writeFileSync(hooksFile, JSON.stringify(preseed, null, 2), 'utf8')
    writeFakeAgent(shimDir)
    process.env.PATH = shimDir + path.delimiter + originalPath
    process.env.SESSIONDECK_CURSOR_CONFIG_DIR = cursorHome

    // ---- 1. the app starts on an empty (old) user-data dir and loads settings and tools
    const app = await launchApp({ port: PORT, userData })
    apps.push(app)
    await sleep(1500)
    const { tool, toolNames } = await connect(app, userData)
    const names = await toolNames()
    t.check('1: the built app starts and serves its Jarvis tools', names.length >= 90 && names.includes('create_session'), `${names.length} tools`)
    const settings0 = await tool('get_settings')
    t.check('1b: settings load from the empty store (plans still off)', !settings0.error && /"plansEnabled":\s*false/.test(settings0.text), settings0.text.slice(0, 200))

    // ---- 2. create a Cursor session through Jarvis: agent cursor, model gpt-5
    const created = await tool('create_session', { folder: workDir, name: 'cursor e2e', agent: 'cursor', model: 'gpt-5' })
    t.check('2: create_session starts a Cursor session with model gpt-5', !created.error && /Created/.test(created.text) && /cursor/.test(created.text), created.text.slice(0, 240))
    const listed = await tool('list_sessions')
    t.check('2b: list_sessions shows it with agent cursor and the model', /"cursor e2e"[^\n]*· cursor ·/.test(listed.text) && /"cursor e2e"[^\n]*model gpt-5/.test(listed.text), listed.text.split('\n').find((line) => line.includes('cursor e2e')) ?? listed.text.slice(0, 240))
    const badge = await waitFor(() => app.evaluate(`(() => {
      const card = [...document.querySelectorAll('[role=treeitem]')].find((node) => node.innerText.includes('cursor e2e'))
      if (!card) return null
      const pill = card.querySelector('[aria-label="Cursor"]')
      return pill ? pill.innerText.trim() : null
    })()`), 15000, 300)
    t.check('2c: the sidebar card shows the CU badge for the Cursor agent', badge === 'CU', String(badge))

    // ---- 3. the fake got the exact Cursor launch line: yolo by default, the model, no resume for a new chat
    const firstArgv = await waitFor(() => {
      const lines = argvLines(argvFile)
      return lines.length > 0 ? lines[0] : null
    }, 20000, 200)
    t.check('3: the fake agent got --yolo --model gpt-5 and no --resume', !!firstArgv && firstArgv.includes('--yolo') && firstArgv.includes('--model') && firstArgv.includes('gpt-5') && !firstArgv.includes('--resume'), JSON.stringify(firstArgv))

    // ---- 4. hooks.json: version 1, one SessionDeck command per event, and the foreign content is intact
    const hooks1 = readJson(hooksFile)
    const events = ['beforeSubmitPrompt', 'afterAgentResponse', 'stop']
    const oneEach = hooks1 !== null && hooks1.version === 1 && events.every((event) => ownHooks(hooks1, event).length === 1)
    const commandsNamed = hooks1 !== null && events.every((event) => ownHooks(hooks1, event)[0].command.trim().endsWith(event))
    t.check('4: hooks.json is valid JSON, version 1, one SessionDeck command per event', oneEach && commandsNamed, hooks1 === null ? 'invalid JSON' : JSON.stringify(hooks1.hooks).slice(0, 300))
    t.check('4b: the foreign stop hook and the foreign top-level key survived the merge', hooks1 !== null && hooks1.foreignKey?.keep === true && allHooks(hooks1, 'stop').some((entry) => entry.command === 'echo foreign'), hooks1 === null ? 'invalid JSON' : JSON.stringify({ foreignKey: hooks1.foreignKey, stop: hooks1.hooks.stop }).slice(0, 300))

    // ---- 5. a SECOND Cursor session must not duplicate SessionDeck's entries
    const created2 = await tool('create_session', { folder: workDir, name: 'cursor e2e 2', agent: 'cursor' })
    t.check('5: a second Cursor session starts', !created2.error, created2.text.slice(0, 200))
    await sleep(500)
    const hooks2 = readJson(hooksFile)
    const stillOne = hooks2 !== null && events.every((event) => ownHooks(hooks2, event).length === 1)
    const stillForeign = hooks2 !== null && hooks2.foreignKey?.keep === true && allHooks(hooks2, 'stop').filter((entry) => entry.command === 'echo foreign').length === 1
    t.check('5b: after the second session each event still has exactly one SessionDeck entry', stillOne && stillForeign, hooks2 === null ? 'invalid JSON' : JSON.stringify(hooks2.hooks).slice(0, 300))

    const stored = await app.evaluate('window.api.getStore()')
    const cursorSession = stored.data.sessions.find((session) => session.name === 'cursor e2e')
    t.check('5c: the store holds the Cursor session', !!cursorSession && cursorSession.agent === 'cursor' && cursorSession.model === 'gpt-5', JSON.stringify(cursorSession && { agent: cursorSession.agent, model: cursorSession.model }))
    const id = cursorSession.id
    const runtimeOf = async () => (await app.evaluate('window.api.getStore()')).runtime.find((entry) => entry.sessionId === id)

    // ---- 6. a prompt: working (beforeSubmitPrompt) -> finished (stop)
    const sawWorking = waitFor(async () => {
      const runtime = await runtimeOf()
      return runtime?.activity === 'working' ? true : null
    }, 30000, 100)
    const sent = await tool('send_prompt', { session: 'cursor e2e', text: 'hello cursor' })
    t.check('6: send_prompt is accepted by the Cursor session', !sent.error, sent.text.slice(0, 200))
    const waited = await tool('wait_for_session', { session: 'cursor e2e', timeout_seconds: 60 })
    const workingSeen = await sawWorking
    t.check('6b: the activity went working (the beforeSubmitPrompt hook reached the app)', workingSeen === true)
    const finishedRuntime = await waitFor(async () => {
      const runtime = await runtimeOf()
      return runtime?.activity === 'finished' ? runtime : null
    }, 30000, 200)
    t.check('6c: wait_for_session returned and the activity is finished (the stop hook)', !waited.error && !/still working/.test(waited.text) && !!finishedRuntime, waited.text.slice(0, 200))

    // ---- 7. the reply came through the afterAgentResponse hook
    const answer1 = await tool('get_last_answer', { session: 'cursor e2e' })
    t.check('7: get_last_answer returns the fake reply', !answer1.error && /FAKE ANSWER: hello cursor/.test(answer1.text), answer1.text.slice(0, 200))

    // ---- 8. the fake's conversation id (printed on its screen) is stored as cursorChatId
    const screen1 = await tool('read_screen', { session: 'cursor e2e', lines: 300 })
    const fakeChatId = (screen1.text.match(/fake-cursor chat ([0-9a-fA-F-]{8,80})/) || [])[1]
    const storedChatId = await waitFor(() => {
      const data = readJson(storeFile)
      const row = data && data.sessions.find((session) => session.id === id)
      return row && row.cursorChatId ? row.cursorChatId : null
    }, 15000, 300)
    t.check('8: the store keeps cursorChatId, equal to the fake conversation id', !!fakeChatId && storedChatId === fakeChatId, `fake=${fakeChatId ?? '?'} stored=${storedChatId ?? '?'}`)

    // ---- 9. sleep then wake: the new process resumes the same chat (--resume <id>)
    const linesBeforeSleep = argvLines(argvFile).length
    const slept = await tool('sleep_session', { session: 'cursor e2e' })
    const sleeping = await waitFor(async () => ((await runtimeOf())?.sleeping === true ? true : null), 15000, 200)
    t.check('9: sleep_session stops the Cursor process', !slept.error && sleeping === true, slept.text.slice(0, 160))
    const woke = await tool('wake_session', { session: 'cursor e2e' })
    const upAgain = await waitFor(async () => {
      const runtime = await runtimeOf()
      return runtime?.run === 'running' && runtime?.sleeping !== true ? true : null
    }, 40000, 300)
    const resumeArgv = await waitFor(() => {
      const lines = argvLines(argvFile)
      if (lines.length <= linesBeforeSleep) return null
      return lines.slice(linesBeforeSleep).find((line) => line.includes('--resume')) ?? null
    }, 20000, 200)
    t.check('9b: wake_session starts it again', !woke.error && upAgain === true, woke.text.slice(0, 160))
    t.check('9c: the resumed process got --resume <the stored chat id>', !!resumeArgv && !!storedChatId && resumeArgv[resumeArgv.indexOf('--resume') + 1] === storedChatId, JSON.stringify(resumeArgv))

    // ---- 10. hooks still flow after the resume: another prompt answers
    const sent2 = await tool('send_prompt', { session: 'cursor e2e', text: 'after resume' })
    const waited2 = await tool('wait_for_session', { session: 'cursor e2e', timeout_seconds: 60 })
    await waitFor(async () => ((await runtimeOf())?.activity === 'finished' ? true : null), 30000, 200)
    const answer2 = await tool('get_last_answer', { session: 'cursor e2e' })
    t.check('10: a prompt after the resume gets a new FAKE ANSWER', !sent2.error && !waited2.error && /FAKE ANSWER: after resume/.test(answer2.text), answer2.text.slice(0, 200))

    // ---- 11. fork is refused with the clear message (Jarvis exposes fork_session)
    const beforeFork = (await app.evaluate('window.api.getStore()')).data.sessions.length
    const forked = await tool('fork_session', { session: 'cursor e2e' })
    const afterFork = (await app.evaluate('window.api.getStore()')).data.sessions.length
    t.check('11: fork_session refuses a Cursor session with the clear error', forked.error && /Forking a Cursor session is not supported yet/.test(forked.text), forked.text.slice(0, 240))
    t.check('11b: the refused fork added no session', afterFork === beforeFork, `${beforeFork} -> ${afterFork}`)

    // ---- 12. a task plan with one step in this existing Cursor session runs and keeps the fake answer
    const plansOn = await tool('update_settings', { changes: { jarvis: { plansEnabled: true } } })
    t.check('12: task plans can be switched on', !plansOn.error, plansOn.text.slice(0, 160))
    const plan = await tool('plan_create', {
      goal: 'cursor e2e plan',
      steps: [{ id: 'a', title: 'ask the cursor session', prompt: 'hello from a plan', session: 'cursor e2e' }]
    })
    const planId = (plan.text.match(/^Plan ([0-9a-f]{8}):/m) || [])[1]
    t.check('12b: plan_create starts a plan on the existing Cursor session', !plan.error && !!planId && /: running/.test(plan.text.split('\n')[0]), plan.text.split('\n')[0] ?? plan.text.slice(0, 200))
    const planEnd = planId === undefined ? null : await waitFor(async () => {
      const status = await tool('plan_status', { id: planId })
      return /^Plan \w+: (done|failed)\b/.test(status.text) ? status : null
    }, 120000, 700)
    const stepAnswer = planEnd ? planStepAnswer(planEnd.text, 'a') : ''
    t.check('12c: the step ends done with an answer containing FAKE ANSWER', planEnd !== null && /^Plan \w+: done\b/.test(planEnd.text) && /FAKE ANSWER/.test(stepAnswer), planEnd ? planEnd.text.split('\n').slice(0, 5).join(' | ').slice(0, 300) : (await tool('plan_status', { id: planId })).text.slice(0, 240))

    // ---- 13. without the CLI on PATH, creating a Cursor session fails clearly and the app survives
    app.kill()
    await sleep(1500)
    const onRestrictedPath = (name) => {
      try {
        execFileSync('where', [name], { env: { ...process.env, PATH: restrictedPath }, stdio: 'ignore', timeout: 5000 })
        return true
      } catch {
        return false
      }
    }
    const whereFound = onRestrictedPath('cursor-agent') || onRestrictedPath('agent')
    t.check('13: the restricted PATH really has no cursor-agent and no agent', whereFound === false && !restrictedPath.toLowerCase().includes(shimDir.toLowerCase()), restrictedPath)

    process.env.PATH = restrictedPath
    process.env.SESSIONDECK_CURSOR_CONFIG_DIR = cursorHome2
    const app2 = await launchApp({ port: PORT + 1, userData: userData2 })
    apps.push(app2)
    await sleep(1500)
    const { tool: tool2 } = await connect(app2, userData2)
    const missing = await tool2('create_session', { folder: workDir, name: 'cursor missing', agent: 'cursor' })
    t.check('13b: creating a Cursor session without the CLI says "Cursor CLI not found"', missing.error && /Cursor CLI not found/.test(missing.text), missing.text.slice(0, 240))
    const aliveCount = await app2.evaluate('window.api.getStore().then((store) => store.data.sessions.length)')
    const afterList = await tool2('list_sessions')
    t.check('13c: the app is still alive and has no half-created session', aliveCount === 0 && !afterList.error && !/cursor missing/.test(afterList.text), `sessions=${String(aliveCount)}`)

    // ---- 14. real CLI smoke, only when the real cursor-agent is installed under %LOCALAPPDATA%\cursor-agent
    try {
      const whereOut = execFileSync('where', ['cursor-agent'], { env: { ...process.env, PATH: originalPath }, encoding: 'utf8', timeout: 5000 })
      const first = whereOut.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
      const localAppData = process.env.LOCALAPPDATA
      if (first && localAppData && first.toLowerCase().startsWith(path.join(localAppData, 'cursor-agent').toLowerCase())) realInstall = first
    } catch {
      realInstall = null
    }
    if (realInstall === null) {
      console.log(`SKIP 14: cursor-agent is not installed under %LOCALAPPDATA%\\cursor-agent (where cursor-agent found nothing), so the real-CLI smoke cannot run`)
    } else {
      app2.kill()
      await sleep(1500)
      process.env.PATH = originalPath
      process.env.SESSIONDECK_CURSOR_CONFIG_DIR = cursorHome3
      const app3 = await launchApp({ port: PORT + 2, userData: userData3 })
      apps.push(app3)
      await sleep(1500)
      const { tool: tool3 } = await connect(app3, userData3)
      const realCreated = await tool3('create_session', { folder: workDir, name: 'cursor real', agent: 'cursor', open: true })
      t.check('14: a real cursor-agent session starts without a model', !realCreated.error, realCreated.text.slice(0, 240))
      await sleep(8000)
      const screen = await tool3('read_screen', { session: 'cursor real', lines: 300 })
      const badFlag = /unknown option|error: unknown/i.test(screen.text)
      t.check('14b: the real CLI did not reject the flags and the screen is not empty', !badFlag && !/nothing on screen yet/.test(screen.text) && screen.text.length > 120, `badFlag=${String(badFlag)} len=${screen.text.length}`)
      const closed = await tool3('close_session', { session: 'cursor real' })
      t.check('14c: the real session can be closed', !closed.error, closed.text.slice(0, 160))
    }
  } catch (error) {
    t.check('e2e ran without an exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    for (const app of apps) {
      try {
        app.kill()
      } catch {
        // already gone
      }
    }
    await sleep(1000)
    if (originalCursorConfigDir === undefined) delete process.env.SESSIONDECK_CURSOR_CONFIG_DIR
    else process.env.SESSIONDECK_CURSOR_CONFIG_DIR = originalCursorConfigDir
    process.env.PATH = originalPath
    const realHomeAfter = fileState(REAL_CURSOR_HOOKS)
    const untouched = realHomeBefore.exists === realHomeAfter.exists && (!realHomeBefore.exists || (realHomeBefore.mtimeMs === realHomeAfter.mtimeMs && realHomeBefore.size === realHomeAfter.size))
    t.check('15: the real ~/.cursor/hooks.json was not created or modified', untouched, `${JSON.stringify(realHomeBefore)} -> ${JSON.stringify(realHomeAfter)}`)
    try { fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
    process.exit(t.summary() === 0 ? 0 : 1)
  }
}

main()
