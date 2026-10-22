import type { AwaySessionSummary, AwaySummary, Id, RuntimeState, TimelineTurn } from '../../shared/types'

/** A session as the summary sees it (the store's Session is assignable to this). */
export interface AwaySessionInfo {
  readonly id: Id
  readonly name: string
  /** Present = the user closed the session; closed sessions are never listed. */
  readonly closedAt?: number
}

export interface BuildAwaySummaryInput {
  /** Epoch ms of the last user input before going away. */
  readonly since: number
  /** Epoch ms of the input that ended the away time. */
  readonly until: number
  readonly turns: readonly TimelineTurn[]
  readonly sessions: readonly AwaySessionInfo[]
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastSleptAt: (sessionId: Id) => number | null
}

/** Whether an epoch ms lies in (since, until]. */
function inWindow(at: number | null, since: number, until: number): boolean {
  return at !== null && at > since && at <= until
}

/** Whether a turn was running at some point inside (since, until]. */
function wasRunningInWindow(turn: TimelineTurn, since: number, until: number): boolean {
  return turn.startedAt <= until && (turn.endedAt === null || turn.endedAt > since)
}

/** A turn counts when it ended inside the window, or when it needed the user while running through it. */
function isConsidered(turn: TimelineTurn, since: number, until: number): boolean {
  if (inWindow(turn.endedAt, since, until)) return true
  return turn.neededYou && wasRunningInWindow(turn, since, until)
}

/** Time used to order a turn for "newest": when it ended, or when it started while still running. */
function activityAt(turn: TimelineTurn): number {
  return turn.endedAt ?? turn.startedAt
}

/** The newest considered turn (later in the list wins a tie), or undefined. */
function newestTurn(turns: readonly TimelineTurn[]): TimelineTurn | undefined {
  let newest: TimelineTurn | undefined
  for (const turn of turns) {
    if (newest === undefined || activityAt(turn) >= activityAt(newest)) newest = turn
  }
  return newest
}

/** Known costs of the turns summed, or null when no turn has a known cost. */
function sumKnownCosts(turns: readonly TimelineTurn[]): number | null {
  const known = turns.map((turn) => turn.costUsd).filter((cost): cost is number => cost !== null)
  if (known.length === 0) return null
  return known.reduce((total, cost) => total + cost, 0)
}

/** Newest event time inside the window among the turns and the sleep record; falls back to `since`. */
function newestEventAt(turns: readonly TimelineTurn[], sleptAt: number | null, since: number, until: number): number {
  const candidates: number[] = []
  for (const turn of turns) {
    if (turn.endedAt !== null && inWindow(turn.endedAt, since, until)) candidates.push(turn.endedAt)
    if (inWindow(turn.startedAt, since, until)) candidates.push(turn.startedAt)
  }
  if (sleptAt !== null && inWindow(sleptAt, since, until)) candidates.push(sleptAt)
  return candidates.length === 0 ? since : Math.max(...candidates)
}

interface SessionFacts {
  readonly considered: readonly TimelineTurn[]
  readonly pendingPermission: boolean
  readonly sleptAt: number | null
}

/** Builds one session's entry, or null when it has nothing to report. */
function summarizeSession(session: AwaySessionInfo, facts: SessionFacts, since: number, until: number): AwaySessionSummary | null {
  const { considered, pendingPermission, sleptAt } = facts
  const finished = considered.filter((turn) => turn.end === 'finished').length
  const hitLimit = considered.some((turn) => turn.end === 'limit')
  const needsYou = pendingPermission || considered.some((turn) => turn.neededYou)
  const slept =
    considered.some((turn) => turn.end === 'slept') || inWindow(sleptAt, since, until)
  if (finished === 0 && !needsYou && !hitLimit && !slept) return null

  const newest = newestTurn(considered)
  return {
    sessionId: session.id,
    name: session.name,
    finished,
    needsYou,
    hitLimit,
    slept,
    costUsd: sumKnownCosts(considered),
    lastPrompt: newest?.prompt ?? '',
    lastAt: newestEventAt(considered, sleptAt, since, until)
  }
}

function groupTurnsBySession(turns: readonly TimelineTurn[]): Map<Id, TimelineTurn[]> {
  const grouped = new Map<Id, TimelineTurn[]>()
  for (const turn of turns) {
    const list = grouped.get(turn.sessionId)
    if (list === undefined) {
      grouped.set(turn.sessionId, [turn])
    } else {
      list.push(turn)
    }
  }
  return grouped
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * "While you were away": what happened in sessions between `since` and `until`. Pure: all inputs are passed in.
 * Closed and unknown sessions are skipped. Only sessions with a finished turn, a pending or past need for the user,
 * a usage-limit stop or a sleep are listed, newest activity first.
 */
export function buildAwaySummary(input: BuildAwaySummaryInput): AwaySummary {
  const { since, until, turns, sessions, runtime, lastSleptAt } = input
  const grouped = groupTurnsBySession(turns)

  const entries: AwaySessionSummary[] = []
  for (const session of sessions) {
    if (session.closedAt !== undefined) continue
    const facts: SessionFacts = {
      considered: (grouped.get(session.id) ?? []).filter((turn) => isConsidered(turn, since, until)),
      pendingPermission: runtime.get(session.id)?.attention === 'permission',
      sleptAt: lastSleptAt(session.id)
    }
    const entry = summarizeSession(session, facts, since, until)
    if (entry !== null) entries.push(entry)
  }

  const listed = [...entries].sort((a, b) => b.lastAt - a.lastAt)
  return {
    since,
    until,
    sessions: listed,
    totals: {
      finished: sumOf(listed.map((entry) => entry.finished)),
      needsYou: listed.filter((entry) => entry.needsYou).length,
      slept: listed.filter((entry) => entry.slept).length,
      hitLimit: listed.filter((entry) => entry.hitLimit).length,
      costUsd: sumOf(listed.map((entry) => entry.costUsd ?? 0))
    }
  }
}
