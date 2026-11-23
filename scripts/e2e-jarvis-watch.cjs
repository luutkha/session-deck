// E2E (D80): Jarvis watch mode in the real app. A bell (a session that needs the user) is raised through the hook
// server exactly like Claude Code does. With watch OFF nothing happens; turned ON, the timer gives Jarvis ONE
// "[Watch]" message per episode (see formatWatchMessage in src/main/jarvis/watchService.ts), the same episode is never
// repeated, a NEW episode is reported, and turning watch OFF stops the checks. Jarvis runs on OpenCode with a cheap
// paid model, so no Claude quota is used.
// The watch limits are shortened with the test seam (SESSIONDECK_WATCH_WAITING_MS / SESSIONDECK_WATCH_STUCK_MS), which
// the app reads from the environment launchApp inherits. The Settings change is noticed by a 30 s sync; switching watch
// on checks at once and then every watchEveryMinutes (1 = 60 s). A passive timer never creates or replaces Jarvis
// (canDeliver in jarvisWiring.ts), so the script opens Jarvis first, as the Jarvis panel does.
// The message Jarvis received is read from its OpenCode conversation (`opencode session export`, exact text, the same
// way the app reads it), with the Jarvis terminal screen (window.api.ptyReplay) as a fallback.
// Run: node scripts/e2e-jarvis-watch.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, strip, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const PORT = 9509
// A cheap paid model: a Jarvis session starts without Claude and answers a short message for a fraction of a cent.
const MODEL = process.env.OC_E2E_MODEL || 'opencode-go/deepseek-v4.1-flash'
/** How long a bell has to sit there before watch reports it (the app default is 3 min; the seam keeps the run short). */
const WAITING_MS = 8000
/** The one line every watch message ends with (WATCH_INSTRUCTION in watchService.ts). */
const INSTRUCTION = 'Look at each one. Answer a waiting question or approve a permission ONLY when the answer is obvious'
const everyMinute = 60_000

/** The text with runs of whitespace collapsed: the TUI wraps lines, the conversation JSON does not. */
const norm = (text) => text.replace(/\s+/g, ' ')

