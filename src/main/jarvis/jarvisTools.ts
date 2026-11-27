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
  CreateWorktreeInput,
  CreateWorktreeResult,
  Id,
  JarvisSchedule,
  QueuedPrompt,
  Repo,
  RepoBranches,
  RuntimeState,
  Session,
  StoreData,
  TimelineTurn,
  UsageState,
  UsageWindow,
  WorktreeChanges
} from '../../shared/types'
import { QUEUE_MAX_ITEMS, QUEUE_TEXT_MAX, SESSION_TAG_MAX_LENGTH, SESSION_TAGS_MAX, WORKTREE_NAME_MAX } from '../../shared/types'
import { canTypeInto, queuedText, QUEUE_ENTER_DELAY_MS } from '../queue/promptQueue'
import { isTrustPrompt } from '../app/trustPrompt'
import { isIdleReminder } from '../app/activity'
import { stripAnsi } from '../app/outputSignals'
import type { McpTool } from './mcpProtocol'
import { resolveGroup, resolveRepo, resolveSession, resolveStatus, resolveWorktree, targetSessions } from './targets'
import { clip, optionalBool, optionalInt, optionalText, schema, SESSION_PROP, text } from './toolArgs'
import { readConversation, READ_DEFAULT_CHARS, READ_DEFAULT_MESSAGES, READ_MAX_CHARS, READ_MAX_MESSAGES } from '../transcripts/conversationRead'
import type { TranscriptMessage } from '../transcripts/conversationSearch'
import { SCREEN_LINES_DEFAULT, SCREEN_LINES_MAX } from './screenText'
import { nextRun, scheduleWhen, timeText } from './schedules'
import { DAY_NAMES } from '../../shared/jarvisSchedule'
import type { ScheduleInput } from './scheduleService'
import { createAppTools, type JarvisAppDeps } from './appTools'
import { createUiTools, type JarvisUi } from './uiTools'
import { createControlTools, type JarvisControlDeps } from './controlTools'
import { createGitTools } from './gitTools'
import { createSystemTools, type JarvisSystemDeps } from './systemTools'
import { createPrefsTools } from './prefsTools'
import { createDigestTools } from './digestTools'
import { createLayoutTools } from './layoutTools'
import { createPanelTools } from './panelTools'
import type { CodeGitOps } from '../app/codeGitOps'
import { sessionModelProblem } from '../app/sessionController'
import { isCursorModel } from '../store/cursorValues'
import { retryWhileStopping } from '../app/retryWhileStopping'

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
const CHANGES_LIST_DEFAULT = 50
const UNDO_MAX = 20
const ACTIVITY_DEFAULT = 10
const ACTIVITY_MAX = 50
const NOTES_MAX = 20_000
/** D91: how much of a session's notes list_sessions shows (cut with an ellipsis). */
const NOTES_PREVIEW_CHARS = 300
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
    forkSession(id: Id): Session | Promise<Session>
    /** D88: moves an Ops session into a Code-mode worktree (see SessionController.moveToWorktree). */
    moveToWorktree(id: Id, worktreeId: Id): Session
    /** D88: the reverse, for the undo. */
    moveToOps(id: Id, cwd: string, groupId: Id | null): Session
    /** D79/D81: change an OpenCode or Cursor session's model (see SessionController.setOpencodeModel). */
    setOpencodeModel(id: Id, model: string | undefined): 'restarted' | 'next-start' | 'restart-failed'
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
    setSessionTags(id: Id, tags: readonly string[]): void
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
  /** D54/D79/D81: the reply to the last prompt from the saved conversation (a Claude transcript or an OpenCode export) or, for Cursor, its last reported reply; null when there is none. */
  readonly lastAnswer: (session: Session) => Promise<string | null>
  /** D91: the saved user/assistant messages of a session (Claude transcript or OpenCode export); null when it has none (shell, Cursor, no id yet). */
  readonly conversation: (session: Session) => Promise<readonly TranscriptMessage[] | null>
  readonly usage: () => UsageState
  /** Every recorded turn of every session (cost today). */
  readonly allTurns: () => readonly TimelineTurn[]
  readonly lastAway: () => AwaySummary | null
  /** D54: Jarvis's scheduled instructions (scheduleService). */
  readonly schedules: {
    list(): readonly JarvisSchedule[]
    add(input: ScheduleInput): JarvisSchedule
    remove(id: string): JarvisSchedule
    setEnabled(id: string, enabled: boolean): JarvisSchedule
  }
  /** D54: Code mode, the same paths as the IPC (codeWiring). */
  readonly code: {
    addRepo(folder: string): Promise<Repo>
    createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult>
    branches(repoId: Id): Promise<RepoBranches>
    changes(worktreeId: Id): Promise<WorktreeChanges>
    removeWorktree(worktreeId: Id): void
    /** D60: commit, push, pull request, merge, removal facts and delete from disk (the Changes panel's paths). */
    readonly git: CodeGitOps
  }
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
  /** D55: the rest of the app (settings, queue, checklist, statuses, presets, quota, Code mode extras, windows). */
  readonly app: JarvisAppDeps
  /** D55: asks a window to change what is on screen; resolves with what it did. */
  readonly ui: JarvisUi
  /** D58: the last parts of the app (Code tree, links, files, the app window). */
  readonly control: JarvisControlDeps
  /** D71: the PC (specs, screens, GPU) and the GPU preference; the app load is counted here from the store. */
  readonly system: Omit<JarvisSystemDeps, 'appLoad'>
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
    case 'needs-input':
      if (isIdleReminder(state.activityMessage)) return 'running, idle'
      return `running, WAITING FOR AN ANSWER${state.activityMessage ? `: "${state.activityMessage}"` : ''}`
    case 'finished': return 'running, idle (last turn finished)'
    default: return 'running, idle'
  }
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
  if (session.tags !== undefined && session.tags.length > 0) parts.push(`tags ${session.tags.map((tag) => `"${tag}"`).join(', ')}`)
  if (session.keepAwake) parts.push('keep awake')
  if (state?.remoteControl) parts.push('Remote Control on')
  if ((session.queue ?? []).length > 0) parts.push(`${session.queue!.length} queued prompt(s)`)
  const last = deps.timeline(session.id).at(-1)
  if (last !== undefined && last.prompt.length > 0) parts.push(`last prompt ${minutesAgo(deps.now(), last.startedAt)}: "${clip(last.prompt, 80)}"`)
  if (session.notes !== undefined && session.notes.trim().length > 0) parts.push(`notes: "${clip(session.notes.replace(/\s+/g, ' ').trim(), NOTES_PREVIEW_CHARS)}"`)
  parts.push(`folder ${session.cwd}`)
  return `- ${parts.join(' · ')}`
}

