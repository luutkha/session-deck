// Pure throttle for the user-activity reports sent to the main process. No DOM; never throws.

/** Minimum gap between two activity reports. The main process only needs coarse "still here" signals. */
export const USER_ACTIVITY_THROTTLE_MS = 15_000

/**
 * True when a report should be sent now: nothing sent yet, the throttle window has elapsed,
 * or the clock went backwards (a stale timestamp must not block reports indefinitely).
 */
export function shouldReport(lastSentAt: number | null, nowMs: number): boolean {
  if (lastSentAt === null) return true
  if (nowMs < lastSentAt) return true
  return nowMs - lastSentAt >= USER_ACTIVITY_THROTTLE_MS
}
