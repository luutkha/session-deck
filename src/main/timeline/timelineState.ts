import type { Id, TimelineTurn, TurnEnd } from '../../shared/types'
import { TIMELINE_MAX_TURNS_PER_SESSION } from '../../shared/types'

/** How long after a turn ended its cost may still change (the statusLine that carries the final cost can lag Stop). */
export const COST_SETTLE_MS = 120_000

/**
 * The turn whose cost is tracked for a session and the session cost already attributed to it (null = unknown). The
 * difference to the next read is added to that turn, so out-of-order cost reports never double-count previous turns.
 */
export interface CostTrack {
  readonly turnId: string
  readonly startCost: number | null
}

/**
 * Immutable timeline data. Every transition returns a new state; a transition that changes nothing returns the very
 * same object, so callers can detect a change with `next !== state`.
 */
export interface TimelineState {
  /** Turns per session, oldest first, capped at TIMELINE_MAX_TURNS_PER_SESSION. */
  readonly turns: ReadonlyMap<Id, readonly TimelineTurn[]>
  /** Epoch ms of the last time each session was put to sleep (in memory only). */
  readonly sleptAt: ReadonlyMap<Id, number>
  /**
   * The turn that currently receives cost increments (its `startCost` is the cost already attributed, a cursor) and,
   * per session, the still-open turns a newer prompt superseded, oldest first: a Stop settles those before the
   * newest turn (the late Stop belongs to the old turn, not the one just started).
   */
  readonly costTrack: ReadonlyMap<Id, CostTrack>
  readonly awaitingStop: ReadonlyMap<Id, readonly string[]>
}

const NO_TURNS: readonly TimelineTurn[] = []

/** At most this many superseded turns wait for their Stop (a lost Stop must not grow the list forever). */
export const MAX_AWAITING_STOP = 8

export function emptyTimelineState(): TimelineState {
  return { turns: new Map(), sleptAt: new Map(), costTrack: new Map(), awaitingStop: new Map() }
}

/** Turns of one session, oldest first. */
export function sessionTurns(state: TimelineState, sessionId: Id): readonly TimelineTurn[] {
  return state.turns.get(sessionId) ?? NO_TURNS
}

/** The turn that is still running (no end yet) in a list, or undefined. */
export function runningTurn(turns: readonly TimelineTurn[]): TimelineTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].end === null) return turns[i]
  }
  return undefined
}

function capTurns(turns: readonly TimelineTurn[]): readonly TimelineTurn[] {
  return turns.length > TIMELINE_MAX_TURNS_PER_SESSION ? turns.slice(turns.length - TIMELINE_MAX_TURNS_PER_SESSION) : turns
}

/** Replaces one session's turns (capped; an empty list removes the session's entry). */
function withTurns(state: TimelineState, sessionId: Id, turns: readonly TimelineTurn[]): TimelineState {
  const map = new Map(state.turns)
  if (turns.length === 0) {
    map.delete(sessionId)
  } else {
    map.set(sessionId, capTurns(turns))
  }
  return { ...state, turns: map }
}

/**
 * Appends a running turn. The cost cursor moves to it only when no superseded turn is still waiting for its Stop;
 * otherwise the late cost of the old turn keeps landing on the old turn until that Stop arrives.
 */
export function startTurn(state: TimelineState, sessionId: Id, turn: TimelineTurn, startCost: number | null): TimelineState {
  const withAppended = withTurns(state, sessionId, [...sessionTurns(state, sessionId), turn])
  if ((state.awaitingStop.get(sessionId) ?? []).length > 0) return withAppended
  const costTrack = new Map(state.costTrack)
  costTrack.set(sessionId, { turnId: turn.id, startCost })
  return { ...withAppended, costTrack }
}

/**
 * Finalises the running turn as `finished` because a NEW prompt arrived (its real Stop has not arrived yet) and
 * records it as awaiting that Stop. The cost cursor stays on it, so a statusLine that lands after the new prompt
 * still books the old turn's cost on the old turn. No running turn = same state.
 */
