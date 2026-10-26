import type { AttentionReason, HookEvent, Id, Session, CreateSessionInput, ShellKind } from '../../shared/types'
import type { ActiveSessions } from './activeSessions'
import { SessionStore } from '../store'
import { PtyManager, type StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention'
import type { RuntimeRegistry } from './runtimeRegistry'
import { shouldFallbackToNew, shouldRotateSessionId, REPLAY_TAIL_CHARS } from './claudeLaunch'
import { transcriptExists } from './transcript'
import { randomUUID } from 'node:crypto'
import { buildStartOptions, validateCwd } from './startOptions'
import { STOPPING_ERROR_PREFIX } from './retryWhileStopping'
import { logMainError } from './errorLog'
import { activityFromHook, type ActivitySnapshot } from './activity'
import { detectOutputSignals, findUsageLimitLine, stripAnsi } from './outputSignals'
import { createAutoStatusApplier } from '../automation/applyAutoStatus'

const MAX_FALLBACK_ATTEMPTS = 1

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
   */
  readonly onUsageLimit?: (id: Id) => void
}

export interface SessionController {
  createSession(input: CreateSessionInput): Session
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
  setActiveSession(id: Id | null): void
  getActiveSessionId(): Id | null
  initializeRestoredSessions(): void
  /** A Claude Code hook event: updates the session's activity and, on a change, its auto status. Never throws. */
  handleHookEvent(event: HookEvent): void
}

function getOutputTail(pty: PtyManager, sessionId: Id): string {
  // Terminal escape codes can split the words of an error message, so match against the plain text.
  const text = stripAnsi(pty.replay(sessionId).data)
  return text.length <= REPLAY_TAIL_CHARS ? text : text.slice(-REPLAY_TAIL_CHARS)
}

function handleExitWithFallback(
  sessionId: Id,
  runMs: number,
  exitCode: number | null,
  pty: PtyManager,
  store: SessionStore,
  attention: AttentionService,
  runtime: RuntimeRegistry,
  startState: Map<Id, SessionStartState>
): boolean {
  const state = startState.get(sessionId)
  if (!state) return false

  const session = store.get().sessions.find((s) => s.id === sessionId)
  // The "no conversation" fallback and resume args are Claude-only; OpenCode and shell sessions just stay exited.
  if (!session || session.agent === 'opencode' || session.agent === 'shell' || !session.claudeSessionId) return false

  const outputTail = getOutputTail(pty, sessionId)
  if (
    state.fallbackAttempts < MAX_FALLBACK_ATTEMPTS &&
    shouldRotateSessionId({ mode: 'resume', runMs, exitCode, outputTail, hasTranscript: transcriptExists(session.claudeSessionId) })
  ) {
    // Never prompted, so nothing is lost: continue under a fresh conversation id.
    startState.set(sessionId, { ...state, fallbackAttempts: state.fallbackAttempts + 1 })
    store.setClaudeSessionId(sessionId, randomUUID())
    const rotated = store.get().sessions.find((s) => s.id === sessionId) ?? session
    pty.restart(buildStartOptions(rotated, false, attention))
    runtime.markRunning(sessionId)
    return true
  }
  const fallback = shouldFallbackToNew({ mode: 'resume', runMs, exitCode, outputTail })

  if (fallback && state.fallbackAttempts < MAX_FALLBACK_ATTEMPTS) {
    const nextState = { ...state, fallbackAttempts: state.fallbackAttempts + 1 }
    startState.set(sessionId, nextState)

    pty.restart(buildStartOptions(session, false, attention))
    runtime.markRunning(session.id)
    return true
  }

  return false
}

