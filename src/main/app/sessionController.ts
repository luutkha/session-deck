import type { AttentionReason, HookEvent, Id, Session, CreateSessionInput, ShellKind } from '../../shared/types'
import { SESSION_MODEL_MAX, SESSION_MODEL_RE } from '../../shared/types'
import { errorMessage } from '../../shared/guards'
import { execFile } from 'node:child_process'
import type { ActiveSessions } from './activeSessions'
import { SessionStore } from '../store'
import { PtyManager, type StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention'
import type { RuntimeRegistry } from './runtimeRegistry'
import { shouldFallbackToNew, shouldRotateSessionId, REPLAY_TAIL_CHARS } from './claudeLaunch'
import { transcriptExists } from './transcript'
import { randomUUID } from 'node:crypto'
import { buildStartOptions, validateCwd, type LaunchExtras } from './startOptions'
import { STOPPING_ERROR_PREFIX } from './retryWhileStopping'
import { logMainError } from './errorLog'
import { activityFromHook, type ActivitySnapshot } from './activity'
import { detectOutputSignals, findUsageLimitLine, stripAnsi } from './outputSignals'
import { appendTrustBuffer, isTrustPrompt, shouldAnswerTrustPrompt, TRUST_ANSWER_DELAY_MS, TRUST_ANSWER_KEYS, TRUST_KEY_GAP_MS } from './trustPrompt'
import { createAutoStatusApplier } from '../automation/applyAutoStatus'
import { opencodePluginHealth, isOpencodeUsageLimit, OPENCODE_PLUGIN_HEALTH_GRACE_MS } from '../opencode/health'
import { listOpencodeSessions, pickSessionToAdopt } from '../opencode/sessions'
import { isSessionExport, parseImportedSessionId, pickNewSessionId, remapExportIds, writeForkFile } from '../opencode/fork'
import { isCursorChatId } from '../store/cursorValues'

const MAX_FALLBACK_ATTEMPTS = 1
/** Session names are at most 100 characters (store rule). */
const MAX_FORK_NAME = 100
/**
 * D79: the `opencode` runner serves the read-only session list and the fork's export/import. A hung CLI must never
 * hold a launch hostage (the list runs in the background), but a long conversation's export/import needs more than
 * the list does, so the limit is generous and only these rare calls ever wait for it.
 */
const OPENCODE_RUN_TIMEOUT_MS = 30_000
const OPENCODE_RUN_MAX_BUFFER = 20 * 1024 * 1024
/** D79 usage-limit scan: the last lines of the screen, like the Claude detector's tail. */
const OPENCODE_LIMIT_SCAN_LINES = 25
const OPENCODE_LIMIT_TAIL_CHARS = 8000

/** A shell-safe token: ids, flags and model ids need no quotes; anything else is quoted defensively. */
function shellToken(token: string): string {
  return /^[A-Za-z0-9_./:=@\\-]+$/.test(token) ? token : `"${token.replace(/"/g, '""')}"`
}

/**
 * Runs `opencode <args>` (read-only session list, and the fork's export/import, D79). Resolved like capabilities.ts:
 * `opencode.cmd` on Windows needs the shell, and the arguments are always an internal array (never user text). On
 * Windows the command line is built here from those tokens, each quoted, so a temp path with a space survives.
 * `cwd` matters: `opencode session list` lists the project of the folder it runs in.
 */
function defaultOpencodeRun(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject): void => {
    try {
      const shell = process.platform === 'win32'
      const file = shell ? ['opencode', ...args.map(shellToken)].join(' ') : 'opencode'
      execFile(
        file,
        shell ? [] : args,
        {
          ...(cwd !== undefined ? { cwd } : {}),
          shell,
          timeout: OPENCODE_RUN_TIMEOUT_MS,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: OPENCODE_RUN_MAX_BUFFER
        },
        (error, stdout): void => {
          if (error !== null) {
            reject(error)
            return
          }
          resolve(typeof stdout === 'string' ? stdout : '')
        }
      )
    } catch (error) {
      reject(error)
    }
  })
}

/** D79: what a model change needed: a restart of the live conversation, or only its next start. */
export type OpencodeModelResult = 'restarted' | 'next-start' | 'restart-failed'

/**
 * D79: null when `model` is a usable model id for one OpenCode session, otherwise a one-line reason. The rule is
 * narrower than the config-file rule (`isOpencodeModel`): a model given in a chat command is spelled plainly and can
 * never look like a CLI flag.
 */
export function sessionModelProblem(model: string): string | null {
  if (model.length === 0) return 'The model is empty: give provider/model, like opencode/deepseek-v4.1-flash-free.'
  if (model.startsWith('-')) return `"${model}" looks like a command flag, not a model. Give provider/model, like opencode/deepseek-v4.1-flash-free.`
  if (model.length > SESSION_MODEL_MAX) return `The model id is too long (max ${SESSION_MODEL_MAX} characters).`
  if (!SESSION_MODEL_RE.test(model)) {
    return `"${model}" is not a model id: only letters, digits, ".", "-", "_", "/" and ":" are allowed.`
  }
  return null
}

/** D52/D79: "<name> (fork)", within the store's 100-character session name limit. */
function forkName(name: string): string {
  const fork = `${name} (fork)`
  return fork.length <= MAX_FORK_NAME ? fork : `${name.slice(0, MAX_FORK_NAME - 7)} (fork)`
}

interface SessionStartState {
  readonly everStartedThisRun: boolean
  readonly fallbackAttempts: number
  readonly startTime?: number
}