/** "3 h 20 min", "12 min", "now". */
function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ${minutes % 60} min`
  return `${Math.round(hours / 24)} days`
}

/** Working on a turn, or still has queued prompts it will get (a running, awake agent session). */
function isBusy(session: Session, state: RuntimeState | undefined): boolean {
  if (state?.activity === 'working') return true
  const typeable = session.closedAt === undefined && state?.run === 'running' && state.sleeping !== true
  return typeable && (session.queue ?? []).length > 0 && !isAsking(state)
}

/** Really waiting for an answer (a permission or a question), not just Claude's idle reminder. */
function isAsking(state: RuntimeState | undefined): boolean {
  return state?.activity === 'needs-input' && !isIdleReminder(state.activityMessage)
}

function resolveFolder(raw: string): string {
  const trimmed = raw.trim()
  const expanded = trimmed === '~' ? homedir() : trimmed.startsWith('~/') || trimmed.startsWith('~\\') ? join(homedir(), trimmed.slice(2)) : trimmed
  if (!isAbsolute(expanded)) throw new Error(`Use a full folder path (like C:\\work\\project), not "${raw}".`)
  if (!existsSync(expanded)) throw new Error(`Folder not found: ${expanded}`)
  return expanded
}



// ---------- typing into a session

/** Open, running and awake. Unlike the prompt queue's canTypeInto, a Shell session counts too (Jarvis may type commands). */
export function isTypeable(session: Session | undefined, state: RuntimeState | undefined): boolean {
  return session !== undefined && session.closedAt === undefined && state?.run === 'running' && state.sleeping !== true
}

type ReadyResult = 'ready' | 'trust' | 'stopped' | 'timeout'

/** The tools, plus the prompt sender they use (also used to give Jarvis a scheduled instruction). */
export type JarvisToolkit = readonly McpTool[] & {
  readonly sendPrompt: (session: Session, prompt: string, when: 'auto' | 'now' | 'queue') => Promise<string>
  /** D54: reverts Jarvis's last reversible action (also the panel's Undo button). */
  readonly undoLast: () => Promise<string>
}

interface UndoStep {
  readonly label: string
  readonly run: () => void | Promise<void>
}

export function createJarvisTools(deps: JarvisToolDeps): JarvisToolkit {
  const find = (id: Id): Session | undefined => deps.getData().sessions.find((s) => s.id === id)

  // D54: undo. Each reversible action records how to put things back; removals are not undoable (they ask first).
  const undoStack: UndoStep[] = []
  function pushUndo(label: string, run: () => void | Promise<void>): void {
    undoStack.push({ label, run })
    if (undoStack.length > UNDO_MAX) undoStack.shift()
  }
  async function undoLast(): Promise<string> {
    const step = undoStack.pop()
    if (step === undefined) return 'Nothing to undo.'
    try {
      await step.run()
    } catch (error) {
      return `Could not undo "${step.label}": ${error instanceof Error ? error.message : String(error)}`
    }
    deps.log('undo', step.label)
    return `Undone: ${step.label}.${undoStack.length > 0 ? ` Next undo would be: ${undoStack[undoStack.length - 1].label}.` : ''}`
  }
  /** Position of a session among its group's sessions (for putting it back). */
  function indexInGroup(session: Session): number {
    return deps.getData().sessions
      .filter((s) => s.groupId === session.groupId && s.worktreeId === undefined)
      .sort((a, b) => a.order - b.order)
      .findIndex((s) => s.id === session.id)
  }

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
      // A session closed a moment ago may still be exiting: wait for it like the app's own reopen does.
      await retryWhileStopping(() => deps.controller.reopenSession(session.id))
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
      const latest = deps.getRuntime(session.id)
      if (activity === 'working' || isAsking(latest) || deps.timeline(session.id).length > before) {
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
    const asking = isAsking(deps.getRuntime(session.id))
    if (when === 'auto' && started === null && (activity === 'working' || asking)) {
      const queued = addToQueue(current, prompt)
      return asking
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
      description: 'Lists every session in SessionDeck with its agent, state (running/working/waiting/idle, sleeping, stopped, closed), whether it needs the user, group, status, tags, folder, queued prompts and last prompt. Also lists the groups, statuses and saved presets. Call this first.',
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
      description: "Searches the saved conversations of all sessions (Claude Code transcripts and OpenCode exports) for a text (case-insensitive). Returns matching excerpts with the session they belong to, newest first.",
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
            const asking = isAsking(state) ? ' It is waiting for an answer: use read_screen to see the question.' : ''
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
      description: "Returns the session's reply to its last prompt as text, from the saved conversation (complete, not cut by the screen). Cursor replies come from the last reply its hook reported. For shell sessions (and OpenCode ones without a saved conversation) it falls back to the screen.",
      inputSchema: schema({ session: SESSION_PROP, max_chars: { type: 'integer', description: `Default ${ANSWER_DEFAULT_CHARS}, max ${ANSWER_MAX_CHARS}. A longer answer keeps its end.` } }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const max = optionalInt(args, 'max_chars', ANSWER_DEFAULT_CHARS, ANSWER_MAX_CHARS)
        const state = deps.getRuntime(session.id)
        // D79/D81: an OpenCode session with a conversation id answers from `opencode session export`, a Cursor session
        // from its in-memory last reply (both through deps.lastAnswer); without one the screen below is the only source.
        const agent = agentOf(session)
        const readable = agent === 'claude' || agent === 'cursor' || (agent === 'opencode' && session.opencodeSessionId !== undefined)
        const answer = readable ? await deps.lastAnswer(session) : null
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
      name: 'read_conversation',
      description: `Reads the saved conversation of a Claude or OpenCode session: its newest messages (default ${READ_DEFAULT_MESSAGES}, max ${READ_MAX_MESSAGES}), oldest first, each as USER or ASSISTANT with its time. Page back in time with skip. Text only: tool calls, results, thinking and images are not included. Use it ONLY when the user asks you to read, review or summarise a session's conversation or history; do not call it on your own to prepare other work (get_last_answer is for the latest reply).`,
      inputSchema: schema({
        session: SESSION_PROP,
        last: { type: 'integer', description: `How many messages. Default ${READ_DEFAULT_MESSAGES}, max ${READ_MAX_MESSAGES}.` },
        skip: { type: 'integer', description: 'Skip this many of the newest messages first, to read earlier ones. Default 0.' },
        max_chars: { type: 'integer', description: `Default ${READ_DEFAULT_CHARS}, max ${READ_MAX_CHARS}. Over the limit the oldest messages are dropped first.` }
      }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const agent = agentOf(session)
        if (agent === 'shell') return `"${session.name}" is a shell session: it has no conversation. Use read_screen.`
        if (agent === 'cursor') return `"${session.name}" is a Cursor session: SessionDeck keeps no conversation for it, only its last reply (get_last_answer) and its screen (read_screen).`
        const messages = await deps.conversation(session)
        if (messages === null || messages.length === 0) return `"${session.name}" has no saved conversation yet. Use read_screen to see what it shows.`
        const last = optionalInt(args, 'last', READ_DEFAULT_MESSAGES, READ_MAX_MESSAGES)
        const skip = optionalInt(args, 'skip', 0, messages.length)
        const max = optionalInt(args, 'max_chars', READ_DEFAULT_CHARS, READ_MAX_CHARS)
        const result = readConversation(messages, { last, skip, maxChars: max })
        if (result.shown === 0) return `"${session.name}" has ${result.total} message(s); skip ${skip} is past the start.`
        const older = result.olderLeft > 0 ? ` ${result.olderLeft} older message(s) remain (call again with skip ${skip + result.shown}).` : ' This is the start of the conversation.'
        return `Conversation of "${session.name}": showing ${result.shown} of ${result.total} messages.${older}

${result.text}`
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
        agent: { type: 'string', enum: ['claude', 'opencode', 'cursor', 'shell'], description: 'Default claude (or the preset\'s).' },
        model: { type: 'string', description: 'OpenCode (provider/model) or Cursor (a plain name like gpt-5) only.' },
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
        if (agentArg !== undefined && !['claude', 'opencode', 'cursor', 'shell'].includes(agentArg)) throw new Error('"agent" must be claude, opencode, cursor or shell.')
        const agent = (agentArg ?? preset?.agent ?? 'claude') as AgentKind
        const groupName = optionalText(args, 'group')
        const statusName = optionalText(args, 'status')
        const groupId = groupName !== undefined ? resolveGroup(data, groupName).id : preset?.groupId && data.groups.some((g) => g.id === preset.groupId) ? preset.groupId : null
        const statusId = statusName !== undefined ? resolveStatus(data, statusName).id : preset?.statusId && data.statuses.some((s) => s.id === preset.statusId) ? preset.statusId : null
        const name = optionalText(args, 'name')
        if (name !== undefined && name.trim().length > SESSION_NAME_MAX) throw new Error(`The name is too long (max ${SESSION_NAME_MAX}).`)
        const model = agent === 'opencode' || agent === 'cursor'
          ? optionalText(args, 'model') ?? (preset?.agent === agent ? preset.model : undefined)
          : undefined
        if (agent === 'cursor' && model !== undefined && !isCursorModel(model.trim())) {
          throw new Error(`"${model}" is not a Cursor model: use a plain name like gpt-5 or sonnet-4-thinking.`)
        }
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
        pushUndo(`create "${session.name}" (close it; it stays in Closed)`, () => deps.controller.closeSession(session.id))
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
      description: 'Sends the same prompt to several sessions (same rules as send_prompt when=auto). Give session names/ids, or all_running=true for every running Claude/OpenCode/Cursor session.',
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
        pushUndo(`sleep "${session.name}" (wake it)`, () => {
          deps.controller.wakeSession(session.id)
        })
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
        if (did === 'reopened') pushUndo(`reopen "${session.name}" (close it again)`, () => deps.controller.closeSession(session.id))
        else if (did !== null) pushUndo(`wake "${session.name}" (put it to sleep)`, () => deps.controller.sleepSession(session.id))
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
        pushUndo(`close "${session.name}" (reopen it)`, () => deps.controller.reopenSession(session.id))
        deps.log('close_session', session.name)
        return `"${session.name}" is closed.`
      }
    },
    {
      name: 'fork_session',
      description: "Forks a conversation into a new session; the original is not changed. A Claude session copies its conversation (Claude's own fork). An OpenCode session is COPIED (export then import): tell the user it is a copy, not a true fork, and that the two conversations now move apart.",
      inputSchema: schema({ session: SESSION_PROP, open: { type: 'boolean' } }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const fork = await deps.controller.forkSession(session.id)
        deps.log('fork_session', `${session.name} -> ${fork.name}`)
        if (optionalBool(args, 'open') === true) deps.openSession(fork.id)
        return agentOf(fork) === 'opencode'
          ? `Copied "${session.name}" into "${fork.name}" (id ${fork.id}). OpenCode has no true fork: this is a copy of its conversation, so the two now move apart.`
          : `Forked "${session.name}" into "${fork.name}" (id ${fork.id}).`
      }
    },
    {
      name: 'move_session_to_code',
      description: 'Moves an Ops session into a Code-mode worktree (D88): the same card (name, notes, tags, status) now lives under that worktree and its folder is the worktree folder. A running session restarts there on a FRESH conversation: the old conversation does not come along. Create the worktree first (create_worktree) if none exists. Not for Jarvis, not for a session already in a worktree. The user is asked to confirm in the app.',
      inputSchema: schema({
        session: SESSION_PROP,
        worktree: { type: 'string', description: 'Worktree name, branch or id (see list_repos).' }
      }, ['session', 'worktree']),
      run: async (args) => {
        const data = deps.getData()
        const session = resolveSession(data, args.session)
        const worktree = resolveWorktree(data, text(args, 'worktree'))
        if (session.worktreeId !== undefined) throw new Error(`"${session.name}" is already a Code session. Only an Ops session can move to Code mode.`)
        const yes = await deps.confirm({ title: 'Jarvis: move session to Code mode', message: `Jarvis wants to move “${session.name}” into worktree “${worktree.name}” (${worktree.path}). It restarts there with a new conversation; the old one does not come along.`, confirmLabel: 'Move' })
        if (!yes) return 'The user declined: the session was not moved.'
        const before = { cwd: session.cwd, groupId: session.groupId }
        const moved = deps.controller.moveToWorktree(session.id, worktree.id)
        pushUndo(`move "${session.name}" back to Ops (${before.cwd}; a new conversation again)`, () => { deps.controller.moveToOps(session.id, before.cwd, before.groupId) })
        deps.log('move_session_to_code', `${session.name} -> ${worktree.name}`)
        return `Moved "${moved.name}" into worktree "${worktree.name}". It runs in ${worktree.path} on a new conversation (it is listed in Code mode now).`
      }
    },
    {
      name: 'set_session_model',
      description: "Changes the model of an OpenCode or Cursor session. OpenCode: provider/model, like opencode/deepseek-v4.1-flash-free. Cursor: a plain model name like gpt-5 or sonnet-4-thinking. A running session keeps its conversation: it is restarted on the new model (same conversation). A sleeping, stopped or closed one gets the model for its next start. Claude sessions and shell sessions have no per-session model.",
      inputSchema: schema({
        session: SESSION_PROP,
        model: { type: 'string', description: "OpenCode: provider/model, like opencode/deepseek-v4.1-flash-free. Cursor: a plain name, like gpt-5. An empty string goes back to the agent's default model." }
      }, ['session', 'model']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const agent = agentOf(session)
        if (agent === 'shell') throw new Error(`"${session.name}" is a shell session: it has no model.`)
        if (agent === 'claude') {
          throw new Error(`"${session.name}" is a Claude session: its model is a launch setting (Settings > Agents, or the session's own launch), not a per-session one. Only OpenCode and Cursor sessions can change model here.`)
        }
        // An empty string puts the session back on the agent's own default model; a missing argument is still an error.
        const given = typeof args.model === 'string' ? args.model.trim() : text(args, 'model').trim()
        const model = given.length === 0 ? undefined : given
        // D81: Cursor takes a plain model name, not OpenCode's provider/model.
        if (model === undefined) {
          // Clearing needs no check.
        } else if (agent === 'cursor') {
          if (!isCursorModel(model)) {
            throw new Error(`"${model}" is not a Cursor model name: use letters, digits and . _ : / @ - only, like gpt-5 or sonnet-4-thinking.`)
          }
        } else {
          const problem = sessionModelProblem(model)
          if (problem !== null) throw new Error(problem)
        }
        const result = deps.controller.setOpencodeModel(session.id, model)
        pushUndo(`change the model of "${session.name}" (put the old one back)`, () => {
          deps.controller.setOpencodeModel(session.id, session.model ?? undefined)
        })
        const shown = model ?? "the agent's default model"
        deps.log('set_session_model', `${session.name}: ${session.model ?? '(default)'} -> ${model ?? '(default)'}`)
        if (result === 'restarted') return `"${session.name}" now runs ${shown}; its conversation was restarted on it.`
        if (result === 'restart-failed') return `"${session.name}" now uses ${shown}, but it could not be started again: it is asleep and starts on ${shown} when you wake it (wake_session).`
        return `"${session.name}" now uses ${shown}; it starts on it the next time (${stateText(session, deps.getRuntime(session.id))}).`
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
      name: 'list_repos',
      description: 'Code mode: lists the git repositories added to SessionDeck, their worktrees (branch, folder, sessions) and the local branches of each repo.',
      inputSchema: schema({}),
      run: async () => {
        const data = deps.getData()
        const repos = data.repos ?? []
        if (repos.length === 0) return 'No repositories yet. Add one with add_repo.'
        const lines: string[] = []
        for (const repo of repos) {
          let branchText = ''
          try {
            const b = await deps.code.branches(repo.id)
            branchText = ` · current branch ${b.current ?? '(detached)'} · branches: ${b.branches.slice(0, 20).join(', ')}${b.branches.length > 20 ? ', …' : ''}`
          } catch (error) {
            branchText = ` · branches unavailable (${error instanceof Error ? error.message : String(error)})`
          }
          lines.push(`- repo "${repo.name}" (id ${repo.id}) · ${repo.path}${branchText}`)
          for (const w of (data.worktrees ?? []).filter((x) => x.repoId === repo.id)) {
            const sessions = data.sessions.filter((s) => s.worktreeId === w.id).map((s) => `"${s.name}"`)
            lines.push(`  - ${w.main === true ? 'repo folder' : 'worktree'} "${w.name}" (id ${w.id}) · branch ${w.branch}${w.main === true ? '' : ` from ${w.baseBranch}`} · ${w.path} · sessions: ${sessions.join(', ') || '(none)'}`)
          }
        }
        return lines.join('\n')
      }
    },
    {
      name: 'add_repo',
      description: 'Code mode: adds a git repository (any folder inside it) so worktrees can be created from it.',
      inputSchema: schema({ folder: { type: 'string', description: 'Full path of the repository or a folder inside it.' } }, ['folder']),
      run: async (args) => {
        const repo = await deps.code.addRepo(resolveFolder(text(args, 'folder')))
        deps.log('add_repo', repo.path)
        return `Added repository "${repo.name}" (${repo.path}).`
      }
    },
    {
      name: 'create_worktree',
      description: 'Code mode: creates a workspace in a repository and starts a session in it (optionally with a first prompt). Default: a new branch + git worktree named after "name" (a taken name gets -2, -3 ...). existing_branch: open a local branch you already have in its own worktree (refused when it is open in another worktree; git allows one). repo_folder=true: use the repository folder itself, on its checked-out branch (once per repo; nothing is created).',
      inputSchema: schema({
        repo: { type: 'string', description: 'Repository name, path or id (see list_repos).' },
        name: { type: 'string', description: `Worktree name, 1 to ${WORKTREE_NAME_MAX} characters, e.g. "login fix". Default: the branch name (existing_branch) or the repo name (repo_folder).` },
        existing_branch: { type: 'string', description: 'Open this existing local branch instead of creating one.' },
        repo_folder: { type: 'boolean', description: 'Use the repository folder itself.' },
        base_branch: { type: 'string', description: 'Local branch to start from (default: the branch checked out in the repo).' },
        agent: { type: 'string', enum: ['claude', 'opencode', 'cursor', 'shell'], description: 'Default claude.' },
        model: { type: 'string', description: 'OpenCode (provider/model) or Cursor (a plain name) only.' },
        prompt: { type: 'string', description: 'First prompt, typed in when the session is ready.' },
        open: { type: 'boolean', description: 'Show the new session (default false).' }
      }, ['repo']),
      run: async (args) => {
        const data = deps.getData()
        const repo = resolveRepo(data, text(args, 'repo'))
        const existing = optionalText(args, 'existing_branch')?.trim()
        const repoFolder = optionalBool(args, 'repo_folder') === true
        if (existing !== undefined && repoFolder) throw new Error('Give existing_branch or repo_folder, not both.')
        const name = (optionalText(args, 'name') ?? (repoFolder ? repo.name : existing) ?? '').trim()
        if (name.length === 0) throw new Error('"name" is required for a new branch.')
        const agentArg = optionalText(args, 'agent') ?? 'claude'
        if (!['claude', 'opencode', 'cursor', 'shell'].includes(agentArg)) throw new Error('"agent" must be claude, opencode, cursor or shell.')
        const branches = await deps.code.branches(repo.id)
        if (existing !== undefined && !branches.branches.includes(existing)) throw new Error(`No local branch "${existing}" in "${repo.name}". Branches: ${branches.branches.join(', ')}`)
        const busy = existing === undefined ? undefined : branches.checkedOut?.find((c) => c.branch === existing)
        if (busy !== undefined) throw new Error(`Branch "${existing}" is already open in ${busy.path}. Git allows a branch in one worktree only: use that workspace, or another branch.`)
        const defaultBase = existing !== undefined && branches.current === existing ? branches.branches.find((b) => b !== existing) ?? existing : branches.current
        const base = optionalText(args, 'base_branch')?.trim() ?? defaultBase
        if (base === null) throw new Error(`"${repo.name}" has no branch checked out (detached HEAD). Say which base_branch to use: ${branches.branches.join(', ')}`)
        if (!branches.branches.includes(base)) throw new Error(`No local branch "${base}" in "${repo.name}". Branches: ${branches.branches.join(', ')}`)
        const model = agentArg === 'opencode' || agentArg === 'cursor' ? optionalText(args, 'model') : undefined
        if (agentArg === 'cursor' && model !== undefined && !isCursorModel(model.trim())) {
          throw new Error(`"${model}" is not a Cursor model: use a plain name like gpt-5 or sonnet-4-thinking.`)
        }
        const { worktree, session } = await deps.code.createWorktree({
          repoId: repo.id, name, baseBranch: base, agent: agentArg as AgentKind,
          ...(repoFolder ? { source: 'main' as const } : existing !== undefined ? { source: 'existing' as const, branch: existing } : {}),
          ...(model !== undefined ? { model } : {})
        })
        deps.log('create_worktree', `${repo.name}: ${worktree.name} (${worktree.branch})${repoFolder ? ' repo folder' : existing !== undefined ? ' existing branch' : ''}`)
        if (optionalBool(args, 'open') === true) deps.openSession(session.id)
        const created = repoFolder
          ? `Opened the repository folder ${worktree.path} (branch ${worktree.branch}) as "${worktree.name}", with session "${session.name}" (id ${session.id}).`
          : existing !== undefined
            ? `Opened branch ${worktree.branch} in worktree "${worktree.name}" at ${worktree.path} (changes against ${base}), with session "${session.name}" (id ${session.id}).`
            : `Created worktree "${worktree.name}" on branch ${worktree.branch} (from ${base}) at ${worktree.path}, with session "${session.name}" (id ${session.id}).${worktree.name !== name ? ` ("${name}" was taken, so it is "${worktree.name}".)` : ''}`
        const prompt = optionalText(args, 'prompt')
        return prompt === undefined ? created : `${created} ${await sendPrompt(session, prompt, 'auto')}`
      }
    },
    {
      name: 'worktree_changes',
      description: 'Code mode: what changed in a worktree compared with its base branch: each file (added/modified/deleted/renamed) with lines added and removed, and the totals.',
      inputSchema: schema({ worktree: { type: 'string', description: 'Worktree name, branch or id.' }, max_files: { type: 'integer', description: `Default ${CHANGES_LIST_DEFAULT}.` } }, ['worktree']),
      run: async (args) => {
        const worktree = resolveWorktree(deps.getData(), text(args, 'worktree'))
        const result = await deps.code.changes(worktree.id)
        if (result.error !== undefined) throw new Error(`Could not read the changes of "${worktree.name}": ${result.error}`)
        const max = optionalInt(args, 'max_files', CHANGES_LIST_DEFAULT, 500)
        const count = (n: number | null): string => (n === null ? '?' : String(n))
        const lines = result.files.slice(0, max).map((f) => `- ${f.kind} ${f.oldPath !== undefined ? `${f.oldPath} -> ` : ''}${f.path} (+${count(f.additions)} -${count(f.deletions)})${f.uncommitted === true ? ' uncommitted' : ''}`)
        const more = result.files.length > max || result.truncated ? '\n(more files not shown)' : ''
        return `"${worktree.name}" (branch ${worktree.branch} vs ${worktree.baseBranch}): ${result.files.length}${result.truncated ? '+' : ''} file(s), +${result.additions} -${result.deletions}.\n${lines.join('\n') || '(no changes)'}${more}`
      }
    },
    {
      name: 'remove_worktree',
      description: 'Code mode: PERMANENTLY removes a worktree from SessionDeck with all its sessions. By default the folder and branch stay on disk; delete_from_disk also deletes the folder (git worktree remove) and its branch (D60; never the repository folder). Uncommitted files block that unless discard_changes; a branch with commits the base lacks is kept unless delete_unmerged_branch. The user is asked to confirm.',
      inputSchema: schema({
        worktree: { type: 'string', description: 'Worktree name, branch or id.' },
        delete_from_disk: { type: 'boolean' },
        discard_changes: { type: 'boolean' },
        delete_unmerged_branch: { type: 'boolean' }
      }, ['worktree']),
      run: async (args) => {
        const worktree = resolveWorktree(deps.getData(), text(args, 'worktree'))
        const count = deps.getData().sessions.filter((s) => s.worktreeId === worktree.id).length
        const fromDisk = optionalBool(args, 'delete_from_disk') === true
        const options = {
          deleteFromDisk: fromDisk,
          discardChanges: optionalBool(args, 'discard_changes') === true,
          deleteUnmergedBranch: optionalBool(args, 'delete_unmerged_branch') === true
        }
        let what = 'The folder on disk is kept.'
        if (fromDisk) {
          if (worktree.main === true) throw new Error('This worktree is the repository folder itself; it is never deleted from disk. Remove it without delete_from_disk.')
          const info = await deps.code.git.removalInfo(worktree.id)
          if (info.uncommitted > 0 && !options.discardChanges) throw new Error(`"${worktree.name}" has ${info.uncommitted} uncommitted file(s). Commit them, or pass discard_changes after the user agreed to lose them.`)
          what = `Its folder ${worktree.path} is DELETED${info.uncommitted > 0 ? ` with ${info.uncommitted} uncommitted file(s)` : ''}, and branch ${worktree.branch} ${info.branchMerged || options.deleteUnmergedBranch ? `is deleted${info.branchMerged ? '' : ' although it has commits ' + worktree.baseBranch + ' lacks'}` : 'is kept (it has commits ' + worktree.baseBranch + ' lacks)'}.`
        }
        const yes = await deps.confirm({ title: 'Jarvis: remove worktree', message: `Jarvis wants to remove worktree “${worktree.name}” and its ${count} session(s) from SessionDeck. ${what}`, confirmLabel: fromDisk ? 'Delete' : 'Remove' })
        if (!yes) return `The user did not allow removing worktree "${worktree.name}". Nothing was changed.`
        if (!fromDisk) {
          deps.code.removeWorktree(worktree.id)
          deps.log('remove_worktree', worktree.name)
          return `Worktree "${worktree.name}" was removed.`
        }
        const result = await deps.code.git.remove(worktree.id, options)
        deps.log('remove_worktree', `${worktree.name} (from disk: folder ${result.folderDeleted ? 'deleted' : 'kept'}, branch ${result.branchDeleted ? 'deleted' : 'kept'})`)
        return `Worktree "${worktree.name}" was removed. Folder ${result.folderDeleted ? 'deleted' : 'kept'}, branch ${result.branchDeleted ? 'deleted' : 'kept'}.${result.note !== undefined ? ' ' + result.note : ''}`
      }
    },
    {
      name: 'schedule_add',
      description: 'Schedules an instruction for YOU (Jarvis) at a local time, every day, on some weekdays, or once. At that time SessionDeck gives you the instruction as a message and you carry it out with your tools. Example: time "09:00", days "weekdays", instruction "wake API and send it \'pull and run the tests\'". The app must be running at that time.',
      inputSchema: schema({
        instruction: { type: 'string', description: 'What to do then, in plain words, complete enough to act on alone.' },
        time: { type: 'string', description: 'HH:MM, 24-hour, local time.' },
        days: { description: 'Omit or "every day"; "weekdays"; "weekends"; or day names like ["mon","wed"].' },
        once: { type: 'boolean', description: 'Run only once (the next time it comes).' },
        label: { type: 'string', description: 'Short name for the list.' }
      }, ['instruction', 'time']),
      run: async (args) => {
        const added = deps.schedules.add({
          instruction: text(args, 'instruction'),
          time: text(args, 'time'),
          days: args.days,
          once: optionalBool(args, 'once') === true,
          ...(optionalText(args, 'label') !== undefined ? { label: optionalText(args, 'label') as string } : {})
        })
        deps.log('schedule_add', `${scheduleWhen(added)}: ${clip(added.instruction, 80)}`)
        pushUndo(`schedule ${scheduleWhen(added)} (remove it)`, () => {
          deps.schedules.remove(added.id)
        })
        const next = nextRun(added, deps.now())
        return `Scheduled (id ${added.id}) ${scheduleWhen(added)}: "${added.instruction}".${next !== null ? ` Next run ${new Date(next).toLocaleString()}.` : ''}`
      }
    },
    {
      name: 'schedule_list',
      description: 'Lists the scheduled instructions: when, what, whether paused, last and next run.',
      inputSchema: schema({}),
      run: async () => {
        const list = deps.schedules.list()
        if (list.length === 0) return 'No schedules.'
        const now = deps.now()
        return list.map((s) => {
          const next = s.enabled ? nextRun(s, now) : null
          const state = !s.enabled ? (s.once && s.lastRunAt !== null ? 'done' : 'paused') : next !== null ? `next ${new Date(next).toLocaleString()}` : 'no next run'
          const last = s.lastRunAt !== null ? ` · last ran ${minutesAgo(now, s.lastRunAt)}` : ''
          return `- (id ${s.id})${s.label ? ` "${s.label}"` : ''} ${scheduleWhen(s)} · ${state}${last} · "${clip(s.instruction, 120)}"`
        }).join('\n')
      }
    },
    {
      name: 'schedule_remove',
      description: 'Removes a scheduled instruction (by id, or by its label).',
      inputSchema: schema({ schedule: { type: 'string', description: 'Schedule id or label.' } }, ['schedule']),
      run: async (args) => {
        const ref = text(args, 'schedule').trim()
        const list = deps.schedules.list()
        const matches = list.filter((s) => s.id === ref || (s.label.length > 0 && s.label.toLowerCase() === ref.toLowerCase()))
        if (matches.length === 0) throw new Error(`No schedule matches "${ref}". Use schedule_list to see the ids.`)
        if (matches.length > 1) throw new Error(`"${ref}" matches ${matches.length} schedules; pass the id.`)
        const removed = deps.schedules.remove(matches[0].id)
        deps.log('schedule_remove', `${scheduleWhen(removed)}: ${clip(removed.instruction, 80)}`)
        pushUndo(`remove the schedule ${scheduleWhen(removed)} (add it back)`, () => {
          const back = deps.schedules.add({ instruction: removed.instruction, time: timeText(removed.minutes), days: removed.days.map((d) => DAY_NAMES[d]), once: removed.once, label: removed.label })
          if (!removed.enabled) deps.schedules.setEnabled(back.id, false)
        })
        return `Removed the schedule ${scheduleWhen(removed)}: "${removed.instruction}".`
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
        pushUndo(`rename "${session.name}" to "${name}" (name it back)`, () => deps.store.renameSession(session.id, session.name))
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
        pushUndo(`set the status of "${session.name}" (put the old one back)`, () => {
          const old = deps.getData().statuses.some((st) => st.id === session.statusId) ? session.statusId : null
          deps.store.setSessionStatus(session.id, old)
        })
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
        const oldIndex = Math.max(0, indexInGroup(session))
        deps.store.moveSession(session.id, group?.id ?? null, index)
        pushUndo(`move "${session.name}" (move it back)`, () => {
          const oldGroup = session.groupId !== null && deps.getData().groups.some((g) => g.id === session.groupId) ? session.groupId : null
          deps.store.moveSession(session.id, oldGroup, oldIndex)
        })
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
        pushUndo(`create group "${group.name}" (delete it; its sessions become ungrouped)`, () => deps.store.removeGroup(group.id))
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
        pushUndo(`change the notes of "${session.name}" (restore them)`, () => deps.store.setSessionNotes(session.id, session.notes ?? ''))
        deps.log('set_notes', session.name)
        return `Updated the notes of "${session.name}".`
      }
    },
    {
      name: 'set_session_tags',
      description: `Replaces a session's tags (short labels on its card) with the given list; an empty list clears them. At most ${SESSION_TAGS_MAX} tags, each up to ${SESSION_TAG_MAX_LENGTH} characters; duplicates (case-insensitively, and a leading '#') are ignored by the store. Undoable with undo_last_action.`,
      inputSchema: schema({ session: SESSION_PROP, tags: { type: 'array', items: { type: 'string' }, description: `Tags to set, max ${SESSION_TAGS_MAX}, each max ${SESSION_TAG_MAX_LENGTH} characters.` } }, ['session', 'tags']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const raw = args.tags
        if (!Array.isArray(raw) || raw.some((tag) => typeof tag !== 'string')) throw new Error('"tags" must be an array of strings.')
        const tags = raw.filter((tag): tag is string => typeof tag === 'string')
        if (tags.length > SESSION_TAGS_MAX) throw new Error(`At most ${SESSION_TAGS_MAX} tags are allowed.`)
        if (tags.some((tag) => tag.trim().replace(/^#/, '').length > SESSION_TAG_MAX_LENGTH)) throw new Error(`A tag cannot be longer than ${SESSION_TAG_MAX_LENGTH} characters.`)
        const previous = session.tags ?? []
        deps.store.setSessionTags(session.id, tags)
        pushUndo(`change the tags of "${session.name}" (restore them)`, () => deps.store.setSessionTags(session.id, previous))
        deps.log('set_session_tags', `${session.name}: ${tags.join(', ')}`)
        return `Set the tags of "${session.name}" to ${tags.length > 0 ? tags.map((tag) => `"${tag}"`).join(', ') : '(none)'}.`
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
        pushUndo(`turn keep awake ${on ? 'on' : 'off'} for "${session.name}" (switch it back)`, () => deps.store.setKeepAwake(session.id, session.keepAwake === true))
        deps.log('set_keep_awake', `${session.name}: ${on}`)
        return `Keep awake is ${on ? 'on' : 'off'} for "${session.name}".`
      }
    },
    {
      name: 'undo_last_action',
      description: 'Undoes your last reversible action (sleep, wake, close, create session, rename, status, group, notes, tags, keep awake, model, create group, schedules), one step per call. Removals cannot be undone.',
      inputSchema: schema({}),
      run: async () => undoLast()
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
  // D55: the app-wide and on-screen tools share the undo stack and the prompt sender.
  const tool = (name: string): McpTool => {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) throw new Error(`No tool "${name}".`)
    return found
  }
  const ctx = { pushUndo, sendPrompt, tool }
  tools.push(...createAppTools(deps, ctx), ...createUiTools(deps), ...createControlTools(deps, ctx), ...createGitTools(deps))
  // D71: tuning the app for the PC it runs on: read the PC, then change the settings that matter (GPU, terminal, sidebar).
  const appLoad = (): ReturnType<JarvisSystemDeps['appLoad']> => {
    const open = deps.getData().sessions.filter((s) => s.closedAt === undefined && s.role !== 'jarvis')
    const states = open.map((s) => deps.getRuntime(s.id))
    return {
      sessionsOpen: open.length,
      sessionsRunning: states.filter((state) => state?.run === 'running').length,
      sessionsWorking: states.filter((state) => state?.run === 'running' && state.activity === 'working').length
    }
  }
  tools.push(...createSystemTools({ ...deps.system, appLoad }, deps.log), ...createPrefsTools(deps, ctx), ...createLayoutTools(deps, ctx), ...createPanelTools(deps, ctx), ...createDigestTools(deps, ctx))
  return Object.assign(tools, { sendPrompt, undoLast })
}
