import type { Id, TimelineTurn, TurnEnd } from '../../shared/types'
import { TIMELINE_MAX_TURNS_PER_SESSION } from '../../shared/types'

/** How long after a turn ended its cost may still change (the statusLine that carries the final cost can lag Stop). */
export const COST_SETTLE_MS = 120_000

/** The turn whose cost is tracked for a session, and the session cost when it started (null = unknown). */
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
  readonly costTrack: ReadonlyMap<Id, CostTrack>
}

const NO_TURNS: readonly TimelineTurn[] = []

export function emptyTimelineState(): TimelineState {
  return { turns: new Map(), sleptAt: new Map(), costTrack: new Map() }
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

/** Appends a running turn and makes it the one whose cost is tracked (the previous one stops settling). */
export function startTurn(state: TimelineState, sessionId: Id, turn: TimelineTurn, startCost: number | null): TimelineState {
  const withAppended = withTurns(state, sessionId, [...sessionTurns(state, sessionId), turn])
  const costTrack = new Map(state.costTrack)
  costTrack.set(sessionId, { turnId: turn.id, startCost })
  return { ...withAppended, costTrack }
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
 * Updates the cost of the tracked turn of a session while it runs or for COST_SETTLE_MS after it ended.
 * `latestCost` is the session cost read now (null = unknown).
 */
export function refreshCost(state: TimelineState, sessionId: Id, latestCost: number | null, nowMs: number): TimelineState {
  const track = state.costTrack.get(sessionId)
  if (track === undefined) return state
  const turns = sessionTurns(state, sessionId)
  const target = turns.find((turn) => turn.id === track.turnId)
  if (target === undefined || !isSettling(target, nowMs)) return state
  const costUsd = costDelta(track.startCost, latestCost)
  if (costUsd === target.costUsd) return state
  return withTurns(state, sessionId, turns.map((turn) => (turn === target ? { ...turn, costUsd } : turn)))
}

export function recordSleptAt(state: TimelineState, sessionId: Id, nowMs: number): TimelineState {
  const sleptAt = new Map(state.sleptAt)
  sleptAt.set(sessionId, nowMs)
  return { ...state, sleptAt }
}

/** Drops everything kept for one session. Nothing kept = same state. */
export function forgetSession(state: TimelineState, sessionId: Id): TimelineState {
  if (!state.turns.has(sessionId) && !state.sleptAt.has(sessionId) && !state.costTrack.has(sessionId)) return state
  const turns = new Map(state.turns)
  const sleptAt = new Map(state.sleptAt)
  const costTrack = new Map(state.costTrack)
  turns.delete(sessionId)
  sleptAt.delete(sessionId)
  costTrack.delete(sessionId)
  return { turns, sleptAt, costTrack }
}

/** Builds a state from loaded turns: grouped per session, oldest first, capped. */
export function stateFromTurns(turns: readonly TimelineTurn[]): TimelineState {
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
  return state
}

/** Every turn of every session, newest first. */
export function allTurns(state: TimelineState): readonly TimelineTurn[] {
  const flat: TimelineTurn[] = []
  for (const turns of state.turns.values()) flat.push(...turns)
  return flat.sort((a, b) => b.startedAt - a.startedAt)
}
