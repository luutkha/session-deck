import type { HookEvent, Id, TimelineTurn, TurnEnd } from '../../shared/types'
import { loadTimelineDocument, saveTimelineDocument, type TimelineErrorHandler, type TimelineSleep } from './timelineFile'
import {
  allTurns,
  awaitingStopIds,
  clearAwaitingStop,
  emptyTimelineState,
  endAwaitingTurn,
  endRunningTurn,
  focusCostAfterStop,
  forgetSession,
  markNeededYou,
  recordSleptAt,
  refreshCost,
  sessionTurns,
  startTurn,
  stateFromTurns,
  supersedeRunningTurn,
  type TimelineState
} from './timelineState'

/** How a session's running turn ends when the session itself goes away (see onSessionEnded). */
export type TimelineSessionEnd = Extract<TurnEnd, 'slept' | 'closed' | 'exited'>

/** Opaque timer handle; the real one is Node's Timeout. */
export type TimelineTimerHandle = unknown

export const DEFAULT_TIMELINE_SAVE_DELAY_MS = 2000

export interface TimelineServiceDeps {
  readonly filePath: string
  readonly now: () => number
  /** Session cost in USD now, or null when unknown. */
  readonly getSessionCost: (sessionId: Id) => number | null
  /** Called after every change to one session's turns or sleep record. Not called by load(). */
  readonly onChange: (sessionId: Id) => void
  readonly onError: TimelineErrorHandler
  /** Quiet time after the last change before the file is written. Defaults to DEFAULT_TIMELINE_SAVE_DELAY_MS. */
  readonly saveDelayMs?: number
  readonly setTimeout?: (callback: () => void, ms: number) => TimelineTimerHandle
  readonly clearTimeout?: (handle: TimelineTimerHandle) => void
}

export interface TimelineService {
  /** Reads the timeline file. Call once, before any hook event. Never throws. */
  load(): Promise<void>
  /** Feeds one hook event (UserPromptSubmit, Notification, Stop; AgentSession is ignored). */
  onHook(event: HookEvent): void
  /** The session was slept, closed or its process exited. A slept session also records its sleep time. */
  onSessionEnded(sessionId: Id, end: TimelineSessionEnd): void
  /** The turn was cut off by Claude's usage-limit message. */
  onUsageLimit(sessionId: Id): void
  /** The session cost changed (statusLine update). */
  onCostChanged(sessionId: Id): void
  /** Turns of one session, newest first. */
  get(sessionId: Id): readonly TimelineTurn[]
  /** Turns of every session, newest first. */
  all(): readonly TimelineTurn[]
  /** Epoch ms of the last sleep of a session in this app run, or null. */
  lastSleptAt(sessionId: Id): number | null
  /** Drops everything kept for a removed session. */
  forget(sessionId: Id): void
  /** Writes the file now (used on quit). */
  flush(): Promise<void>
}

/**
 * Keeps a timeline of every turn of every session: a turn starts with a UserPromptSubmit and ends with the next
 * prompt, a Stop, a usage limit or the session going away. Changes are saved to `filePath` after a quiet period.
 */