export function supersedeRunningTurn(state: TimelineState, sessionId: Id, at: number): TimelineState {
  const turns = sessionTurns(state, sessionId)
  const running = runningTurn(turns)
  if (running === undefined) return state
  const finishedAt = Math.max(at, running.startedAt)
  const updated = turns.map((turn) => (turn === running ? { ...turn, endedAt: finishedAt, end: 'finished' as const } : turn))
  const queued = [...(state.awaitingStop.get(sessionId) ?? []), running.id].slice(-MAX_AWAITING_STOP)
  const awaitingStop = new Map(state.awaitingStop)
  awaitingStop.set(sessionId, queued)
  return { ...withTurns(state, sessionId, updated), awaitingStop }
}

/** Superseded turns of a session still waiting for their Stop, oldest first (ids only). */
export function awaitingStopIds(state: TimelineState, sessionId: Id): readonly string[] {
  return state.awaitingStop.get(sessionId) ?? []
}

/**
 * Ends the OLDEST superseded turn at `at` (its late Stop) and removes it from the queue. No queued turn = same
 * state. The caller settles cost right after; the cursor is still on this turn.
 */
export function endAwaitingTurn(state: TimelineState, sessionId: Id, at: number): TimelineState {
  const queued = awaitingStopIds(state, sessionId)
  if (queued.length === 0) return state
  const turns = sessionTurns(state, sessionId)
  const target = turns.find((turn) => turn.id === queued[0])
  const rest = queued.slice(1)
  const awaitingStop = new Map(state.awaitingStop)
  if (rest.length === 0) awaitingStop.delete(sessionId)
  else awaitingStop.set(sessionId, rest)
  if (target === undefined) return { ...state, awaitingStop }
  const finishedAt = Math.max(at, target.startedAt)
  const updated = turns.map((turn) => (turn === target ? { ...turn, endedAt: finishedAt } : turn))
  return { ...withTurns(state, sessionId, updated), awaitingStop }
}

/**
 * Moves the cost cursor to the next open turn after a Stop: the oldest remaining superseded turn, else the running
 * turn, using the cursor as its baseline. Called after settling a superseded turn.
 */
export function focusCostAfterStop(state: TimelineState, sessionId: Id): TimelineState {
  const queued = awaitingStopIds(state, sessionId)
  const target =
    queued.length > 0
      ? sessionTurns(state, sessionId).find((turn) => turn.id === queued[0])
      : runningTurn(sessionTurns(state, sessionId))
  const track = state.costTrack.get(sessionId)
  if (target === undefined || track === undefined || track.turnId === target.id) return state
  const costTrack = new Map(state.costTrack)
  costTrack.set(sessionId, { turnId: target.id, startCost: track.startCost })
  return { ...state, costTrack }
}

/** Forgets any superseded turns of a session (used when the session goes away or hits its limit). */
export function clearAwaitingStop(state: TimelineState, sessionId: Id): TimelineState {
  if (!state.awaitingStop.has(sessionId)) return state
  const awaitingStop = new Map(state.awaitingStop)
  awaitingStop.delete(sessionId)
  return { ...state, awaitingStop }
}

/** Ends the running turn of a session. No running turn = same state. */
export function endRunningTurn(state: TimelineState, sessionId: Id, end: TurnEnd, endedAt: number): TimelineState {
  const turns = sessionTurns(state, sessionId)
  const running = runningTurn(turns)
  if (running === undefined) return state
  const finishedAt = Math.max(endedAt, running.startedAt)
  const updated = turns.map((turn) => (turn === running ? { ...turn, endedAt: finishedAt, end } : turn))
  return withTurns(state, sessionId, updated)
}

/** Flags the running turn as one where the user was needed. No running turn = same state. */
export function markNeededYou(state: TimelineState, sessionId: Id): TimelineState {
  const turns = sessionTurns(state, sessionId)
  const running = runningTurn(turns)
  if (running === undefined || running.neededYou) return state
  return withTurns(state, sessionId, turns.map((turn) => (turn === running ? { ...turn, neededYou: true } : turn)))
}

/** Cost of a turn: the session cost now minus the cost at its start, never negative; null when either is unknown. */
export function costDelta(startCost: number | null, latestCost: number | null): number | null {
  if (startCost === null || latestCost === null) return null
  return Math.max(0, latestCost - startCost)
}

