import type { Id, RuntimeState, SleepSettings } from '../../shared/types'
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'
import type { SleepPolicySession } from './sleepPolicy'

const MS_PER_MINUTE = 60_000

export interface AllSleepPolicyInput {
  readonly nowMs: number
  readonly settings: SleepSettings
  readonly sessions: readonly SleepPolicySession[]
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastTouchAt: ReadonlyMap<Id, number>
  /** Epoch ms of the last keyboard / mouse input in SessionDeck. */
  readonly lastUserInputAt: number
}

function clampAllMinutes(allAfterMinutes: number): number {
  return Math.min(MAX_SLEEP_MINUTES, Math.max(MIN_SLEEP_MINUTES, allAfterMinutes))
}

/** A session takes part in the app-wide rule only when it is open, not kept awake, running, asleep-free and not in Remote Control. */
function isCandidate(session: SleepPolicySession, state: RuntimeState): boolean {
  if (session.closed) return false
  if (session.keepAwake === true) return false
  if (state.run !== 'running' || state.sleeping === true) return false
  return state.remoteControl !== true
}

/** True when a candidate keeps the whole app awake (all-or-nothing rule). */
function blocksAllSleep(state: RuntimeState, touched: number | undefined, nowMs: number, thresholdMs: number): boolean {
  const activity = state.activity ?? null
  if (activity === 'working' || activity === 'needs-input') return true
  if (state.attention === 'permission') return true
  if (touched === undefined) return true
  const idleSince = Math.max(touched, state.activityAt ?? 0)
  return nowMs - idleSince < thresholdMs
}

/**
 * Pure app-wide idle rule: when the whole app has been idle, every running session is put to sleep, the one on
 * screen included. Returns nothing when sleep-all is off, when the user typed within the threshold, or when ANY
 * candidate is still busy (working, needs-input, permission request, or touched inside the threshold). Closed,
 * keep-awake, Remote Control, not-running and already-sleeping sessions are ignored (never picked, never block).
 */
export function pickAllToSleep(input: AllSleepPolicyInput): Id[] {
  const { nowMs, settings, sessions, runtime, lastTouchAt, lastUserInputAt } = input
  if (!settings.allEnabled) return []

  const thresholdMs = clampAllMinutes(settings.allAfterMinutes) * MS_PER_MINUTE
  if (nowMs - lastUserInputAt < thresholdMs) return []

  const picked: Id[] = []
  for (const session of sessions) {
    const state = runtime.get(session.id)
    if (state === undefined || !isCandidate(session, state)) continue
    if (blocksAllSleep(state, lastTouchAt.get(session.id), nowMs, thresholdMs)) return []
    picked.push(session.id)
  }
  return picked
}