export interface SessionControllerDeps {
  readonly store: SessionStore
  readonly pty: PtyManager
  readonly attention: AttentionService
  readonly runtime: RuntimeRegistry
  readonly sendPtyData: (id: Id, data: string, seq: number) => void
  /** Directory of main-errors.log (see errorLog.ts). */
  readonly userDataDir: string
  /** Optional: the per-window "session on screen" map (index.ts). A removed session must not stay on screen. */
  readonly activeSessions?: Pick<ActiveSessions, 'remove'>
  /**
   * Called once per turn when a Claude session's screen shows Claude's usage-limit message. Only armed by a
   * UserPromptSubmit hook event in the running process, so a resumed session that redraws an old message is ignored.
   * D79: OpenCode sessions report through the same hook (the last screen lines are matched conservatively).
   */
  readonly onUsageLimit?: (id: Id) => void
  /** D79: runs `opencode <args>` in `cwd` (session list; fork export/import); tests inject a fake so no CLI is spawned. */
  readonly runOpencode?: (args: string[], cwd?: string) => Promise<string>
  /** D79: how long an OpenCode process may stay silent before its plugin is reported missing (tests shorten it). */
  readonly opencodeHealthGraceMs?: number
  /** D53/D54: what a session adds to its launch (Jarvis: Claude arguments or OpenCode config keys). */
  readonly launchExtras?: (session: Session) => LaunchExtras
}

export interface SessionController {
  createSession(input: CreateSessionInput): Session
  /**
   * D52: a new session on a copy of this session's conversation (same folder, group, args and worktree; name +
   * " (fork)"). Claude uses Claude's own `--fork-session`; an OpenCode conversation is COPIED through
   * `session export` / `session import` (D79), so it says "copy" and takes a moment. Throws for a shell session or one
   * with no saved conversation, and leaves no session behind on any failure.
   */
  forkSession(id: Id): Promise<Session>
  /**
   * D79: changes the OpenCode model of one session. A running conversation is put to sleep and woken on the new model
   * (it resumes with `-s`, so nothing is lost); a sleeping, stopped or closed one, or one with no conversation id yet,
   * only stores it for its next start. `undefined` clears it (OpenCode's own default). Throws for a Claude, shell or
   * unknown session, or a model id that is not `provider/model`.
   */
  setOpencodeModel(id: Id, model: string | undefined): OpencodeModelResult
  removeSession(id: Id): void
  /** Code mode: stops and removes every session of the worktree, then the worktree (the folder is not touched). */
  removeWorktree(id: Id): void
  /** Code mode: removes each worktree of the repo (with its sessions), then the repo itself. */
  removeRepo(id: Id): void
  /** Stops the process, marks the session closed (keeps conversation id). */
  closeSession(id: Id): void
  /** Clears closed and starts the session with `--resume`. Throws if the folder is missing (session stays open, exited). */
  reopenSession(id: Id): void
  restartSession(id: Id): Promise<void>
  /** No-op for an unknown or non-running session. Input is recorded for attention only for known sessions. */
  writeToPty(id: Id, data: string): void
  /** No-op for an unknown or non-running session. */
  resizePty(id: Id, cols: number, rows: number): void
  /** Puts a running session to sleep: stops its process, keeps the card and conversation. No-op otherwise. */
  sleepSession(id: Id): void
  /**
   * Starts a sleeping session again the way activation does (same `--resume` path). Does not change the active session.
   * Returns true when the wake was started; false for an unknown, closed or non-sleeping session, or when the process
   * could not start (the error is logged).
   */
  wakeSession(id: Id): boolean
  /**
   * D50: starts an open, stopped session in the background (same `--resume` path as activation) without changing the
   * active session. Returns true when a start was attempted; false for an unknown, closed or already running session,
   * or when the start failed (logged).
   */
  resumeInBackground(id: Id): boolean
  setActiveSession(id: Id | null): void
  getActiveSessionId(): Id | null
  initializeRestoredSessions(): void
  /** A Claude Code / Cursor hook event: updates the session's activity and, on a change, its auto status. Never throws. */
  handleHookEvent(event: HookEvent): void
  /** D81: the text of the last Cursor reply (its `afterAgentResponse` hook), or null when none arrived this run. */
  lastCursorAnswer(id: Id): string | null
  /**
   * D79: where one-line notices go (the app's banner). The wiring sets it; notices are advisory and never errors.
   */
  setNoticeHandler(handler: (message: string) => void): void
}

function getOutputTail(pty: PtyManager, sessionId: Id): string {
  // Terminal escape codes can split the words of an error message, so match against the plain text.
  const text = stripAnsi(pty.replay(sessionId).data)
  return text.length <= REPLAY_TAIL_CHARS ? text : text.slice(-REPLAY_TAIL_CHARS)
}

