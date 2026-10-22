import type { Id, QuotaAutopilotState, RuntimeState, Session, UsageState } from '../../shared/types'

/** Wait after the 5-hour reset before waking, so the usage endpoint has rolled over. */
export const RESET_GRACE_MS = 5_000
/** A reset the timer already handled is not announced again by the guard within this window. */
export const RESET_DEDUP_MS = 30 * 60_000
/** Output must stay quiet this long before "continue" is typed (Claude is ready for input again). */
export const CONTINUE_QUIET_MS = 3_000
/** Give up waiting for that quiet period after this long. */
export const CONTINUE_MAX_WAIT_MS = 90_000
/** Delay between typing "continue" and pressing Enter. */
export const CONTINUE_ENTER_DELAY_MS = 300
export const CONTINUE_TEXT = 'continue'
export const CONTINUE_SUBMIT = '\r'
/** setTimeout stores the delay as a signed 32-bit number; longer waits are chunked. */
export const MAX_TIMEOUT_MS = 2_147_483_647

const MS_PER_SEC = 1000

export const EMPTY_AUTOPILOT_STATE: QuotaAutopilotState = { sleptForQuota: [], stoppedAtLimit: [], resetsAt: null }

export function uniqueIds(ids: readonly Id[]): Id[] {
  return Array.from(new Set(ids))
}

export function hasHeld(state: QuotaAutopilotState): boolean {
  return state.sleptForQuota.length > 0 || state.stoppedAtLimit.length > 0
}

/** Whether the autopilot may put this session to sleep right now. */
export function isIdleCandidate(session: Session, runtime: RuntimeState | undefined): boolean {
  if (session.closedAt !== undefined) return false
  if (session.keepAwake === true) return false
  if (runtime === undefined || runtime.run !== 'running' || runtime.sleeping === true) return false
  if (runtime.activity === 'working' || runtime.activity === 'needs-input') return false
  return runtime.remoteControl !== true
}

export function idleCandidateIds(sessions: readonly Session[], runtimes: ReadonlyMap<Id, RuntimeState>): Id[] {
  return sessions.filter((s) => isIdleCandidate(s, runtimes.get(s.id))).map((s) => s.id)
}

function openIdSet(sessions: readonly Session[]): Set<Id> {
  return new Set(sessions.filter((s) => s.closedAt === undefined).map((s) => s.id))
}

/** Held sessions that still exist and are open, in the order they were held. */
export function liveHeldIds(state: QuotaAutopilotState, sessions: readonly Session[]): Id[] {
  const open = openIdSet(sessions)
  return uniqueIds([...state.sleptForQuota, ...state.stoppedAtLimit]).filter((id) => open.has(id))
}

/** The same state without the held sessions that no longer exist or are closed. */
export function pruneHeld(state: QuotaAutopilotState, sessions: readonly Session[]): QuotaAutopilotState {
  const open = openIdSet(sessions)
  return {
    sleptForQuota: state.sleptForQuota.filter((id) => open.has(id)),
    stoppedAtLimit: state.stoppedAtLimit.filter((id) => open.has(id)),
    resetsAt: state.resetsAt
  }
}

/** When the reset timer should fire, in epoch milliseconds (the reset itself plus a short grace). */
export function resetFireAt(resetsAtSec: number): number {
  return resetsAtSec * MS_PER_SEC + RESET_GRACE_MS
}

/** Delay for one setTimeout call: the remaining time, capped at the maximum the timer supports. */
export function nextTimerDelay(nowMs: number, fireAtMs: number): number {
  return Math.min(Math.max(0, fireAtMs - nowMs), MAX_TIMEOUT_MS)
}

/**
 * The 5-hour reset from usage data, in epoch seconds, only when it lies in the future. Stale usage data must not
 * wake sessions before their window has really reset.
 */
export function futureFiveHourReset(usage: UsageState, nowMs: number): number | null {
  const resetsAt = usage.account?.fiveHour?.resetsAt
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null
  return resetsAt * MS_PER_SEC > nowMs ? resetsAt : null
}

/** A fresh reset time wins; otherwise the previous one is kept while it is still in the future. */
export function resolveResetsAt(previous: number | null, fresh: number | null, nowMs: number): number | null {
  if (fresh !== null) return fresh
  return previous !== null && previous * MS_PER_SEC > nowMs ? previous : null
}

export function isNewerReset(current: number | null, candidate: number): boolean {
  return current === null || candidate > current
}