export function createSessionController(deps: SessionControllerDeps): SessionController {
  const { store, pty, attention, runtime, sendPtyData, userDataDir } = deps

  let activeId: Id | null = null
  const startState = new Map<Id, SessionStartState>()
  let initialized = false
  const restoredWithoutClaudeSessionId = new Set<Id>()
  // Sessions with a turn submitted in the running process that has not reported the usage limit yet (edge trigger).
  const limitArmed = new Set<Id>()
  const applyAutoStatus = createAutoStatusApplier({
    store,
    onError: (where, error) => logMainError(userDataDir, where, error)
  })

  function findSession(id: Id): Session | undefined {
    return store.get().sessions.find((s) => s.id === id)
  }

  function isClosed(id: Id): boolean {
    return findSession(id)?.closedAt !== undefined
  }

  // Remote Control: a Claude process driven from claude.ai/code or the phone gets no local keystrokes, so two facts
  // are read off its screen instead: that Remote Control is on (keeps the session awake) and that a turn is running
  // again after a question was answered remotely (hooks only report the next Stop).
  function readScreenSignals(id: Id, data: string): void {
    const agent = findSession(id)?.agent
    if (agent === 'opencode' || agent === 'shell') return
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
    sendPtyData(id, data, seq)
  })

  pty.onExit((id: Id, code: number | null) => {
    // The next process has no turn of its own until a prompt is submitted.
    limitArmed.delete(id)
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
      fallbackHandled = handleExitWithFallback(id, runMs, code, pty, store, attention, runtime, startState)
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
    // The Claude `--session-id` bookkeeping never applies to OpenCode or shell sessions.
    if (session.agent === 'opencode' || session.agent === 'shell' || session.claudeSessionId) {
      return session
    }
    const newId = crypto.randomUUID()
    store.setClaudeSessionId(session.id, newId)
    return { ...session, claudeSessionId: newId }
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

  function startSession(session: Session, mode: 'new' | 'resume'): void {
    const sessionWithId = ensureClaudeSessionId(session)
    limitArmed.delete(sessionWithId.id)
    try {
      validateCwd(sessionWithId.cwd)
      const state: SessionStartState = {
        everStartedThisRun: true,
        fallbackAttempts: 0,
        startTime: Date.now()
      }
      startState.set(sessionWithId.id, state)
      const opts: StartOptions = buildStartOptions(sessionWithId, mode === 'resume', attention, shellProgram())
      pty.start(opts)
      runtime.markRunning(sessionWithId.id)
    } catch (error) {
      startState.delete(sessionWithId.id)
      runtime.markExited(sessionWithId.id, null)
      throw error
    }
  }

  function initializeRestoredSessions(): void {
    if (initialized) return
    initialized = true

    const sessions = store.get().sessions
    for (const session of sessions) {
      if (session.agent === 'opencode' || session.agent === 'shell') {
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
    attention.forget(id)
    runtime.forget(id)
    store.removeSession(id)
    startState.delete(id)
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
      const previousState = startState.get(id)
      const state: SessionStartState = {
        everStartedThisRun: true,
        fallbackAttempts: 0,
        startTime: Date.now()
      }
      startState.set(id, state)

      try {
        pty.restart(buildStartOptions(sessionWithId, true, attention, shellProgram()))
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
      const session = findSession(id)
      if (!session) return
      if (isClosed(id)) return
      const state = runtime.get(id)
      if (!state || state.run !== 'running' || state.sleeping) return

      // The kill is intentional: drop the start state so the next activation auto-resumes with --resume, and mark
      // the runtime asleep BEFORE killing so the pty exit handler ignores the exit instead of treating it as a crash.
      startState.delete(id)
      // Sleep keeps the bell (reason and time) so the user sees what finished or needs them on return.
      attention.suspend(id)
      runtime.markSleeping(id)
      if (pty.isRunning(id)) {
        pty.kill(id)
      }
    },

    wakeSession(id: Id): boolean {
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
        if (!findSession(event.sessionId)) return
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
          // Only a turn submitted in this process can be cut off by the limit: arm the edge trigger (not for shells).
          if (findSession(event.sessionId)?.agent !== 'shell') limitArmed.add(event.sessionId)
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

    initializeRestoredSessions
  }
}
