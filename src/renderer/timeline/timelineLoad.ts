// Pure loading logic behind useTimeline: the IPC call that never rejects, the state transitions,
// and a request gate that drops replies from requests that were overtaken. No React here.
import type { Id, TimelineTurn } from '../../shared/types'

export const LOAD_FAILED_MESSAGE = 'Could not load activity.'

export type GetTimeline = (sessionId: Id) => Promise<readonly TimelineTurn[]>

export type TimelineLoadResult =
  | { readonly ok: true; readonly turns: readonly TimelineTurn[] }
  | { readonly ok: false; readonly error: string }

export interface TimelineViewState {
  /** The session these turns belong to; null before the first load. */
  readonly sessionId: Id | null
  readonly turns: readonly TimelineTurn[]
  readonly error: string | null
  readonly loading: boolean
}

export const INITIAL_TIMELINE_STATE: TimelineViewState = {
  sessionId: null,
  turns: [],
  error: null,
  loading: false
}

/** Calls the IPC and never rejects: a failure is logged and returned as a short message. */
export async function loadTimeline(sessionId: Id, getTimeline: GetTimeline): Promise<TimelineLoadResult> {
  try {
    return { ok: true, turns: await getTimeline(sessionId) }
  } catch (error: unknown) {
    console.error(`Could not load activity for session ${sessionId}`, error)
    return { ok: false, error: LOAD_FAILED_MESSAGE }
  }
}

/** A load started for sessionId. Turns of another session are dropped at once. */
export function beginLoad(state: TimelineViewState, sessionId: Id): TimelineViewState {
  if (state.sessionId !== sessionId) {
    return { sessionId, turns: [], error: null, loading: true }
  }
  return { ...state, error: null, loading: true }
}

/** A load finished. Results for a session that is no longer shown are ignored. */
export function finishLoad(
  state: TimelineViewState,
  sessionId: Id,
  result: TimelineLoadResult
): TimelineViewState {
  if (state.sessionId !== sessionId) {
    return state
  }
  if (!result.ok) {
    return { ...state, error: result.error, loading: false }
  }
  return { sessionId, turns: result.turns, error: null, loading: false }
}

export interface RequestGate {
  /** Starts a request and returns its number. */
  readonly next: () => number
  /** True only for the newest request; older replies must be dropped. */
  readonly isLatest: (request: number) => boolean
  /** Makes every outstanding request stale (on unmount or session change). */
  readonly cancel: () => void
}

export function createRequestGate(): RequestGate {
  let latest = 0
  return {
    next: (): number => {
      latest += 1
      return latest
    },
    isLatest: (request: number): boolean => request === latest,
    cancel: (): void => {
      latest += 1
    }
  }
}

/** Runs a subscribe call; if it throws, logs it and returns a no-op unsubscribe. */
export function subscribeSafely(subscribe: () => () => void): () => void {
  try {
    return subscribe()
  } catch (error: unknown) {
    console.error('Could not subscribe to activity updates', error)
    return (): void => undefined
  }
}
