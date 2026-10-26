import type { Id, RuntimeState, SleepSettings } from '../../shared/types'
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'

/** The session shape the policy needs; the store's Session is assignable to it. */
export interface SleepPolicySession {
  readonly id: Id
  readonly closed: boolean
  /** True = the user turned automatic sleep off for this session. */
  readonly keepAwake?: boolean
}

export interface SleepPolicyInput {
  readonly nowMs: number
  readonly settings: SleepSettings
  /** Every session the user can see right now (one per open window; empty when no window is open). */
  readonly onScreenSessionIds: ReadonlySet<Id>
  readonly sessions: readonly SleepPolicySession[]
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastTouchAt: ReadonlyMap<Id, number>
}

function clampAfterMinutes(afterMinutes: number): number {
  return Math.min(MAX_SLEEP_MINUTES, Math.max(MIN_SLEEP_MINUTES, afterMinutes))
}

/**
 * Pure idle rule: which running sessions may be put to sleep right now.
 * A session is picked only when sleep is enabled, it is open and running, it is not already asleep, it is not on
 * screen in ANY open window, its activity is neither 'working' nor 'needs-input' (finished or unknown), no attention
 * is pending, and it has been untouched for at least `afterMinutes` (clamped to MIN/MAX_SLEEP_MINUTES). A session
 * with no recorded touch is treated as just touched (never idle).
 */
export function pickSessionsToSleep(input: SleepPolicyInput): Id[] {
  const { nowMs, settings, onScreenSessionIds, sessions, runtime, lastTouchAt } = input
  if (!settings.enabled) return []

  const thresholdMs = clampAfterMinutes(settings.afterMinutes) * 60_000
  const picked: Id[] = []

  for (const session of sessions) {
    if (session.closed) continue
    if (onScreenSessionIds.has(session.id)) continue
    if (session.keepAwake === true) continue

    const state = runtime.get(session.id)
    if (!state || state.run !== 'running' || state.sleeping) continue
    if (state.attention !== null) continue
    // Remote Control lives in the Claude process: sleeping it would drop the phone / claude.ai connection.
    if (state.remoteControl === true) continue

    const activity = state.activity ?? null
    if (activity === 'working' || activity === 'needs-input') continue

    const touched = lastTouchAt.get(session.id)
    if (touched === undefined) continue

    const lastActivityAt = state.activityAt ?? 0
    const idleSince = Math.max(touched, lastActivityAt)
    if (nowMs - idleSince >= thresholdMs) {
      picked.push(session.id)
    }
  }

  return picked
}