/** Parses JSON, tolerating the log lines `opencode` sometimes prints before the object. */
function jsonOf(text) {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-watch-'))
  const userData = path.join(root, 'userdata')
  const work = path.join(root, 'work')
  const endpointFile = path.join(root, 'endpoint.json')
  fs.mkdirSync(userData)
  fs.mkdirSync(work)
  // Before the app launches: launchApp passes process.env to Electron, which reads the seam and the hook endpoint file.
  process.env.SESSIONDECK_WATCH_WAITING_MS = String(WAITING_MS)
  process.env.SESSIONDECK_WATCH_STUCK_MS = String(WAITING_MS)
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  const logFile = path.join(userData, 'jarvis', 'actions.log')
  const created = new Set()
  let app
  try {
    stopOpencodeService()
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => ev('window.api.getStore()')
    const sessions = async () => (await store()).data.sessions
    const sessionOf = async (id) => (await sessions()).find((s) => s.id === id)
    const runtimeOf = async (id) => (await store()).runtime.find((r) => r.sessionId === id)
    const attentionOf = async (id) => (await runtimeOf(id))?.attention ?? null
    const settingsOf = async () => (await ev('window.api.updateSettings({})')).jarvis

    // ---- the hook server (bells) and the action log (jarvisPaths().log = <userData>/jarvis/actions.log)
    await waitFor(() => (fs.existsSync(endpointFile) ? true : null), 15000, 200)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const postHook = async (id, event) => (await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, {
      method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}'
    })).status
    const watchLines = () => {
      let text = ''
      try {
        text = fs.readFileSync(logFile, 'utf8')
      } catch {
        return []
      }
      return text.split('\n').filter((line) => line.length > 0).map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      }).filter((entry) => entry !== null && entry.tool === 'jarvis watch')
    }
    const describeLines = (lines) => lines.map((l) => `${l.at} ${l.detail}`).join(' | ') || 'none'

    // ---- what Jarvis received: its OpenCode conversation (exact text), the screen as a fallback
    const screenText = async (id) => strip(String((await ev(`window.api.ptyReplay(${js(id)})`)).data))
    // What Jarvis was given: the OpenCode conversation (exact text of what was typed) plus the prompts still in its
    // SessionDeck queue (a watch message sent while Jarvis is working a turn is queued and typed when it finishes).
    const chat = async () => {
      const jarvis = (await sessions()).find((s) => s.role === 'jarvis')
      if (!jarvis) return null
      const ocId = (await sessionOf(jarvis.id))?.opencodeSessionId
      const texts = []
      const sources = []
      if (typeof ocId === 'string' && /^ses_[A-Za-z0-9]+$/.test(ocId)) {
        try {
          // Read-only, exactly what get_last_answer does for an OpenCode session (src/main/transcripts/opencodeTranscript.ts).
          const out = execFileSync('opencode', ['session', 'export', ocId], { encoding: 'utf8', timeout: 30000, shell: true, maxBuffer: 64 * 1024 * 1024 })
          const json = jsonOf(out)
          if (json && Array.isArray(json.messages)) {
            texts.push(...json.messages.filter((m) => m !== null && typeof m === 'object' && m.type === 'user' && typeof m.text === 'string').map((m) => m.text))
            sources.push('opencode session export')
          }
        } catch {
          // No conversation yet: the queue or the screen below still says what it got.
        }
      }
      const queued = (jarvis.queue ?? []).map((item) => item.text).filter((text) => typeof text === 'string')
      if (queued.length > 0) {
        texts.push(...queued)
        sources.push('store queue')
      }
      if (sources.length === 0) {
        const screen = await screenText(jarvis.id)
        if (screen.length === 0) return null
        return { source: 'pty screen', id: jarvis.id, texts: [screen], text: screen, watchCount: (screen.match(/\[Watch\]/g) || []).length }
      }
      const unique = [...new Set(texts)]
      return { source: sources.join(' + '), id: jarvis.id, texts: unique, text: unique.join('\n'), watchCount: unique.filter((x) => x.trim().startsWith('[Watch]')).length }
    }
    const watchMessageOf = (c) => c ? (c.texts.find((x) => x.trim().startsWith('[Watch]')) ?? '') : ''
    const waitAttention = async (id, raised) => waitFor(async () => ((await attentionOf(id)) !== null) === raised ? true : null, 8000, 250)

    // ---- setup: Jarvis on OpenCode with a cheap paid model, so a watch message can start a Jarvis session without Claude
    const jarvisSettings = await ev(`window.api.updateSettings({ jarvis: { agent: 'opencode', opencodeModel: ${js(MODEL)} } }).then((s) => s.jarvis)`)
    t.check('0. (setup) Settings: Jarvis on OpenCode with a cheap paid model', jarvisSettings.agent === 'opencode' && jarvisSettings.opencodeModel === MODEL, js(jarvisSettings))
    const defaults = await settingsOf()
    t.check('0. (setup) watch mode is OFF by default (every 10 min)', defaults.watchEnabled === false, js(defaults))

    const shellSession = async (name) => {
      const made = await ev(`window.api.createSession({ cwd: ${js(work)}, name: ${js(name)}, agent: 'shell' })`)
      // The pty must be up before the Stop hook: `stateSince` only uses attentionAt while the session is running.
      await waitFor(async () => ((await runtimeOf(made.id))?.run === 'running' ? true : null), 30000, 300)
      return made.id
    }
    const ids = { A: await shellSession('watch A') }

    // ================= 1. watch OFF: a bell older than the limit reports nothing =================
    const hookStatus = await postHook(ids.A, 'Notification')
    const bellAt = Date.now()
    const raised = await waitAttention(ids.A, true)
    await sleep(Math.max(0, bellAt + WAITING_MS + 20_000 - Date.now()))
    const offLines = watchLines()
    t.check('1. watch OFF: a session waiting 20 s past the limit writes no "jarvis watch" line', offLines.length === 0, `${describeLines(offLines)} / hook ${hookStatus}, bell raised ${raised === true}`)
    t.check('1. ...and no Jarvis session was created', (await sessions()).filter((s) => s.role === 'jarvis').length === 0,
      `${(await sessions()).filter((s) => s.role === 'jarvis').length} jarvis session(s)`)

    // ================= 2. watch ON: the check tells the open Jarvis =================
    // A passive timer must not create or replace Jarvis (canDeliver): open it first, as the Jarvis panel does.
    const opened = await ev('window.api.openJarvis()')
    t.check('2. (setup) Jarvis is open on OpenCode with the cheap model before watch runs',
      opened.role === 'jarvis' && opened.agent === 'opencode' && opened.model === MODEL, js({ agent: opened.agent, model: opened.model }))
    const on = await ev(`window.api.updateSettings({ jarvis: { watchEnabled: true, watchEveryMinutes: 1 } }).then((s) => s.jarvis)`)
    t.check('2. (setup) watch is ON, every 1 min', on.watchEnabled === true && on.watchEveryMinutes === 1, js(on))
    // Up to 30 s until the settings sync installs the timer (which checks at once), then Jarvis has to take the prompt.
    const firstLines = await waitFor(() => (watchLines().length >= 1 ? watchLines() : null), 150_000, 2000)
    t.check('2. within ~3 min a "jarvis watch" line appears in the action log', !!firstLines, describeLines(watchLines()))
    const jarvis = await waitFor(async () => (await sessions()).find((s) => s.role === 'jarvis') ?? null, 30_000, 500)
    t.check('2. ...and a Jarvis session exists (role jarvis, agent opencode)', !!jarvis && jarvis.agent === 'opencode', jarvis ? `agent ${jarvis.agent}, model ${jarvis.model}` : 'none')

    // ================= 3. what Jarvis received =================
    const firstChat = await waitFor(async () => {
      const c = await chat()
      return c && c.watchCount >= 1 ? c : null
    }, 60_000, 2500)
    const firstText = norm(watchMessageOf(firstChat))
    t.check('3. the message Jarvis received is a [Watch] message naming "watch A"',
      !!firstChat && firstText.includes('[Watch]') && /- "watch A" — waiting for you/.test(firstText),
      firstChat ? `${firstChat.source}; ${firstText.slice(0, 200)}` : 'no [Watch] text in the Jarvis conversation yet')
    t.check('3. ...and it carries the instruction line (formatWatchMessage)', firstText.includes(INSTRUCTION), firstText.slice(-220))

    // ================= 4. the same episode is not reported again =================
    // A finished turn (a Stop bell: unread, not urgent) is NOT something the watch reports.
    ids.D = await shellSession('watch D')
    await postHook(ids.D, 'Stop')
    await waitAttention(ids.D, true)
    await sleep(everyMinute + 18_000)
    const afterTick = watchLines()
    t.check('4. after the next tick the same episode is not reported again (exactly one "jarvis watch" line)', afterTick.length === 1, describeLines(afterTick))
    const chat4 = await chat()
    t.check('4. ...and Jarvis has exactly one [Watch] message', chat4 !== null && chat4.watchCount === 1, chat4 ? `${chat4.source}; count ${chat4.watchCount}` : 'no Jarvis conversation')
    t.check('4. a finished-turn bell ("watch D", unread) is not reported as waiting', chat4 !== null && !/- "watch D" — waiting for you/.test(norm(chat4.text)), chat4 ? norm(chat4.text).slice(0, 160) : 'no Jarvis conversation')

    // ================= 5. a NEW episode is reported =================
    await ev(`window.api.clearAttention(${js(ids.A)})`)
    const cleared = await waitAttention(ids.A, false)
    t.check('5. (setup) "watch A" is marked read, so its episode is over', cleared === true, String(await attentionOf(ids.A)))
    ids.B = await shellSession('watch B')
    await postHook(ids.B, 'Notification')
    await waitAttention(ids.B, true)
    const secondLines = await waitFor(() => (watchLines().length >= 2 ? watchLines() : null), 135_000, 2000)
    t.check('5. a bell on the new session "watch B" is reported on the next tick (a second line)', !!secondLines, describeLines(watchLines()))
    const secondChat = await waitFor(async () => {
      const c = await chat()
      if (!c || c.watchCount < 2) return null
      const messages = c.texts.filter((x) => x.trim().startsWith('[Watch]'))
      const hit = messages.find((x) => /- "watch B" — waiting for you/.test(norm(x)))
      return hit ? { c, hit } : null
    }, 60_000, 2500)
    t.check('5. ...and its message names "watch B" (the new episode) and does NOT list "watch A" again as an item (the same unanswered question; the digest may still mention it)', !!secondChat && !/- "watch A" — waiting for you/.test(norm(secondChat.hit)),
      secondChat ? norm(secondChat.hit).slice(0, 220) : 'no second [Watch] message naming watch B')

    // ================= 6. watch OFF stops the checks =================
    const off = await ev(`window.api.updateSettings({ jarvis: { watchEnabled: false } }).then((s) => s.jarvis)`)
    t.check('6. (setup) watch is OFF again', off.watchEnabled === false, js(off))
    const linesBeforeC = watchLines().length
    ids.C = await shellSession('watch C')
    await postHook(ids.C, 'Notification')
    await waitAttention(ids.C, true)
    await sleep(120_000)
    const endLines = watchLines()
    t.check('6. with watch OFF a new bell (2 min) is never reported (no third "jarvis watch" line)', endLines.length === linesBeforeC, `${describeLines(endLines)} (before watch C: ${linesBeforeC})`)
    const chat6 = await chat()
    t.check('6. ...and Jarvis got no third [Watch] message', chat6 !== null && chat6.watchCount === 2, chat6 ? `${chat6.source}; count ${chat6.watchCount}` : 'no Jarvis conversation')
  } catch (error) {
    t.check('the watch e2e ran without an exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    // The Jarvis OpenCode conversation lives in the user's real OpenCode store: remove what THIS run created (best effort).
    try {
      const data = app ? (await app.evaluate('window.api.getStore()')).data : null
      for (const s of data ? data.sessions : []) if (s.agent === 'opencode' && /^ses_[A-Za-z0-9]+$/.test(s.opencodeSessionId || '')) created.add(s.opencodeSessionId)
    } catch {
      // The app is already gone: nothing to collect.
    }
    if (app) app.kill()
    await sleep(600)
    stopOpencodeService()
    for (const id of created) {
      try {
        execFileSync('opencode', ['session', 'delete', id], { shell: true, stdio: 'ignore', timeout: 20000 })
      } catch {
        // Best effort: leave no trace where possible.
      }
    }
    const failed = t.summary()
    if (failed === 0) fs.rmSync(root, { recursive: true, force: true })
    else console.log(`run folder kept for evidence: ${root}`)
    process.exit(failed === 0 ? 0 : 1)
  }
}

main()