function isSettling(turn: TimelineTurn, nowMs: number): boolean {
  return turn.endedAt === null || nowMs - turn.endedAt <= COST_SETTLE_MS
}

/**
 * Updates the cost of the tracked turn of a session while it runs or for COST_SETTLE_MS after it ended, and advances
 * the cursor to the reported total. `latestCost` is the session cost read now (null = unknown).
 */
export function refreshCost(state: TimelineState, sessionId: Id, latestCost: number | null, nowMs: number): TimelineState {
  const track = state.costTrack.get(sessionId)
  if (track === undefined) return state
  const turns = sessionTurns(state, sessionId)
  const target = turns.find((turn) => turn.id === track.turnId)
  if (target === undefined || !isSettling(target, nowMs)) return state
  if (latestCost === null) {
    // The cost source is temporarily unknown: the turn keeps whatever it had (null is the "unknown" marker).
    if (target.costUsd === null) return state
    return withTurns(state, sessionId, turns.map((turn) => (turn === target ? { ...turn, costUsd: null } : turn)))
  }
  const delta = costDelta(track.startCost, latestCost)
  if (delta === null) return state
  // A known start cost with no change means "0 so far" for a fresh turn; later no-change reports are no-ops.
  if (delta === 0 && target.costUsd !== null) return state
  const costUsd = target.costUsd === null ? delta : target.costUsd + delta
  const costTrack = new Map(state.costTrack)
  costTrack.set(sessionId, { turnId: track.turnId, startCost: latestCost })
  return {
    ...withTurns(state, sessionId, turns.map((turn) => (turn === target ? { ...turn, costUsd } : turn))),
    costTrack
  }
}

export function recordSleptAt(state: TimelineState, sessionId: Id, nowMs: number): TimelineState {
  const sleptAt = new Map(state.sleptAt)
  sleptAt.set(sessionId, nowMs)
  return { ...state, sleptAt }
}

/** Drops everything kept for one session. Nothing kept = same state. */
export function forgetSession(state: TimelineState, sessionId: Id): TimelineState {
  if (
    !state.turns.has(sessionId) &&
    !state.sleptAt.has(sessionId) &&
    !state.costTrack.has(sessionId) &&
    !state.awaitingStop.has(sessionId)
  ) {
    return state
  }
  const turns = new Map(state.turns)
  const sleptAt = new Map(state.sleptAt)
  const costTrack = new Map(state.costTrack)
  const awaitingStop = new Map(state.awaitingStop)
  turns.delete(sessionId)
  sleptAt.delete(sessionId)
  costTrack.delete(sessionId)
  awaitingStop.delete(sessionId)
  return { turns, sleptAt, costTrack, awaitingStop }
}

/** Builds a state from loaded turns (and sleep records): grouped per session, oldest first, capped. */
export function stateFromTurns(turns: readonly TimelineTurn[], sleeps: readonly { sessionId: Id; at: number }[] = []): TimelineState {
  const grouped = new Map<Id, TimelineTurn[]>()
  for (const turn of turns) {
    const list = grouped.get(turn.sessionId)
    if (list === undefined) {
      grouped.set(turn.sessionId, [turn])
    } else {
      list.push(turn)
    }
  }
  let state = emptyTimelineState()
  for (const [sessionId, list] of grouped) {
    const ordered = [...list].sort((a, b) => a.startedAt - b.startedAt)
    state = withTurns(state, sessionId, ordered)
  }
  const sleptAt = new Map<Id, number>()
  for (const sleep of sleeps) {
    const known = sleptAt.get(sleep.sessionId)
    if (known === undefined || sleep.at > known) sleptAt.set(sleep.sessionId, sleep.at)
  }
  return sleptAt.size === 0 ? state : { ...state, sleptAt }
}

/** Every turn of every session, newest first. */
export function allTurns(state: TimelineState): readonly TimelineTurn[] {
  const flat: TimelineTurn[] = []
  for (const turns of state.turns.values()) flat.push(...turns)
  return flat.sort((a, b) => b.startedAt - a.startedAt)
}
