// The tools Jarvis can call (D53). Each one goes through the same controller / store / queue paths as the UI, so the
// sidebar, bell, timeline and queue behave exactly as if the user had clicked. Destructive tools ask the user first.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type {
  AgentKind,
  AwaySummary,
  ConversationSearchResult,
  CreateSessionInput,
  Id,
  QueuedPrompt,
  RuntimeState,
  Session,
  StoreData,
  TimelineTurn,
  UsageState,
  UsageWindow,
  Worktree
} from '../../shared/types'
import { QUEUE_MAX_ITEMS, QUEUE_TEXT_MAX } from '../../shared/types'
import { canTypeInto, queuedText, QUEUE_ENTER_DELAY_MS } from '../queue/promptQueue'
import { isTrustPrompt } from '../app/trustPrompt'
import { stripAnsi } from '../app/outputSignals'
import type { McpTool } from './mcpProtocol'
import { resolveGroup, resolveSession, resolveStatus, targetSessions } from './targets'
import { SCREEN_LINES_DEFAULT, SCREEN_LINES_MAX } from './screenText'

/** A session counts as ready for typing once it has run this long and its screen has been quiet this long. */
export const READY_MIN_RUN_MS = 3000
export const READY_QUIET_MS = 1200
export const READY_TIMEOUT_MS = 60_000
/** After typing, how long to wait for the session to report that a turn started. */
export const TURN_START_WAIT_MS = 10_000
/** How long a session Jarvis just woke or started may take to be running again. */
export const START_GRACE_MS = 15_000
const POLL_MS = 250
export const WAIT_DEFAULT_S = 600
export const WAIT_MAX_S = 1800
const WAIT_POLL_MS = 1000
const ANSWER_DEFAULT_CHARS = 4000
const ANSWER_MAX_CHARS = 20_000
const ACTIVITY_DEFAULT = 10
const ACTIVITY_MAX = 50
const NOTES_MAX = 20_000
const SESSION_NAME_MAX = 100

export interface ConfirmRequest {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
}

export interface JarvisToolDeps {
  readonly getData: () => StoreData
  readonly getRuntime: (id: Id) => RuntimeState | undefined
  readonly controller: {
    createSession(input: CreateSessionInput): Session
    forkSession(id: Id): Session
    removeSession(id: Id): void
    removeWorktree(id: Id): void
    closeSession(id: Id): void
    reopenSession(id: Id): void | Promise<void>
    restartSession(id: Id): Promise<void>
    sleepSession(id: Id): void
    wakeSession(id: Id): boolean
    resumeInBackground(id: Id): boolean
    writeToPty(id: Id, data: string): void
  }
  readonly store: {
    renameSession(id: Id, name: string): void
    setSessionStatus(id: Id, statusId: Id | null): void
    moveSession(id: Id, groupId: Id | null, index: number): void
    setSessionNotes(id: Id, notes: string): void
    setKeepAwake(id: Id, keepAwake: boolean): void
    createGroup(name: string): { readonly id: Id; readonly name: string }
    removeGroup(id: Id): void
    setSessionQueue(id: Id, items: readonly QueuedPrompt[]): void
  }
  /** The queue of a session changed (D47): an idle session gets its first prompt at once. */
  readonly queueChanged: (id: Id) => void
  /** The rendered screen of a session (see screenText.ts); '' when nothing was printed yet. */
  readonly screenText: (id: Id, lines: number) => Promise<string>
  /** Raw pty output (for the folder-trust check). */
  readonly rawOutput: (id: Id) => string
  readonly timeline: (id: Id) => readonly TimelineTurn[]
  readonly search: (query: string) => Promise<ConversationSearchResult>
  /** D54: the reply to the last prompt from the saved Claude conversation; null when there is none. */
  readonly lastAnswer: (session: Session) => Promise<string | null>
  readonly usage: () => UsageState
  /** Every recorded turn of every session (cost today). */
  readonly allTurns: () => readonly TimelineTurn[]
  readonly lastAway: () => AwaySummary | null
  /** Shows the session in the window (like a click on its card). */
  readonly openSession: (id: Id) => void
  /** Asks the user Yes/No in the app; false on No, timeout or no window. */
  readonly confirm: (request: ConfirmRequest) => Promise<boolean>
  /** Epoch ms of the session's last process start / last output, undefined when unknown. */
  readonly startedAt: (id: Id) => number | undefined
  readonly lastOutputAt: (id: Id) => number | undefined
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly newId: () => string
  /** One line per action, for the Jarvis action log. */
  readonly log: (tool: string, detail: string) => void
}

// ---------- argument helpers

function text(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`"${key}" is required.`)
  return value
}

function optionalText(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`"${key}" must be text.`)
  return value.trim().length === 0 ? undefined : value
}

function optionalBool(args: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`"${key}" must be true or false.`)
  return value
}

function optionalInt(args: Readonly<Record<string, unknown>>, key: string, fallback: number, max: number): number {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`"${key}" must be a positive whole number.`)
  return Math.min(value, max)
}

const SESSION_PROP = { type: 'string', description: 'Session name (or part of it) or id. Ask the user when a name matches several sessions.' }

function schema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

// ---------- describing state

function agentOf(session: Session): AgentKind {
  return session.agent ?? 'claude'
}

