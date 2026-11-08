// D61: keeps Session.lastActiveAt current for the "Last active" and "Needs attention" sorts.
// A session is active when a turn starts or ends (Claude hooks / OpenCode plugin, through the runtime activity)
// or when the user submits a line in its terminal (an Enter, which also covers Shell sessions that have no hooks).
// Store writes are throttled per session: the first touch writes at once, later touches inside the window are
// folded into one trailing write, so a busy session costs at most one store save per window.
import type { Id, RuntimeState, SessionActivity } from '../../shared/types'

export const LAST_ACTIVE_THROTTLE_MS = 30_000

export interface LastActiveDeps {
  readonly now: () => number
  readonly write: (id: Id, at: number) => void
  readonly setTimeout: (callback: () => void, ms: number) => unknown
  readonly clearTimeout: (timer: unknown) => void
  readonly throttleMs?: number
}

export interface LastActiveTracker {
  /** The session was active now. */
  touch(id: Id): void
  /** A runtime update: a new `working` or `finished` activity counts; the idle reminder (`needs-input`) does not. */
  onRuntime(state: RuntimeState): void
  /** Bytes the user typed into a session's terminal: only a submitted line (contains Enter) counts. Focus reports and other terminal replies have no CR. */
  onUserInput(id: Id, data: string): void
  /** Writes every pending trailing value and stops the timers (shutdown). */
  flush(): void
}

const COUNTED_ACTIVITY: ReadonlySet<SessionActivity> = new Set<SessionActivity>(['working', 'finished'])

interface Entry {
  lastWriteAt: number
  pendingAt: number | null
  timer: unknown
}

export function createLastActiveTracker(deps: LastActiveDeps): LastActiveTracker {
  const throttleMs = deps.throttleMs ?? LAST_ACTIVE_THROTTLE_MS
  const entries = new Map<Id, Entry>()
  const seenActivityAt = new Map<Id, number>()

  const writeNow = (id: Id, entry: Entry, at: number): void => {
    entry.lastWriteAt = at
    entry.pendingAt = null
    deps.write(id, at)
  }

  const touch = (id: Id): void => {
    const at = deps.now()
    const entry = entries.get(id)
    if (entry === undefined) {
      const fresh: Entry = { lastWriteAt: at, pendingAt: null, timer: null }
      entries.set(id, fresh)
      deps.write(id, at)
      return
    }
    if (at - entry.lastWriteAt >= throttleMs && entry.timer === null) {
      writeNow(id, entry, at)
      return
    }
    entry.pendingAt = at
    if (entry.timer !== null) return
    entry.timer = deps.setTimeout((): void => {
      entry.timer = null
      if (entry.pendingAt !== null) writeNow(id, entry, entry.pendingAt)
    }, Math.max(0, entry.lastWriteAt + throttleMs - at))
  }

  return {
    touch,
    onRuntime(state: RuntimeState): void {
      const activity = state.activity
      if (activity === undefined || activity === null || !COUNTED_ACTIVITY.has(activity)) return
      const activityAt = state.activityAt ?? 0
      if (seenActivityAt.get(state.sessionId) === activityAt) return
      seenActivityAt.set(state.sessionId, activityAt)
      touch(state.sessionId)
    },
    onUserInput(id: Id, data: string): void {
      if (data.includes('\r')) touch(id)
    },
    flush(): void {
      for (const [id, entry] of entries) {
        if (entry.timer !== null) {
          deps.clearTimeout(entry.timer)
          entry.timer = null
        }
        if (entry.pendingAt !== null) writeNow(id, entry, entry.pendingAt)
      }
    }
  }
}