export function createTimelineService(deps: TimelineServiceDeps): TimelineService {
  const {
    filePath,
    now,
    getSessionCost,
    onChange,
    onError,
    saveDelayMs = DEFAULT_TIMELINE_SAVE_DELAY_MS,
    setTimeout: setTimeoutFn = (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: clearTimeoutFn = (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
  } = deps

  let state: TimelineState = emptyTimelineState()
  /** Saves are refused until the file was read, so an early flush can never overwrite saved turns. */
  let loaded = false
  let sequence = 0
  let saveTimer: TimelineTimerHandle | null = null
  let saveChain: Promise<void> = Promise.resolve()

  function readCost(sessionId: Id): number | null {
    try {
      return getSessionCost(sessionId)
    } catch (error) {
      onError('timeline cost', error)
      return null
    }
  }

  function notify(sessionId: Id): void {
    try {
      onChange(sessionId)
    } catch (error) {
      onError('timeline change', error)
    }
  }

  /** Stores a new state; a change reports the session and schedules a save. The same state is a no-op. */
  function commit(next: TimelineState, sessionId: Id): void {
    if (next === state) return
    state = next
    scheduleSave()
    notify(sessionId)
  }

  function update(sessionId: Id, change: (current: TimelineState) => TimelineState): void {
    commit(change(state), sessionId)
  }

  function persist(): Promise<void> {
    const snapshot = allTurns(state)
    const sleeps: TimelineSleep[] = [...state.sleptAt.entries()].map(([sessionId, at]) => ({ sessionId, at }))
    saveChain = saveChain
      .then(() => saveTimelineDocument(filePath, { turns: snapshot, sleeps }))
      .catch((error: unknown) => {
        onError('timeline save', error)
      })
    return saveChain
  }

  function clearSaveTimer(): void {
    if (saveTimer !== null) {
      clearTimeoutFn(saveTimer)
      saveTimer = null
    }
  }

  function scheduleSave(): void {
    if (!loaded) return
    clearSaveTimer()
    saveTimer = setTimeoutFn(() => {
      saveTimer = null
      void persist()
    }, saveDelayMs)
  }

  /** An id unique within the session: `<startedAt>-<counter>`, the counter skipping any id already used. */
  function nextTurnId(existing: readonly TimelineTurn[], startedAt: number): string {
    let id = ''
    do {
      sequence += 1
      id = `${startedAt}-${sequence}`
    } while (existing.some((turn) => turn.id === id))
    return id
  }

  /** Ends the running turn as `end` and settles its cost one last time. */
  function endAndSettle(current: TimelineState, sessionId: Id, end: TurnEnd, at: number): TimelineState {
    const ended = endRunningTurn(current, sessionId, end, at)
    return refreshCost(ended, sessionId, readCost(sessionId), at)
  }

  function startPrompt(event: HookEvent): void {
    const sessionId = event.sessionId
    const at = now()
    // A prompt submitted while the previous turn is still open supersedes it: it is finalised now but its late Stop
    // (and the statusLine cost that follows it) must settle THAT turn, not the one just started.
    const superseded = supersedeRunningTurn(state, sessionId, at)
    const finishedPrevious = refreshCost(superseded, sessionId, readCost(sessionId), at)
    const startCost = readCost(sessionId)
    const turn: TimelineTurn = {
      id: nextTurnId(sessionTurns(finishedPrevious, sessionId), at),
      sessionId,
      prompt: event.prompt ?? '',
      startedAt: at,
      endedAt: null,
      end: null,
      costUsd: null,
      neededYou: false
    }
    const started = startTurn(finishedPrevious, sessionId, turn, startCost)
    commit(refreshCost(started, sessionId, startCost, at), sessionId)
  }

  /** A Stop belongs to the oldest superseded turn when one is waiting; otherwise to the running turn. */
  function stop(sessionId: Id): void {
    const at = now()
    const cost = readCost(sessionId)
    const waiting = awaitingStopIds(state, sessionId).length > 0
    let next = waiting ? endAwaitingTurn(state, sessionId, at) : endRunningTurn(state, sessionId, 'finished', at)
    next = refreshCost(next, sessionId, cost, at)
    // The superseded turn is settled; later cost increments belong to the turn started after it.
    next = waiting ? focusCostAfterStop(next, sessionId) : next
    commit(next, sessionId)
  }

  function onHook(event: HookEvent): void {
    if (event.event === 'UserPromptSubmit') {
      startPrompt(event)
    } else if (event.event === 'Notification') {
      update(event.sessionId, (current) => markNeededYou(current, event.sessionId))
    } else if (event.event === 'Stop') {
      stop(event.sessionId)
    }
  }

  function onSessionEnded(sessionId: Id, end: TimelineSessionEnd): void {
    update(sessionId, (current) => {
      const at = now()
      const ended = endRunningTurn(current, sessionId, end, at)
      const withSleep = end === 'slept' ? recordSleptAt(ended, sessionId, at) : ended
      // No Stop for a superseded turn can matter once the session is gone.
      return clearAwaitingStop(refreshCost(withSleep, sessionId, readCost(sessionId), at), sessionId)
    })
  }

  return {
    async load(): Promise<void> {
      const document = await loadTimelineDocument(filePath, now(), onError)
      state = stateFromTurns(document.turns, document.sleeps)
      loaded = true
    },

    onHook,

    onSessionEnded,

    onUsageLimit(sessionId: Id): void {
      update(sessionId, (current) => {
        const at = now()
        return clearAwaitingStop(endAndSettle(current, sessionId, 'limit', at), sessionId)
      })
    },

    onCostChanged(sessionId: Id): void {
      update(sessionId, (current) => refreshCost(current, sessionId, readCost(sessionId), now()))
    },

    get(sessionId: Id): readonly TimelineTurn[] {
      return [...sessionTurns(state, sessionId)].reverse()
    },

    all(): readonly TimelineTurn[] {
      return allTurns(state)
    },

    lastSleptAt(sessionId: Id): number | null {
      return state.sleptAt.get(sessionId) ?? null
    },

    forget(sessionId: Id): void {
      update(sessionId, (current) => forgetSession(current, sessionId))
    },

    async flush(): Promise<void> {
      clearSaveTimer()
      if (!loaded) return
      await persist()
    }
  }
}