/** One word for where a session is in its life: closed, sleeping, stopped or running (+ what it is doing). */
export function stateText(session: Session, state: RuntimeState | undefined): string {
  if (session.closedAt !== undefined) return 'closed'
  if (state?.sleeping === true) return 'sleeping'
  if (state === undefined || state.run !== 'running') {
    return state?.exitCode !== null && state?.exitCode !== undefined ? `stopped (exit code ${state.exitCode})` : 'stopped'
  }
  switch (state.activity) {
    case 'working': return 'running, working on a turn'
    case 'needs-input': return `running, WAITING FOR AN ANSWER${state.activityMessage ? `: "${state.activityMessage}"` : ''}`
    case 'finished': return 'running, idle (last turn finished)'
    default: return 'running, idle'
  }
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

function minutesAgo(now: number, at: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

function sessionLine(data: StoreData, session: Session, deps: JarvisToolDeps): string {
  const state = deps.getRuntime(session.id)
  const parts = [`"${session.name}" (id ${session.id})`, agentOf(session), stateText(session, state)]
  if (state?.attention) parts.push(`needs you: ${state.attention}`)
  const group = data.groups.find((g) => g.id === session.groupId)
  if (group) parts.push(`group "${group.name}"`)
  const status = data.statuses.find((s) => s.id === session.statusId)
  if (status) parts.push(`status "${status.name}"`)
  if (session.worktreeId !== undefined) {
    const worktree = (data.worktrees ?? []).find((w) => w.id === session.worktreeId)
    parts.push(`Code mode worktree "${worktree?.name ?? '?'}"`)
  }
  if (session.model) parts.push(`model ${session.model}`)
  if (session.keepAwake) parts.push('keep awake')
  if (state?.remoteControl) parts.push('Remote Control on')
  if ((session.queue ?? []).length > 0) parts.push(`${session.queue!.length} queued prompt(s)`)
  const last = deps.timeline(session.id).at(-1)
  if (last !== undefined && last.prompt.length > 0) parts.push(`last prompt ${minutesAgo(deps.now(), last.startedAt)}: "${clip(last.prompt, 80)}"`)
  parts.push(`folder ${session.cwd}`)
  return `- ${parts.join(' · ')}`
}

/** "3 h 20 min", "12 min", "now". */
function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes <= 0) return "now"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ${minutes % 60} min`
  return `${Math.round(hours / 24)} days`
}

/** Working on a turn, or still has queued prompts it will get (a running, awake agent session). */
function isBusy(session: Session, state: RuntimeState | undefined): boolean {
  if (state?.activity === "working") return true
  const typeable = session.closedAt === undefined && state?.run === "running" && state.sleeping !== true
  return typeable && (session.queue ?? []).length > 0 && state?.activity !== "needs-input"
}

function resolveFolder(raw: string): string {
  const trimmed = raw.trim()
  const expanded = trimmed === '~' ? homedir() : trimmed.startsWith('~/') || trimmed.startsWith('~\\') ? join(homedir(), trimmed.slice(2)) : trimmed
  if (!isAbsolute(expanded)) throw new Error(`Use a full folder path (like C:\\work\\project), not "${raw}".`)
  if (!existsSync(expanded)) throw new Error(`Folder not found: ${expanded}`)
  return expanded
}

function resolveWorktree(data: StoreData, ref: string): Worktree {
  const worktrees = data.worktrees ?? []
  const want = ref.trim().toLowerCase()
  const found = worktrees.filter((w) => w.id === ref.trim() || w.name.toLowerCase() === want || w.branch.toLowerCase() === want)
  if (found.length === 1) return found[0]
  if (found.length === 0) throw new Error(`No worktree matches "${ref}".`)
  throw new Error(`"${ref}" matches several worktrees: ${found.map((w) => `"${w.name}" (id ${w.id})`).join(', ')}. Pass the id.`)
}

// ---------- typing into a session

/** Open, running and awake. Unlike the prompt queue's canTypeInto, a Shell session counts too (Jarvis may type commands). */
export function isTypeable(session: Session | undefined, state: RuntimeState | undefined): boolean {
  return session !== undefined && session.closedAt === undefined && state?.run === 'running' && state.sleeping !== true
}

type ReadyResult = 'ready' | 'trust' | 'stopped' | 'timeout'

export function createJarvisTools(deps: JarvisToolDeps): readonly McpTool[] {
  const find = (id: Id): Session | undefined => deps.getData().sessions.find((s) => s.id === id)

  /**
   * Waits until the session's program has started and its screen has settled (or it asks to trust the folder).
   * `since` = the moment Jarvis woke or started it: the old process may still be exiting, so for a while the
   * session is allowed to be not-yet-running, and only a process started after that moment counts.
   */
  async function waitUntilReady(id: Id, since: number | null): Promise<ReadyResult> {
    const deadline = deps.now() + READY_TIMEOUT_MS
    for (;;) {
      const session = find(id)
      const state = deps.getRuntime(id)
      const now = deps.now()
      const started = deps.startedAt(id) ?? 0
      const booting = since !== null && (started < since || !isTypeable(session, state))
      if (booting) {
        if (now - since >= START_GRACE_MS) return 'stopped'
        await deps.sleep(POLL_MS)
        continue
      }
      if (!isTypeable(session, state)) return 'stopped'
      if (agentOf(session!) === 'claude' && isTrustPrompt(stripAnsi(deps.rawOutput(id).slice(-4000)))) return 'trust'
      const quiet = now - (deps.lastOutputAt(id) ?? started)
      if (now - started >= READY_MIN_RUN_MS && quiet >= READY_QUIET_MS) return 'ready'
      if (now >= deadline) return 'timeout'
      await deps.sleep(POLL_MS)
    }
  }

  /** Brings a session back to running: sleeping -> wake, stopped -> start, closed -> reopen. Returns what it did. */
  async function startIfNeeded(session: Session): Promise<string | null> {
    const state = deps.getRuntime(session.id)
    if (session.closedAt !== undefined) {
      await deps.controller.reopenSession(session.id)
      return 'reopened'
    }
    if (state?.sleeping === true) {
      if (!deps.controller.wakeSession(session.id)) throw new Error(`Could not wake "${session.name}".`)
      return 'woke'
    }
    if (state === undefined || state.run !== 'running') {
      if (!deps.controller.resumeInBackground(session.id)) throw new Error(`Could not start "${session.name}" (is its folder still there?).`)
      return 'started'
    }
    return null
  }

  function addToQueue(session: Session, prompt: string): string {
    const queue = find(session.id)?.queue ?? []
    if (queue.length >= QUEUE_MAX_ITEMS) throw new Error(`The queue of "${session.name}" is full (${QUEUE_MAX_ITEMS} prompts).`)
    deps.store.setSessionQueue(session.id, [...queue, { id: deps.newId(), text: prompt, addedAt: deps.now() }])
    deps.queueChanged(session.id)
    return `Queued for "${session.name}" (position ${queue.length + 1}); it is typed in when the current turn finishes.`
  }

  async function typePrompt(session: Session, prompt: string): Promise<string> {
    const before = deps.timeline(session.id).length
    deps.controller.writeToPty(session.id, queuedText(prompt))
    await deps.sleep(QUEUE_ENTER_DELAY_MS)
    deps.controller.writeToPty(session.id, '\r')
    if (agentOf(session) === 'shell') return `Typed into the shell "${session.name}".`
    const deadline = deps.now() + TURN_START_WAIT_MS
    while (deps.now() < deadline) {
      await deps.sleep(POLL_MS)
      const activity = deps.getRuntime(session.id)?.activity
      if (activity === 'working' || activity === 'needs-input' || deps.timeline(session.id).length > before) {
        return `Sent to "${session.name}"; it started working.`
      }
    }
    return `Typed into "${session.name}", but it has not reported a new turn yet. Check it with read_screen.`
  }

  async function sendPrompt(session: Session, prompt: string, when: string): Promise<string> {
    if (prompt.trim().length === 0) throw new Error('The prompt is empty.')
    if (prompt.length > QUEUE_TEXT_MAX) throw new Error(`The prompt is too long (max ${QUEUE_TEXT_MAX} characters).`)
    if (when === 'queue') return addToQueue(session, prompt)
    const startedAt = deps.now()
    const started = await startIfNeeded(session)
    const current = find(session.id) ?? session
    const activity = deps.getRuntime(session.id)?.activity
    if (when === 'auto' && started === null && (activity === 'working' || activity === 'needs-input')) {
      const queued = addToQueue(current, prompt)
      return activity === 'needs-input'
        ? `${queued} Note: it is waiting for an answer right now; use read_screen and press_keys to answer it.`
        : queued
    }
    const ready = await waitUntilReady(session.id, started === null ? null : startedAt)
    if (ready === 'trust') {
      return `"${session.name}" is asking whether to trust its folder. Nothing was typed. Ask the user, then answer with press_keys (Enter = the highlighted option), and send the prompt again.`
    }
    if (ready === 'stopped') throw new Error(`"${session.name}" is not running (it may have exited). Check it with read_screen.`)
    if (ready === 'timeout') throw new Error(`"${session.name}" did not settle within ${READY_TIMEOUT_MS / 1000} s. Check it with read_screen.`)
    const sent = await typePrompt(current, prompt)
    return started === null ? sent : `${started[0].toUpperCase()}${started.slice(1)} it first. ${sent}`
  }

  const KEYS: Readonly<Record<string, string>> = {
    enter: '\r', esc: '\x1b', escape: '\x1b', tab: '\t', 'shift+tab': '\x1b[Z', backspace: '\x7f', space: ' ',
    up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', 'ctrl+c': '\x03', 'ctrl+d': '\x04'
  }

  const tools: McpTool[] = [
    {
      name: 'list_sessions',
      description: 'Lists every session in SessionDeck with its agent, state (running/working/waiting/idle, sleeping, stopped, closed), whether it needs the user, group, status, folder, queued prompts and last prompt. Also lists the groups, statuses and saved presets. Call this first.',
      inputSchema: schema({ include_closed: { type: 'boolean', description: 'Also list closed sessions (default true).' } }),
      run: async (args) => {
        const data = deps.getData()
        const includeClosed = optionalBool(args, 'include_closed') ?? true
        const sessions = targetSessions(data).filter((s) => includeClosed || s.closedAt === undefined)
        const lines = sessions.map((s) => sessionLine(data, s, deps))
        const presets = (data.presets ?? []).map((p) => `"${p.name}" (${p.agent}, ${p.cwd})`)
        return [
          `${sessions.length} session(s):`,
          ...(lines.length > 0 ? lines : ['(none)']),
          `Groups: ${data.groups.map((g) => `"${g.name}"`).join(', ') || '(none)'}`,
          `Statuses: ${data.statuses.map((s) => `"${s.name}"`).join(', ') || '(none)'}`,
          `Presets: ${presets.join(', ') || '(none)'}`
        ].join('\n')
      }
    },
    {
      name: 'read_screen',
      description: "Returns the last lines of a session's terminal as plain text: what the user would see. Use it to check progress, read an answer, or see a question/menu the session is waiting on.",
      inputSchema: schema({ session: SESSION_PROP, lines: { type: 'integer', description: `How many lines (default ${SCREEN_LINES_DEFAULT}, max ${SCREEN_LINES_MAX}).` } }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const screen = await deps.screenText(session.id, optionalInt(args, 'lines', SCREEN_LINES_DEFAULT, SCREEN_LINES_MAX))
        const state = stateText(session, deps.getRuntime(session.id))
        return `"${session.name}" is ${state}.\n----- screen -----\n${screen.length > 0 ? screen : '(nothing on screen yet)'}`
      }
    },
    {
      name: 'get_activity',
      description: 'Recent turns of a session (prompt, when, how long, how it ended, cost) and its cost today.',
      inputSchema: schema({ session: SESSION_PROP, limit: { type: 'integer', description: `How many turns (default ${ACTIVITY_DEFAULT}).` } }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const turns = deps.timeline(session.id)
        const limit = optionalInt(args, 'limit', ACTIVITY_DEFAULT, ACTIVITY_MAX)
        const now = deps.now()
        const midnight = new Date(now).setHours(0, 0, 0, 0)
        const today = turns.filter((t) => t.startedAt >= midnight && t.costUsd !== null).reduce((sum, t) => sum + (t.costUsd ?? 0), 0)
        const lines = turns.slice(-limit).reverse().map((t) => {
          const took = t.endedAt !== null ? `${Math.max(1, Math.round((t.endedAt - t.startedAt) / 1000))} s` : 'still running'
          const cost = t.costUsd !== null ? ` · $${t.costUsd.toFixed(2)}` : ''
          return `- ${minutesAgo(now, t.startedAt)} · ${t.end ?? 'running'} · ${took}${cost}${t.neededYou ? ' · needed the user' : ''} · "${clip(t.prompt || '(prompt unknown)', 120)}"`
        })
        return [`"${session.name}": ${turns.length} turn(s) recorded, cost today $${today.toFixed(2)}.`, ...(lines.length > 0 ? lines : ['(no turns yet)'])].join('\n')
      }
    },
    {
      name: 'search_conversations',
      description: "Searches the saved Claude Code conversations of all sessions for a text (case-insensitive). Returns matching excerpts with the session they belong to, newest first.",
      inputSchema: schema({ query: { type: 'string', description: '2 to 200 characters.' } }, ['query']),
      run: async (args) => {
        const result = await deps.search(text(args, 'query'))
        const names = new Map(deps.getData().sessions.map((s) => [s.id, s.name]))
        const lines = result.hits.slice(0, 30).map((hit) => `- "${names.get(hit.sessionId) ?? 'removed session'}" · ${hit.role === 'user' ? 'user' : 'Claude'} · ${hit.snippet}`)
        return [`${result.hits.length}${result.truncated ? '+' : ''} match(es) in ${result.searchedSessions} conversation(s).`, ...lines].join('\n')
      }
    },
    {
      name: 'wait_for_session',
      description: 'Waits until a session is no longer working (its turn finished, it needs an answer, or it stopped), including prompts still in its queue. Use it after send_prompt to act on the result, e.g. "when the tests finish, send the failures to X". Returns "still working" after the timeout; call it again to keep waiting.',
      inputSchema: schema({
        session: SESSION_PROP,
        timeout_seconds: { type: 'integer', description: `How long to wait at most (default ${WAIT_DEFAULT_S}, max ${WAIT_MAX_S}).` }
      }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const timeout = optionalInt(args, 'timeout_seconds', WAIT_DEFAULT_S, WAIT_MAX_S) * 1000
        const begin = deps.now()
        for (;;) {
          const current = find(session.id)
          if (current === undefined) throw new Error(`"${session.name}" was removed while waiting.`)
          const state = deps.getRuntime(session.id)
          if (!isBusy(current, state)) {
            const waited = Math.round((deps.now() - begin) / 1000)
            const asking = state?.activity === 'needs-input' ? ' It is waiting for an answer: use read_screen to see the question.' : ''
            const answer = agentOf(current) === 'shell' ? ' Use read_screen to see its output.' : ' Use get_last_answer to read its reply.'
            return `"${current.name}" is ${stateText(current, state)} (waited ${waited} s).${asking}${answer}`
          }
          if (deps.now() - begin >= timeout) {
            return `"${current.name}" is still working after ${Math.round(timeout / 1000)} s. Call wait_for_session again to keep waiting.`
          }
          await deps.sleep(WAIT_POLL_MS)
        }
      }
    },
    {
      name: 'get_last_answer',
      description: "Returns the session's reply to its last prompt as text, from the saved conversation (complete, not cut by the screen). For OpenCode and shell sessions it falls back to the screen.",
      inputSchema: schema({ session: SESSION_PROP, max_chars: { type: 'integer', description: `Default ${ANSWER_DEFAULT_CHARS}, max ${ANSWER_MAX_CHARS}. A longer answer keeps its end.` } }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const max = optionalInt(args, 'max_chars', ANSWER_DEFAULT_CHARS, ANSWER_MAX_CHARS)
        const state = deps.getRuntime(session.id)
        const answer = agentOf(session) === 'claude' ? await deps.lastAnswer(session) : null
        if (answer === null || answer.trim().length === 0) {
          const screen = await deps.screenText(session.id, SCREEN_LINES_DEFAULT)
          const why = answer === null ? 'No saved conversation to read' : 'The last prompt has no reply yet'
          return `${why}; "${session.name}" is ${stateText(session, state)}. Its screen:\n----- screen -----\n${screen || '(nothing on screen yet)'}`
        }
        const body = answer.length <= max ? answer : `…(start cut)\n${answer.slice(answer.length - max)}`
        const busy = state?.activity === 'working' ? ' (it is still working: this may be an earlier or partial reply)' : ''
        return `Last reply of "${session.name}"${busy}:\n${body}`
      }
    },
    {
      name: 'get_usage',
      description: 'Plan usage: the Claude 5-hour and weekly limits (% used, when they reset), OpenCode Go if used, the cost of all sessions today, and the model/context of running sessions.',
      inputSchema: schema({}),
      run: async () => {
        const usage = deps.usage()
        const now = deps.now()
        const windowText = (label: string, w: UsageWindow | null | undefined): string | null => {
          if (w === null || w === undefined) return null
          const reset = w.resetsAt === null ? '' : `, resets in ${durationText(w.resetsAt * 1000 - now)}`
          return `${label} ${Math.round(w.usedPercentage)}% used${reset}`
        }
        const lines: string[] = []
        const accounts = usage.accounts ?? (usage.account !== null ? [usage.account] : [])
        for (const account of accounts) {
          const name = account.provider === 'opencode-go' ? 'OpenCode Go' : 'Claude plan'
          const parts = [windowText('5-hour', account.fiveHour), windowText('weekly', account.sevenDay), windowText('monthly', account.monthly)].filter((x): x is string => x !== null)
          lines.push(`- ${name}: ${parts.join(' · ') || 'no data'} (updated ${minutesAgo(now, account.updatedAt)})`)
        }
        if (accounts.length === 0) lines.push('- No plan usage yet: it arrives with the next Claude turn (or a manual refresh in the status bar).')
        const midnight = new Date(now).setHours(0, 0, 0, 0)
        const today = deps.allTurns().filter((t) => t.startedAt >= midnight && t.costUsd !== null).reduce((sum, t) => sum + (t.costUsd ?? 0), 0)
        lines.push(`- Cost of all sessions today: $${today.toFixed(2)}`)
        const names = new Map(deps.getData().sessions.map((s) => [s.id, s.name]))
        const running = usage.sessions.filter((u) => names.has(u.sessionId) && deps.getRuntime(u.sessionId)?.run === 'running')
        for (const u of running.slice(0, 15)) {
          const ctx = u.contextPercent === null ? '' : ` · context ${Math.round(u.contextPercent)}%`
          const cost = u.costUsd === null ? '' : ` · $${u.costUsd.toFixed(2)} this session`
          lines.push(`  - "${names.get(u.sessionId)}": ${u.model ?? 'model unknown'}${ctx}${cost}`)
        }
        return lines.join('\n')
      }
    },
    {
      name: 'get_away_summary',
      description: 'What happened while the user was away last time (the "While you were away" summary): finished turns, sessions that need the user, slept, hit the limit, cost.',
      inputSchema: schema({}),
      run: async () => {
        const away = deps.lastAway()
        if (away === null) return 'No away summary yet in this run (it is made when the user comes back after being away).'
        const now = deps.now()
        const lines = away.sessions.map((s) => {
          const parts = [s.finished > 0 ? `${s.finished} turn(s) finished` : null, s.needsYou ? 'NEEDS THE USER' : null, s.slept ? 'slept' : null, s.hitLimit ? 'hit the usage limit' : null, s.costUsd !== null ? `$${s.costUsd.toFixed(2)}` : null].filter((x): x is string => x !== null)
          return `- "${s.name}": ${parts.join(' · ')}${s.lastPrompt ? ` · last prompt "${clip(s.lastPrompt, 80)}"` : ''}`
        })
        const t = away.totals
        return [
          `Away from ${minutesAgo(now, away.since)} until ${minutesAgo(now, away.until)}: ${t.finished} finished, ${t.needsYou} need the user, ${t.slept} slept, ${t.hitLimit} hit the limit, $${t.costUsd.toFixed(2)}.`,
          ...(lines.length > 0 ? lines : ['(nothing happened)'])
        ].join('\n')
      }
    },
    {
      name: 'create_session',
      description: 'Creates and starts a new session in a folder (Ops mode). Optionally from a saved preset, in a group, with a status, and with a first prompt that is typed in once it is ready.',
      inputSchema: schema({
        folder: { type: 'string', description: 'Full folder path. Optional when a preset is given.' },
        name: { type: 'string', description: 'Session name (default: the folder name).' },
        agent: { type: 'string', enum: ['claude', 'opencode', 'shell'], description: 'Default claude (or the preset\'s).' },
        model: { type: 'string', description: 'OpenCode only: provider/model.' },
        group: { type: 'string', description: 'Existing group name.' },
        status: { type: 'string', description: 'Existing status name.' },
        preset: { type: 'string', description: 'Saved preset name: its folder, agent, model, args, group and status are used unless given here.' },
        remote_control: { type: 'boolean', description: 'Claude only: start with Remote Control on.' },
        prompt: { type: 'string', description: 'First prompt, typed in when the session is ready.' },
        open: { type: 'boolean', description: 'Show the new session in the window (default false).' }
      }),
      run: async (args) => {
        const data = deps.getData()
        const presetName = optionalText(args, 'preset')
        const preset = presetName === undefined ? undefined : (data.presets ?? []).find((p) => p.name.toLowerCase() === presetName.trim().toLowerCase())
        if (presetName !== undefined && preset === undefined) {
          throw new Error(`No preset named "${presetName}". Presets: ${(data.presets ?? []).map((p) => `"${p.name}"`).join(', ') || '(none)'}`)
        }
        const folderArg = optionalText(args, 'folder')
        if (folderArg === undefined && preset === undefined) throw new Error('"folder" is required (or give a preset).')
        const cwd = folderArg !== undefined ? resolveFolder(folderArg) : preset!.cwd
        const agentArg = optionalText(args, 'agent')
        if (agentArg !== undefined && !['claude', 'opencode', 'shell'].includes(agentArg)) throw new Error('"agent" must be claude, opencode or shell.')
        const agent = (agentArg ?? preset?.agent ?? 'claude') as AgentKind
        const groupName = optionalText(args, 'group')
        const statusName = optionalText(args, 'status')
        const groupId = groupName !== undefined ? resolveGroup(data, groupName).id : preset?.groupId && data.groups.some((g) => g.id === preset.groupId) ? preset.groupId : null
        const statusId = statusName !== undefined ? resolveStatus(data, statusName).id : preset?.statusId && data.statuses.some((s) => s.id === preset.statusId) ? preset.statusId : null
        const name = optionalText(args, 'name')
        if (name !== undefined && name.trim().length > SESSION_NAME_MAX) throw new Error(`The name is too long (max ${SESSION_NAME_MAX}).`)
        const model = agent === 'opencode' ? optionalText(args, 'model') ?? preset?.model : undefined
        const baseArgs = agent === 'claude' ? [...(preset?.agent === 'claude' ? preset.claudeArgs : [])] : []
        const remote = optionalBool(args, 'remote_control')
        const claudeArgs = remote === true && !baseArgs.includes('--remote-control') ? [...baseArgs, '--remote-control']
          : remote === false ? baseArgs.filter((a) => a !== '--remote-control') : baseArgs
        const session = deps.controller.createSession({
          cwd,
          ...(name !== undefined ? { name: name.trim() } : {}),
          groupId,
          statusId,
          claudeArgs,
          agent,
          ...(model !== undefined ? { model } : {})
        })
        deps.log('create_session', `"${session.name}" in ${cwd}`)
        if (optionalBool(args, 'open') === true) deps.openSession(session.id)
        const created = `Created "${session.name}" (id ${session.id}, ${agent}) in ${cwd}.`
        const prompt = optionalText(args, 'prompt')
        if (prompt === undefined) return created
        return `${created} ${await sendPrompt(session, prompt, 'auto')}`
      }
    },
    {
      name: 'send_prompt',
      description: "Sends a prompt to a session. when='auto' (default): starts/wakes the session if needed, types it now when idle, or queues it when a turn is running. 'now': type it even while working. 'queue': add it to the session's prompt queue.",
      inputSchema: schema({
        session: SESSION_PROP,
        text: { type: 'string', description: 'The prompt.' },
        when: { type: 'string', enum: ['auto', 'now', 'queue'] }
      }, ['session', 'text']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        if (agentOf(session) === 'shell' && optionalText(args, 'when') === 'queue') throw new Error('Shell sessions have no prompt queue.')
        const when = optionalText(args, 'when') ?? 'auto'
        if (!['auto', 'now', 'queue'].includes(when)) throw new Error('"when" must be auto, now or queue.')
        deps.log('send_prompt', `"${session.name}": ${clip(String(args.text ?? ''), 80)}`)
        return sendPrompt(session, text(args, 'text'), when)
      }
    },
    {
      name: 'broadcast_prompt',
      description: 'Sends the same prompt to several sessions (same rules as send_prompt when=auto). Give session names/ids, or all_running=true for every running Claude/OpenCode session.',
      inputSchema: schema({
        sessions: { type: 'array', items: { type: 'string' }, description: 'Session names or ids.' },
        all_running: { type: 'boolean' },
        text: { type: 'string' }
      }, ['text']),
      run: async (args) => {
        const data = deps.getData()
        const prompt = text(args, 'text')
        const refs = Array.isArray(args.sessions) ? args.sessions : []
        const targets = optionalBool(args, 'all_running') === true
          ? targetSessions(data).filter((s) => agentOf(s) !== 'shell' && canTypeInto(s, deps.getRuntime(s.id)))
          : refs.map((ref) => resolveSession(data, ref))
        if (targets.length === 0) throw new Error('No sessions to send to.')
        deps.log('broadcast_prompt', `${targets.length} session(s): ${clip(prompt, 80)}`)
        const results = await Promise.all(targets.map(async (s) => {
          try {
            return `- ${await sendPrompt(s, prompt, 'auto')}`
          } catch (error) {
            return `- "${s.name}": FAILED: ${error instanceof Error ? error.message : String(error)}`
          }
        }))
        return results.join('\n')
      }
    },
    {
      name: 'press_keys',
      description: 'Presses keys in a session, to answer a menu or question (read_screen first). Keys: enter, esc, tab, shift+tab, up, down, left, right, backspace, space, ctrl+c, ctrl+d, or a single character like "1" or "y".',
      inputSchema: schema({ session: SESSION_PROP, keys: { type: 'array', items: { type: 'string' } } }, ['session', 'keys']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        if (!isTypeable(session, deps.getRuntime(session.id))) throw new Error(`"${session.name}" is not running.`)
        const keys = Array.isArray(args.keys) ? args.keys : []
        if (keys.length === 0 || keys.length > 20) throw new Error('Give 1 to 20 keys.')
        const codes = keys.map((key) => {
          if (typeof key !== 'string') throw new Error('Each key must be text.')
          const code = KEYS[key.toLowerCase()] ?? (Array.from(key).length === 1 ? key : undefined)
          if (code === undefined) throw new Error(`Unknown key "${key}".`)
          return code
        })
        for (const code of codes) {
          deps.controller.writeToPty(session.id, code)
          await deps.sleep(120)
        }
        deps.log('press_keys', `"${session.name}": ${keys.join(' ')}`)
        return `Pressed ${keys.join(', ')} in "${session.name}".`
      }
    },
    {
      name: 'sleep_session',
      description: 'Puts a running session to sleep: its process stops to free memory, the conversation is kept and comes back on wake.',
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const state = deps.getRuntime(session.id)
        if (state?.sleeping === true) return `"${session.name}" is already asleep.`
        if (session.closedAt !== undefined || state?.run !== 'running') return `"${session.name}" is not running (${stateText(session, state)}); nothing to do.`
        deps.controller.sleepSession(session.id)
        deps.log('sleep_session', session.name)
        return `"${session.name}" is asleep.`
      }
    },
    {
      name: 'wake_session',
      description: 'Starts a session again (reconnect): wakes a sleeping one, starts a stopped one, reopens a closed one. The same conversation continues.',
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const did = await startIfNeeded(session)
        deps.log('wake_session', session.name)
        return did === null ? `"${session.name}" is already running.` : `"${session.name}" ${did === 'woke' ? 'is waking up' : did === 'reopened' ? 'was reopened' : 'is starting'}.`
      }
    },
    {
      name: 'restart_session',
      description: "Restarts a session's process (same conversation). Use when it is stuck.",
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        if (session.closedAt !== undefined) throw new Error(`"${session.name}" is closed; use wake_session.`)
        await deps.controller.restartSession(session.id)
        deps.log('restart_session', session.name)
        return `"${session.name}" restarted.`
      }
    },
    {
      name: 'close_session',
      description: 'Closes a session: stops it and moves it to the sidebar Closed section. It can be reopened later with wake_session (conversation kept).',
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        if (session.closedAt !== undefined) return `"${session.name}" is already closed.`
        deps.controller.closeSession(session.id)
        deps.log('close_session', session.name)
        return `"${session.name}" is closed.`
      }
    },
    {
      name: 'fork_session',
      description: "Forks a Claude session: a new session continues a copy of its conversation; the original is not changed.",
      inputSchema: schema({ session: SESSION_PROP, open: { type: 'boolean' } }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const fork = deps.controller.forkSession(session.id)
        deps.log('fork_session', `${session.name} -> ${fork.name}`)
        if (optionalBool(args, 'open') === true) deps.openSession(fork.id)
        return `Forked "${session.name}" into "${fork.name}" (id ${fork.id}).`
      }
    },
    {
      name: 'remove_session',
      description: 'PERMANENTLY removes a session from SessionDeck (its process is stopped). The user is asked to confirm in the app.',
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const yes = await deps.confirm({ title: 'Jarvis: remove session', message: `Jarvis wants to remove session “${session.name}”. This cannot be undone.`, confirmLabel: 'Remove' })
        if (!yes) return `The user did not allow removing "${session.name}". Nothing was changed.`
        deps.controller.removeSession(session.id)
        deps.log('remove_session', session.name)
        return `"${session.name}" was removed.`
      }
    },
    {
      name: 'remove_worktree',
      description: 'Code mode: PERMANENTLY removes a worktree from SessionDeck with all its sessions (the folder on disk is kept). The user is asked to confirm.',
      inputSchema: schema({ worktree: { type: 'string', description: 'Worktree name, branch or id.' } }, ['worktree']),
      run: async (args) => {
        const worktree = resolveWorktree(deps.getData(), text(args, 'worktree'))
        const count = deps.getData().sessions.filter((s) => s.worktreeId === worktree.id).length
        const yes = await deps.confirm({ title: 'Jarvis: remove worktree', message: `Jarvis wants to remove worktree “${worktree.name}” and its ${count} session(s) from SessionDeck. The folder on disk is kept.`, confirmLabel: 'Remove' })
        if (!yes) return `The user did not allow removing worktree "${worktree.name}". Nothing was changed.`
        deps.controller.removeWorktree(worktree.id)
        deps.log('remove_worktree', worktree.name)
        return `Worktree "${worktree.name}" was removed.`
      }
    },
    {
      name: 'rename_session',
      description: 'Renames a session.',
      inputSchema: schema({ session: SESSION_PROP, name: { type: 'string' } }, ['session', 'name']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const name = text(args, 'name').trim()
        if (name.length > SESSION_NAME_MAX) throw new Error(`The name is too long (max ${SESSION_NAME_MAX}).`)
        deps.store.renameSession(session.id, name)
        deps.log('rename_session', `${session.name} -> ${name}`)
        return `Renamed "${session.name}" to "${name}".`
      }
    },
    {
      name: 'set_status',
      description: 'Sets the status of a session (a status name from list_sessions), or clears it with status=null.',
      inputSchema: schema({ session: SESSION_PROP, status: { type: ['string', 'null'] } }, ['session', 'status']),
      run: async (args) => {
        const data = deps.getData()
        const session = resolveSession(data, args.session)
        const statusName = optionalText(args, 'status')
        const status = statusName === undefined ? null : resolveStatus(data, statusName)
        deps.store.setSessionStatus(session.id, status?.id ?? null)
        deps.log('set_status', `${session.name}: ${status?.name ?? 'none'}`)
        return status === null ? `Cleared the status of "${session.name}".` : `"${session.name}" is now "${status.name}".`
      }
    },
    {
      name: 'move_to_group',
      description: 'Moves an Ops session into a group (by name), or out of any group with group=null.',
      inputSchema: schema({ session: SESSION_PROP, group: { type: ['string', 'null'] } }, ['session', 'group']),
      run: async (args) => {
        const data = deps.getData()
        const session = resolveSession(data, args.session)
        if (session.worktreeId !== undefined) throw new Error('Code mode sessions live under their worktree, not in groups.')
        const groupName = optionalText(args, 'group')
        const group = groupName === undefined ? null : resolveGroup(data, groupName)
        const index = data.sessions.filter((s) => s.groupId === (group?.id ?? null) && s.id !== session.id).length
        deps.store.moveSession(session.id, group?.id ?? null, index)
        deps.log('move_to_group', `${session.name}: ${group?.name ?? 'ungrouped'}`)
        return group === null ? `"${session.name}" is ungrouped.` : `Moved "${session.name}" to "${group.name}".`
      }
    },
    {
      name: 'create_group',
      description: 'Creates a sidebar group.',
      inputSchema: schema({ name: { type: 'string' } }, ['name']),
      run: async (args) => {
        const group = deps.store.createGroup(text(args, 'name').trim())
        deps.log('create_group', group.name)
        return `Created group "${group.name}".`
      }
    },
    {
      name: 'remove_group',
      description: 'Deletes a group (its sessions become ungrouped). The user is asked to confirm.',
      inputSchema: schema({ group: { type: 'string' } }, ['group']),
      run: async (args) => {
        const group = resolveGroup(deps.getData(), text(args, 'group'))
        const yes = await deps.confirm({ title: 'Jarvis: delete group', message: `Jarvis wants to delete group “${group.name}”. Its sessions become ungrouped.`, confirmLabel: 'Delete' })
        if (!yes) return `The user did not allow deleting group "${group.name}". Nothing was changed.`
        deps.store.removeGroup(group.id)
        deps.log('remove_group', group.name)
        return `Group "${group.name}" was deleted.`
      }
    },
    {
      name: 'set_notes',
      description: "Sets (or appends to) a session's notes.",
      inputSchema: schema({ session: SESSION_PROP, notes: { type: 'string' }, append: { type: 'boolean', description: 'Add to the end instead of replacing.' } }, ['session', 'notes']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const given = typeof args.notes === 'string' ? args.notes : ''
        const next = optionalBool(args, 'append') === true && session.notes ? `${session.notes}\n${given}` : given
        if (next.length > NOTES_MAX) throw new Error(`Notes are limited to ${NOTES_MAX} characters.`)
        deps.store.setSessionNotes(session.id, next)
        deps.log('set_notes', session.name)
        return `Updated the notes of "${session.name}".`
      }
    },
    {
      name: 'set_keep_awake',
      description: 'Turns "keep awake" on or off for a session (on = the idle timer never puts it to sleep).',
      inputSchema: schema({ session: SESSION_PROP, keep_awake: { type: 'boolean' } }, ['session', 'keep_awake']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const on = optionalBool(args, 'keep_awake')
        if (on === undefined) throw new Error('"keep_awake" is required.')
        deps.store.setKeepAwake(session.id, on)
        deps.log('set_keep_awake', `${session.name}: ${on}`)
        return `Keep awake is ${on ? 'on' : 'off'} for "${session.name}".`
      }
    },
    {
      name: 'open_session',
      description: 'Shows a session in the SessionDeck window (as if the user clicked it). Starts it if it was not running.',
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        if (session.closedAt !== undefined) await deps.controller.reopenSession(session.id)
        deps.openSession(session.id)
        deps.log('open_session', session.name)
        return `Showing "${session.name}".`
      }
    }
  ]
  return tools
}