export function createSessionController(deps: SessionControllerDeps): SessionController {
  const { store, pty, attention, runtime, sendPtyData, userDataDir } = deps

  let activeId: Id | null = null
  const startState = new Map<Id, SessionStartState>()
  let initialized = false
  const restoredWithoutClaudeSessionId = new Set<Id>()
  const runOpencode = deps.runOpencode ?? defaultOpencodeRun
  const healthGraceMs =
    deps.opencodeHealthGraceMs !== undefined && Number.isFinite(deps.opencodeHealthGraceMs) && deps.opencodeHealthGraceMs >= 0
      ? deps.opencodeHealthGraceMs
      : OPENCODE_PLUGIN_HEALTH_GRACE_MS

  // D79: one entry per running OpenCode process (reset on every start), plus the screen tail used for the
  // conservative usage-limit scan.
  interface OpencodeHealthTrack {
    readonly startedAtMs: number
    sawPluginEvent: boolean
    timer: ReturnType<typeof setTimeout> | null
    recovering: boolean
    ambiguousNotified: boolean
  }
  const opencodeHealth = new Map<Id, OpencodeHealthTrack>()
  const opencodeLimitTail = new Map<Id, string>()
  const opencodeLimitSeen = new Map<Id, Set<string>>()
  // D81: Cursor has no transcript file: its last reply arrives through the afterAgentResponse hook and lives here
  // (dropped when the session is removed or closed for good).
  const cursorAnswers = new Map<Id, string>()
  let noticeHandler: ((message: string) => void) | null = null

  function notice(message: string): void {
    try {
      noticeHandler?.(message)
    } catch (error) {
      logMainError(userDataDir, 'session notice', error)
    }
  }

  function clearOpencodeHealth(id: Id): void {
    const track = opencodeHealth.get(id)
    if (track?.timer !== null && track?.timer !== undefined) clearTimeout(track.timer)
    opencodeHealth.delete(id)
    opencodeLimitTail.delete(id)
    opencodeLimitSeen.delete(id)
  }

  function resetOpencodeLimitScan(id: Id): void {
    opencodeLimitTail.delete(id)
    opencodeLimitSeen.delete(id)
  }

  function rescheduleHealth(id: Id, track: OpencodeHealthTrack, delayMs: number): void {
    track.timer = setTimeout(() => {
      track.timer = null
      if (opencodeHealth.get(id) !== track) return
      finishOpencodeHealth(id, track)
    }, delayMs)
    ;(track.timer as { unref?: () => void }).unref?.()
  }

  /** Starts the D79 health window for a fresh OpenCode process. */
  function beginOpencodeHealth(id: Id, startedAtMs: number): void {
    const previous = opencodeHealth.get(id)
    if (previous?.timer !== null && previous?.timer !== undefined) clearTimeout(previous.timer)
    const track: OpencodeHealthTrack = {
      startedAtMs,
      sawPluginEvent: false,
      timer: null,
      recovering: false,
      ambiguousNotified: false
    }
    opencodeHealth.set(id, track)
    rescheduleHealth(id, track, healthGraceMs)
  }

  /** Evaluates the health window: 'ok' once an event arrived, 'missing' after the grace period. */
  function finishOpencodeHealth(id: Id, track: OpencodeHealthTrack): void {
    const session = findSession(id)
    if (!session || session.agent !== 'opencode') {
      clearOpencodeHealth(id)
      return
    }
    const health = opencodePluginHealth({
      startedAtMs: track.startedAtMs,
      nowMs: Date.now(),
      sawPluginEvent: track.sawPluginEvent,
      graceMs: healthGraceMs
    })
    if (health === 'starting') {
      // The clock moved backwards (or the timer fired early): ask again after the window that is still left.
      rescheduleHealth(id, track, Math.max(0, track.startedAtMs + healthGraceMs - Date.now()))
      return
    }
    runtime.setOpencodePlugin(id, health)
    if (health === 'missing' && !session.opencodeSessionId) {
      void recoverOpencodeSessionId(id, track)
    }
  }

  /** A plugin event proves it loaded; the health window is over for this process. */
  function noteOpencodePluginEvent(id: Id): void {
    const track = opencodeHealth.get(id)
    if (track !== undefined) {
      track.sawPluginEvent = true
      if (track.timer !== null) {
        clearTimeout(track.timer)
        track.timer = null
      }
    }
    runtime.setOpencodePlugin(id, 'ok')
  }

  /**
   * D79: recovers the conversation id the plugin never reported, by listing OpenCode's sessions and adopting one
   * only when `pickSessionToAdopt` is sure. Never guesses (ambiguous = a notice, nothing stored), never blocks the
   * launch, and never runs for Claude or shell sessions.
   */
  async function recoverOpencodeSessionId(id: Id, track: OpencodeHealthTrack): Promise<void> {
    const session = findSession(id)
    if (!session || session.agent !== 'opencode' || session.opencodeSessionId !== undefined) return
    if (track.recovering) return
    track.recovering = true
    try {
      const sessions = await listOpencodeSessions(runOpencode, session.cwd)
      // The process may have exited, slept or been removed while the CLI ran; the plugin may have reported too.
      const current = findSession(id)
      if (!current || current.agent !== 'opencode' || current.opencodeSessionId !== undefined) return
      if (!pty.isRunning(id)) return
      const knownIds = new Set<string>()
      for (const other of store.get().sessions) {
        if (other.id !== id && other.opencodeSessionId !== undefined) knownIds.add(other.opencodeSessionId)
      }
      const pick = pickSessionToAdopt({
        cwd: current.cwd,
        startedAtMs: track.startedAtMs,
        knownIds,
        sessions
      })
      if (pick.kind === 'adopt') {
        try {
          store.setOpencodeSessionId(id, pick.id)
        } catch {
          // Same validation as the plugin's value: a pick it rejects is simply ignored.
        }
      } else if (pick.kind === 'ambiguous' && !track.ambiguousNotified) {
        track.ambiguousNotified = true
        notice(`OpenCode session "${current.name}": several conversations match this launch, so none was adopted.`)
      }
    } catch (error) {
      logMainError(userDataDir, `opencode session-id recovery ${id}`, error)
    } finally {
      track.recovering = false
    }
  }

  // Sessions with a turn submitted in the running process that has not reported the usage limit yet (edge trigger).
  const limitArmed = new Set<Id>()
  const applyAutoStatus = createAutoStatusApplier({
    store,
    onError: (where, error) => logMainError(userDataDir, where, error)
  })

  /** Launch options of a session, with the extra arguments of D53 (Jarvis). */
  function startOptions(session: Session, everStarted: boolean, forkFrom?: string): StartOptions {
    return buildStartOptions(session, everStarted, attention, shellProgram(), forkFrom, deps.launchExtras?.(session) ?? {})
  }

  function findSession(id: Id): Session | undefined {
    return store.get().sessions.find((s) => s.id === id)
  }

  function isClosed(id: Id): boolean {
    return findSession(id)?.closedAt !== undefined
  }

  /** A resumed Claude process exited early: retry once under a fresh id or as a new conversation. True when retried. */
  function handleExitWithFallback(sessionId: Id, runMs: number, exitCode: number | null): boolean {
    const state = startState.get(sessionId)
    if (!state) return false

    const session = findSession(sessionId)
    // The "no conversation" fallback and resume args are Claude-only; OpenCode, Cursor and shell sessions stay exited.
    if (!session || session.agent === 'opencode' || session.agent === 'cursor' || session.agent === 'shell' || !session.claudeSessionId) return false

    const outputTail = getOutputTail(pty, sessionId)
    if (
      state.fallbackAttempts < MAX_FALLBACK_ATTEMPTS &&
      shouldRotateSessionId({ mode: 'resume', runMs, exitCode, outputTail, hasTranscript: transcriptExists(session.claudeSessionId) })
    ) {
      // Never prompted, so nothing is lost: continue under a fresh conversation id.
      startState.set(sessionId, { ...state, fallbackAttempts: state.fallbackAttempts + 1 })
      store.setClaudeSessionId(sessionId, randomUUID())
      const rotated = findSession(sessionId) ?? session
      pty.restart(startOptions(rotated, false))
      runtime.markRunning(sessionId)
      return true
    }
    const fallback = shouldFallbackToNew({ mode: 'resume', runMs, exitCode, outputTail })

    if (fallback && state.fallbackAttempts < MAX_FALLBACK_ATTEMPTS) {
      startState.set(sessionId, { ...state, fallbackAttempts: state.fallbackAttempts + 1 })
      pty.restart(startOptions(session, false))
      runtime.markRunning(session.id)
      return true
    }

    return false
  }

  // W6 trust auto-answer: armed only for a pty started with a FRESH conversation in a Code worktree. The buffer keeps
  // enough recent output for the menu to be recognised even when the TUI splits it across writes.
  const trustFirstStart = new Set<Id>()
  const trustAnswered = new Set<Id>()
  const trustBuffer = new Map<Id, string>()

  function forgetTrustPrompt(id: Id): void {
    trustFirstStart.delete(id)
    trustAnswered.delete(id)
    trustBuffer.delete(id)
  }

  function maybeAutoAnswerTrustPrompt(id: Id, data: string): void {
    if (!trustFirstStart.has(id)) return
    const buffer = appendTrustBuffer(trustBuffer.get(id) ?? '', data)
    trustBuffer.set(id, buffer)
    if (trustAnswered.has(id)) return
    const session = findSession(id)
    if (!session || isClosed(id) || !isTrustPrompt(buffer)) return
    const allowed = shouldAnswerTrustPrompt({
      enabled: store.getSettings().code.autoTrustWorktrees,
      agent: session.agent,
      worktreeId: session.worktreeId,
      jarvis: session.role === 'jarvis',
      firstStart: true,
      answered: false
    })
    if (!allowed) return
    trustAnswered.add(id)
    pressTrustKey(id, 0)
  }

  /** Types the answer one key at a time; stops when the process ended or restarted (its trust state was cleared). */
  function pressTrustKey(id: Id, index: number): void {
    const key = TRUST_ANSWER_KEYS[index]
    if (key === undefined) return
    setTimeout(() => {
      if (!trustAnswered.has(id) || !pty.isRunning(id)) return
      try {
        pty.write(id, key)
      } catch (error) {
        logMainError(userDataDir, 'trust prompt auto-answer', error)
        return
      }
      pressTrustKey(id, index + 1)
    }, index === 0 ? TRUST_ANSWER_DELAY_MS : TRUST_KEY_GAP_MS)
  }

  // Remote Control: a Claude process driven from claude.ai/code or the phone gets no local keystrokes, so two facts
  // are read off its screen instead: that Remote Control is on (keeps the session awake) and that a turn is running
  // again after a question was answered remotely (hooks only report the next Stop).
  function readScreenSignals(id: Id, data: string): void {
    const agent = findSession(id)?.agent
    if (agent === 'shell') return
    if (agent === 'opencode') {
      readOpencodeUsageLimit(id, data)
      return
    }
    // Cursor reports through its own hooks; Claude's screen parser (Remote Control, usage-limit wording) does not apply.
    if (agent === 'cursor') return
    const signals = detectOutputSignals(data)
    if (signals.usageLimit) reportUsageLimit(id, data)
    if (signals.remoteControl && runtime.get(id)?.remoteControl !== true) {
      runtime.setRemoteControl(id, true)
      // Remote Control is only useful while the process lives, so pin the session awake. Only on the moment it turns
      // on, so a user who clears Keep awake while still connected is not overridden by the next footer redraw.
      store.setKeepAwake(id, true)
    }
    if (signals.working && runtime.get(id)?.activity === 'needs-input') {
      attention.clear(id)
      runtime.setActivity(id, 'working', null, Date.now())
      applyAutoStatus(id, 'working')
    }
  }

  /**
   * D79: OpenCode has no screen parser for status, but a plan/provider limit must still reach the autopilot. Only
   * the last screen lines are checked, with the conservative `isOpencodeUsageLimit` wording, and the same message
   * is reported once (resetting on a new prompt or process) so a redrawn limit banner cannot spam the hook.
   */
  function readOpencodeUsageLimit(id: Id, data: string): void {
    const combined = (opencodeLimitTail.get(id) ?? '') + stripAnsi(data)
    const tail = combined.length <= OPENCODE_LIMIT_TAIL_CHARS ? combined : combined.slice(-OPENCODE_LIMIT_TAIL_CHARS)
    opencodeLimitTail.set(id, tail)
    const lines = tail.split(/\r?\n/).slice(-OPENCODE_LIMIT_SCAN_LINES)
    const text = lines.join('\n')
    if (!isOpencodeUsageLimit(text)) return
    if (isClosed(id)) return
    const matchingLines = lines.filter((line) => isOpencodeUsageLimit(line)).map((line) => line.trim())
    const seen = opencodeLimitSeen.get(id) ?? new Set<string>()
    if (matchingLines.every((line) => seen.has(line))) return
    for (const line of matchingLines) seen.add(line)
    opencodeLimitSeen.set(id, seen)
    captureUsageLimitWording(text)
    try {
      deps.onUsageLimit?.(id)
    } catch (error) {
      logMainError(userDataDir, 'usage limit report', error)
    }
  }

  // Once per turn: the limit message stays on screen while the turn is cut off, so later chunks must not repeat it.
  function reportUsageLimit(id: Id, data: string): void {
    if (!limitArmed.has(id)) return
    limitArmed.delete(id)
    captureUsageLimitWording(data)
    try {
      deps.onUsageLimit?.(id)
    } catch (error) {
      logMainError(userDataDir, 'usage limit report', error)
    }
  }

  // The pattern list is known to be incomplete ("wording unverified"), so the first real match of this process is
  // written to main-errors.log: enough data to add the exact line later, at no risk and without a telemetry channel.
  let usageLimitWordingLogged = false
  function captureUsageLimitWording(data: string): void {
    if (usageLimitWordingLogged) return
    try {
      const line = findUsageLimitLine(data)
      if (line === null) return
      usageLimitWordingLogged = true
      logMainError(userDataDir, 'usage limit wording (add to USAGE_LIMIT_PATTERNS if new)', new Error(line))
    } catch (error) {
      usageLimitWordingLogged = true
      logMainError(userDataDir, 'usage limit wording', error)
    }
  }

  pty.onData((id: Id, data: string, seq: number) => {
    attention.noteOutput(id)
    try {
      readScreenSignals(id, data)
    } catch (error) {
      logMainError(userDataDir, 'screen signals', error)
    }
    try {
      maybeAutoAnswerTrustPrompt(id, data)
    } catch (error) {
      logMainError(userDataDir, 'trust prompt auto-answer', error)
    }
    sendPtyData(id, data, seq)
  })

  pty.onExit((id: Id, code: number | null) => {
    // The next process has no turn of its own until a prompt is submitted.
    limitArmed.delete(id)
    forgetTrustPrompt(id)
    clearOpencodeHealth(id)
    // A session removed from the store must not get a runtime entry or event back.
    if (!findSession(id)) {
      startState.delete(id)
      return
    }
    // A closed session stays "exited" with a null code (set by closeSession); its exit is not reported.
    if (isClosed(id)) return
    // A session put to sleep was killed on purpose: its exit is not a crash or a failed resume and must not
    // overwrite the sleeping state. The sleep path already cleared the start state, so nothing is resumed here.
    if (runtime.get(id)?.sleeping) {
      startState.delete(id)
      // The user opened it while the old process was still shutting down: wake it now that it is gone.
      if (wakeAfterExit.delete(id)) tryAutoStartSession(id)
      return
    }

    runtime.markExited(id, code)

    const state = startState.get(id)
    if (!state) return

    const startTime = state.startTime
    const runMs = startTime ? Date.now() - startTime : 0
    let fallbackHandled = false
    try {
      fallbackHandled = handleExitWithFallback(id, runMs, code)
    } catch (error) {
      // The automatic restart failed: the session stays exited and the error is recorded, not thrown into pty.
      startState.delete(id)
      runtime.markExited(id, null)
      logMainError(userDataDir, `automatic restart of session ${id}`, error)
      return
    }
    if (!fallbackHandled) {
      startState.delete(id)
    }
  })

  attention.onChange((id: Id, reason: string | null) => {
    runtime.setAttention(id, reason as AttentionReason | null)
  })

  /** The program a Shell session runs (Settings > Code). */
  function shellProgram(): ShellKind {
    return store.getSettings().code.shell
  }

  function ensureClaudeSessionId(session: Session): Session {
    // The Claude `--session-id` bookkeeping never applies to OpenCode, Cursor or shell sessions.
    if (session.agent === 'opencode' || session.agent === 'cursor' || session.agent === 'shell' || session.claudeSessionId) {
      return session
    }
    const newId = randomUUID()
    store.setClaudeSessionId(session.id, newId)
    return { ...session, claudeSessionId: newId }
  }

  /** D81: stores a Cursor chat id a hook reported (never throws; a rejected id is only logged). */
  function syncCursorChatId(session: Session, chatId: string | undefined): void {
    if (chatId === undefined || !isCursorChatId(chatId) || session.cursorChatId === chatId) return
    try {
      store.setCursorChatId(session.id, chatId)
    } catch (error) {
      logMainError(userDataDir, `cursor chat id ${session.id}`, error)
    }
  }

  /** Stores the OpenCode conversation id the plugin reported; nothing else (no activity, no auto status). */
  function handleAgentSessionEvent(event: HookEvent): void {
    const message = event.message
    if (message === undefined) return
    const session = findSession(event.sessionId)
    if (!session || session.agent !== 'opencode') return
    if (session.opencodeSessionId === message) return
    store.setOpencodeSessionId(session.id, message)
  }

  function startSession(session: Session, mode: 'new' | 'resume', forkFrom?: string): void {
    const sessionWithId = ensureClaudeSessionId(session)
    limitArmed.delete(sessionWithId.id)
    forgetTrustPrompt(sessionWithId.id)
    try {
      validateCwd(sessionWithId.cwd)
      // D81: install/refresh the Cursor hook bridge before the process starts. A failure (a broken hooks.json, a
      // read-only config folder) is logged and the session still starts: the hooks are a convenience, not a launch need.
      if (sessionWithId.agent === 'cursor') {
        try {
          attention.prepareCursor()
        } catch (error) {
          logMainError(userDataDir, 'cursor hooks', error)
        }
      }
      const state: SessionStartState = {
        everStartedThisRun: true,
        fallbackAttempts: 0,
        startTime: Date.now()
      }
      startState.set(sessionWithId.id, state)
      const opts: StartOptions = startOptions(sessionWithId, mode === 'resume', forkFrom)
      pty.start(opts)
      runtime.markRunning(sessionWithId.id)
      if (mode === 'new') trustFirstStart.add(sessionWithId.id)
      if (sessionWithId.agent === 'opencode') {
        beginOpencodeHealth(sessionWithId.id, state.startTime ?? Date.now())
        // D79: a resumed conversation whose id was lost can be found again in `opencode session list`.
        if (mode === 'resume' && sessionWithId.opencodeSessionId === undefined) {
          const track = opencodeHealth.get(sessionWithId.id)
          if (track !== undefined) void recoverOpencodeSessionId(sessionWithId.id, track)
        }
      }
    } catch (error) {
      startState.delete(sessionWithId.id)
      forgetTrustPrompt(sessionWithId.id)
      clearOpencodeHealth(sessionWithId.id)
      runtime.markExited(sessionWithId.id, null)
      throw error
    }
  }

  function initializeRestoredSessions(): void {
    if (initialized) return
    initialized = true

    const sessions = store.get().sessions
    for (const session of sessions) {
      if (session.agent === 'opencode' || session.agent === 'cursor' || session.agent === 'shell') {
        continue
      }
      if (!session.claudeSessionId) {
        restoredWithoutClaudeSessionId.add(session.id)
        ensureClaudeSessionId(session)
      }
    }
  }

  /** Sleeping sessions that were opened before their old process finished exiting. */
  const wakeAfterExit = new Set<Id>()

  function tryAutoStartSession(sessionId: Id): void {
    const session = findSession(sessionId)
    if (!session) return

    const state = startState.get(sessionId)
    if (state?.everStartedThisRun) return

    if (pty.isRunning(sessionId)) {
      if (runtime.get(sessionId)?.sleeping) wakeAfterExit.add(sessionId)
      return
    }

    try {
      validateCwd(session.cwd)
    } catch {
      runtime.markExited(sessionId, null)
      return
    }

    const wasRestoredWithoutId = restoredWithoutClaudeSessionId.has(sessionId)
    const sessionWithId = ensureClaudeSessionId(session)
    startSession(sessionWithId, wasRestoredWithoutId ? 'new' : 'resume')
  }

  /** Stops and forgets one session (process, attention, runtime, store). Shared by removeSession and worktree removal. */
  function removeSessionNow(id: Id): void {
    if (pty.isRunning(id)) {
      pty.kill(id)
    }
    forgetTrustPrompt(id)
    attention.forget(id)
    runtime.forget(id)
    store.removeSession(id)
    startState.delete(id)
    clearOpencodeHealth(id)
    cursorAnswers.delete(id)
    if (activeId === id) {
      activeId = null
    }
    // The removed session must not stay a window's "on screen" id (a ghost feeding isSessionOnScreen/sleep checks).
    deps.activeSessions?.remove(id)
  }

  /** Removes every session of a worktree, then the worktree. Unknown id = nothing to remove. */
  function removeWorktreeNow(id: Id): void {
    for (const session of store.get().sessions) {
      if (session.worktreeId === id) removeSessionNow(session.id)
    }
    store.removeWorktree(id)
  }

  /** Best effort: deletes the OpenCode conversation an import created when no SessionDeck session ended up using it. */
  async function deleteOrphanCopy(id: string): Promise<void> {
    try {
      await runOpencode(['session', 'delete', id])
    } catch {
      // Already gone or the CLI is unavailable: nothing more to do, the user can delete it in OpenCode.
    }
  }

  /**
   * D79: OpenCode has no true fork, so this is a COPY: export the conversation, import the JSON as a new OpenCode
   * session, then create the SessionDeck session on that new id (it resumes with `-s`, so it opens on the copy). Steps
   * that cannot be taken back are ordered so a failure leaves nothing behind: the SessionDeck session is created
   * last, and removed again if it cannot start. The temp file is always deleted (in a finally).
   */
  async function copyOpencodeSession(parent: Session): Promise<Session> {
    const sourceId = parent.opencodeSessionId
    if (sourceId === undefined) {
      throw new Error('Nothing to fork yet: this OpenCode session has no saved conversation. Send it a prompt first.')
    }
    validateCwd(parent.cwd)

    let exported: string
    try {
      exported = await runOpencode(['session', 'export', sourceId])
    } catch (error) {
      throw new Error(`Could not copy the OpenCode conversation: ${errorMessage(error)}`)
    }
    if (!isSessionExport(exported)) {
      throw new Error('Could not copy the OpenCode conversation: the CLI did not print session JSON.')
    }

    // Import keeps the ids of what it reads: without fresh ids it says "Session already exists" (or fails).
    const remapped = remapExportIds(exported)
    const file = await writeForkFile(remapped.json)
    let copyId: string | null
    try {
      const before = await listOpencodeSessions(runOpencode, parent.cwd)
      let output: string
      try {
        // In the session's own folder: a copy belongs to that project, and import takes the project from its folder.
        output = await runOpencode(['session', 'import', file.path], parent.cwd)
      } catch (error) {
        throw new Error(`Could not copy the OpenCode conversation: ${errorMessage(error)}`)
      }
      copyId = parseImportedSessionId(output)
      if (copyId === null && remapped.sessionId !== null && output.includes(remapped.sessionId)) copyId = remapped.sessionId
      if (copyId === null) {
        // Import does not always say which id it created: the one new row of this folder's list is the copy.
        copyId = pickNewSessionId(before, await listOpencodeSessions(runOpencode, parent.cwd), parent.cwd)
      }
    } finally {
      await file.cleanup()
    }
    if (copyId === null) {
      // The id we generated for the copy is ours alone: remove it if the import did create it (best effort).
      if (remapped.sessionId !== null) await deleteOrphanCopy(remapped.sessionId)
      throw new Error('OpenCode imported the conversation but did not say which new session it is, so no session was added.')
    }

    const session = store.createSession({
      cwd: parent.cwd,
      name: forkName(parent.name),
      groupId: parent.groupId,
      statusId: null,
      claudeArgs: [],
      agent: 'opencode',
      ...(parent.model !== undefined ? { model: parent.model } : {}),
      ...(parent.opencodePermissions !== undefined ? { opencodePermissions: parent.opencodePermissions } : {}),
      ...(parent.worktreeId !== undefined ? { worktreeId: parent.worktreeId } : {})
    })
    try {
      // Stored BEFORE the start: `-s <copyId>` is what opens the copy instead of a fresh conversation.
      store.setOpencodeSessionId(session.id, copyId)
      startSession(findSession(session.id) ?? session, 'resume')
    } catch (error) {
      store.removeSession(session.id)
      startState.delete(session.id)
      runtime.forget(session.id)
      await deleteOrphanCopy(copyId)
      throw error
    }
    notice(`Copied "${parent.name}" into "${session.name}": an OpenCode copy of the conversation, not a true fork.`)
    return findSession(session.id) ?? session
  }

  /** Puts a running session to sleep: stops its process, keeps the card and conversation. No-op otherwise. */
  function sleepNow(id: Id): void {
    const session = findSession(id)
    if (!session) return
    if (isClosed(id)) return
    const state = runtime.get(id)
    if (!state || state.run !== 'running' || state.sleeping) return

    // The kill is intentional: drop the start state so the next activation auto-resumes with --resume, and mark
    // the runtime asleep BEFORE killing so the pty exit handler ignores the exit instead of treating it as a crash.
    startState.delete(id)
    clearOpencodeHealth(id)
    // Sleep keeps the bell (reason and time) so the user sees what finished or needs them on return.
    attention.suspend(id)
    runtime.markSleeping(id)
    if (pty.isRunning(id)) {
      pty.kill(id)
    }
  }

  /** Starts a sleeping session again the way activation does. False when it is not sleeping or could not start. */
  function wakeNow(id: Id): boolean {
    const session = findSession(id)
    if (!session || isClosed(id)) return false
    if (runtime.get(id)?.sleeping !== true) return false
    try {
      // Same path as activation, but the active session is left alone.
      tryAutoStartSession(id)
    } catch (error) {
      logMainError(userDataDir, `wake session ${id}`, error)
      return false
    }
    return true
  }

  return {
    createSession(input: CreateSessionInput): Session {
      // A session in a worktree always runs in the worktree folder; input.cwd is ignored then.
      const worktree = input.worktreeId !== undefined ? store.getWorktree(input.worktreeId) : undefined
      if (input.worktreeId !== undefined && worktree === undefined) {
        throw new Error('Worktree not found')
      }
      const request: CreateSessionInput = worktree ? { ...input, cwd: worktree.path } : input
      // Validate before storing so a rejected request leaves no session behind.
      validateCwd(request.cwd)
      const session = store.createSession(request)
      try {
        startSession(session, 'new')
      } catch (error) {
        store.removeSession(session.id)
        startState.delete(session.id)
        runtime.forget(session.id)
        throw error
      }
      return session
    },

    async forkSession(id: Id): Promise<Session> {
      const parent = findSession(id)
      if (!parent) throw new Error(`Unknown session: ${id}`)
      if (parent.agent === 'shell') throw new Error('Shell sessions cannot be forked.')
      // D81: Cursor has no fork/export of a conversation that we can drive yet.
      if (parent.agent === 'cursor') throw new Error('Forking a Cursor session is not supported yet')
      if (parent.agent === 'opencode') return copyOpencodeSession(parent)
      if (parent.claudeSessionId === undefined) {
        throw new Error('Nothing to fork yet: this session has no saved conversation. Send it a prompt first.')
      }
      if (!transcriptExists(parent.claudeSessionId)) {
        throw new Error('Nothing to fork yet: this session has no saved conversation. Send it a prompt first.')
      }
      validateCwd(parent.cwd)
      const session = store.createSession({
        cwd: parent.cwd,
        name: forkName(parent.name),
        groupId: parent.groupId,
        statusId: null,
        claudeArgs: [...parent.claudeArgs],
        agent: 'claude',
        ...(parent.worktreeId !== undefined ? { worktreeId: parent.worktreeId } : {})
      })
      try {
        startSession(session, 'new', parent.claudeSessionId)
      } catch (error) {
        store.removeSession(session.id)
        startState.delete(session.id)
        runtime.forget(session.id)
        throw error
      }
      return findSession(session.id) ?? session
    },

    setOpencodeModel(id: Id, model: string | undefined): OpencodeModelResult {
      const session = findSession(id)
      if (!session) throw new Error(`Unknown session: ${id}`)
      if (session.agent === 'shell') throw new Error(`"${session.name}" is a shell session: it has no model.`)
      if ((session.agent ?? 'claude') === 'claude') {
        throw new Error(`"${session.name}" is a Claude session: its model is a launch setting (Settings > Agents), not a per-session one.`)
      }
      const trimmed = model === undefined ? undefined : model.trim()
      const next = trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
      if (next !== undefined) {
        const problem = sessionModelProblem(next)
        if (problem !== null) throw new Error(problem)
      }
      // The same model again: nothing to store and no reason to drop a running conversation.
      if (session.model === next) return 'next-start'
      store.setSessionModel(id, next)

      const state = runtime.get(id)
      const running = pty.isRunning(id) && state?.run === 'running' && state.sleeping !== true
      // Without a conversation id a restart would open a FRESH conversation, so a live one is left alone: it keeps
      // running the old model and the new one applies to its next start.
      if (!running || isClosed(id) || session.opencodeSessionId === undefined) return 'next-start'
      sleepNow(id)
      return wakeNow(id) ? 'restarted' : 'restart-failed'
    },

    removeSession(id: Id): void {
      removeSessionNow(id)
    },

    removeWorktree(id: Id): void {
      removeWorktreeNow(id)
    },

    removeRepo(id: Id): void {
      for (const worktree of store.get().worktrees ?? []) {
        if (worktree.repoId === id) removeWorktreeNow(worktree.id)
      }
      store.removeRepo(id)
    },

    closeSession(id: Id): void {
      store.closeSession(id)
      startState.delete(id)
      forgetTrustPrompt(id)
      clearOpencodeHealth(id)
      cursorAnswers.delete(id)
      if (pty.isRunning(id)) {
        pty.kill(id)
      }
      attention.forget(id)
      runtime.markExited(id, null)
      if (activeId === id) {
        activeId = null
      }
    },

    reopenSession(id: Id): void {
      const current = findSession(id)
      if (!current) {
        throw new Error(`Unknown session: ${id}`)
      }
      if (pty.isRunning(id)) {
        if (current.closedAt === undefined) return
        // The old process has been killed but has not exited yet; retry once it has.
        throw new Error(`${STOPPING_ERROR_PREFIX}: ${id}`)
      }

      store.reopenSession(id)
      const reopened = findSession(id)
      if (!reopened) {
        throw new Error(`Unknown session: ${id}`)
      }

      const mode = restoredWithoutClaudeSessionId.has(id) ? 'new' : 'resume'
      startSession(reopened, mode)
    },

    async restartSession(id: Id): Promise<void> {
      const session = findSession(id)
      if (!session) {
        throw new Error(`Session not found: ${id}`)
      }
      if (session.closedAt !== undefined) {
        throw new Error(`Session is closed: ${id}`)
      }
      validateCwd(session.cwd)

      const sessionWithId = ensureClaudeSessionId(session)
      limitArmed.delete(id)
      forgetTrustPrompt(id)
      const previousState = startState.get(id)
      const state: SessionStartState = {
        everStartedThisRun: true,
        fallbackAttempts: 0,
        startTime: Date.now()
      }
      startState.set(id, state)

      try {
        pty.restart(startOptions(sessionWithId, true))
      } catch (error) {
        // Put back the previous start state so a stale "everStarted" does not block a later start.
        if (previousState) {
          startState.set(id, previousState)
        } else {
          startState.delete(id)
        }
        throw error
      }
      runtime.markRunning(id)
      if (sessionWithId.agent === 'opencode') {
        beginOpencodeHealth(id, state.startTime ?? Date.now())
        if (sessionWithId.opencodeSessionId === undefined) {
          const track = opencodeHealth.get(id)
          if (track !== undefined) void recoverOpencodeSessionId(id, track)
        }
      }
    },

    writeToPty(id: Id, data: string): void {
      if (!findSession(id)) return
      attention.noteInput(id)
      if (!pty.isRunning(id)) return
      pty.write(id, data)
    },

    resizePty(id: Id, cols: number, rows: number): void {
      if (!findSession(id) || !pty.isRunning(id)) return
      pty.resize(id, cols, rows)
    },

    sleepSession(id: Id): void {
      sleepNow(id)
    },

    wakeSession(id: Id): boolean {
      return wakeNow(id)
    },

    resumeInBackground(id: Id): boolean {
      const session = findSession(id)
      if (!session || isClosed(id) || pty.isRunning(id)) return false
      try {
        tryAutoStartSession(id)
      } catch (error) {
        logMainError(userDataDir, `resume session ${id} on launch`, error)
        return false
      }
      return true
    },

    setActiveSession(id: Id | null): void {
      // A closed session is never activated or auto-started; it must be reopened explicitly.
      if (id !== null && isClosed(id)) return
      activeId = id
      if (id !== null) {
        tryAutoStartSession(id)
      }
    },

    getActiveSessionId(): Id | null {
      return activeId
    },

    handleHookEvent(event: HookEvent): void {
      try {
        const session = findSession(event.sessionId)
        if (!session) return
        // D81: a Cursor hook carries its chat id (conversation_id); its answer text is kept for Jarvis and stops here,
        // so a reply never moves the activity, the auto status or the attention.
        if (session.agent === 'cursor') {
          syncCursorChatId(session, event.chatId)
          if (event.event === 'CursorAnswer') {
            if (typeof event.answer === 'string') cursorAnswers.set(event.sessionId, event.answer)
            return
          }
        }
        // D79: any hook from the injected plugin proves it loaded.
        if (session.agent === 'opencode') noteOpencodePluginEvent(event.sessionId)
        if (event.event === 'AgentSession') {
          handleAgentSessionEvent(event)
          return
        }
        const current = runtime.get(event.sessionId)
        const previous: ActivitySnapshot = {
          activity: current?.activity ?? null,
          message: current?.activityMessage ?? null
        }
        // A prompt means someone is at the keyboard (here or via Remote Control): drop any pending ping.
        if (event.event === 'UserPromptSubmit') {
          attention.clear(event.sessionId)
          // A new turn starts a new limit occurrence: the old screen tail must not be matched again.
          if (session.agent === 'opencode') resetOpencodeLimitScan(event.sessionId)
          // Only a turn submitted in this process can be cut off by the limit: arm the edge trigger (not for shells).
          if (session.agent !== 'shell') limitArmed.add(event.sessionId)
        }
        const next = activityFromHook(event, previous)
        runtime.setActivity(event.sessionId, next.activity, next.message, Date.now())
        // Auto status follows activity CHANGES only, so repeated events never move a session the user placed.
        if (next.activity !== null && next.activity !== previous.activity) {
          applyAutoStatus(event.sessionId, next.activity)
        }
      } catch (error) {
        logMainError(userDataDir, `hook event ${event.event}`, error)
      }
    },

    lastCursorAnswer(id: Id): string | null {
      return cursorAnswers.get(id) ?? null
    },

    setNoticeHandler(handler: (message: string) => void): void {
      noticeHandler = handler
    },

    initializeRestoredSessions
  }
}
