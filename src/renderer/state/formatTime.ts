import type { AttentionReason, RuntimeState, SessionActivity } from '../../shared/types'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const NOW_THRESHOLD_MS = 45 * SECOND_MS

/**
 * Compact "time since" formatter for the session card footer. Buckets:
 *  - <45s -> "now"
 *  - minutes -> "5m" (rounded)
 *  - hours -> "2h"
 *  - days -> "3d"
 * The function is deterministic (pure on inputs), accepts non-negative finite
 * deltas; a negative delta is reported as "now" to keep stale clocks honest.
 */
export function relativeTime(now: number, then: number): string {
  if (!Number.isFinite(now) || !Number.isFinite(then)) return ''
  const delta = now - then
  if (delta < NOW_THRESHOLD_MS) return 'now'
  if (delta < HOUR_MS) {
    const minutes = Math.round(delta / MINUTE_MS)
    return `${String(Math.max(1, minutes))}m`
  }
  if (delta < DAY_MS) {
    const hours = Math.round(delta / HOUR_MS)
    return `${String(Math.max(1, hours))}h`
  }
  const days = Math.round(delta / DAY_MS)
  return `${String(Math.max(1, days))}d`
}

/** True while the session is asleep (its process is stopped and reopening resumes it). */
export function isSleeping(runtime: RuntimeState | undefined): boolean {
  return runtime?.sleeping === true
}

/**
 * Short label for a session's runtime state, used in row 3 of the session
 * card. Closed sessions are not surfaced here.
 *
 * A sleeping session wins over everything else: it has no live activity, and
 * "Sleeping" is clearer than a stale run/exit label. Otherwise Claude Code
 * hook activity (when present) drives the label; an exited run still wins over
 * a stale activity, and runs without activity keep the attention/run wording
 * they always had.
 */
export function activityLabel(runtime: RuntimeState | undefined): string {
  if (runtime === undefined) return 'Exited'
  if (isSleeping(runtime)) return 'Sleeping'
  const activity = runtime.activity ?? null
  if (activity !== null) {
    if (runtime.run === 'exited') return exitedLabel(runtime.exitCode)
    return activityName(activity, runtime.attention ?? null)
  }
  if (runtime.attention !== null) {
    return attentionActivityLabel(runtime.attention)
  }
  if (runtime.run === 'running') return 'Running'
  return exitedLabel(runtime.exitCode)
}

/**
 * The hook message for a session that is asking for input, trimmed and capped
 * at 120 characters. Returns null unless the activity is `needs-input` and a
 * non-empty message was reported.
 */
export function activityDetail(runtime: RuntimeState | undefined): string | null {
  if (runtime === undefined) return null
  if ((runtime.activity ?? null) !== 'needs-input') return null
  const message = runtime.activityMessage
  if (message === undefined || message === null) return null
  const trimmed = message.trim()
  if (trimmed === '') return null
  return trimmed.slice(0, MAX_DETAIL_CHARS)
}

const MAX_DETAIL_CHARS = 120

function exitedLabel(exitCode: number | null): string {
  if (exitCode !== null && exitCode !== 0) return `Exited (${String(exitCode)})`
  return 'Exited'
}

function activityName(activity: SessionActivity, attention: AttentionReason | null): string {
  switch (activity) {
    case 'working':
      return 'Working'
    case 'finished':
      return 'Finished'
    case 'needs-input':
      return attention === 'permission' ? 'Needs permission' : 'Needs input'
  }
}

function attentionActivityLabel(reason: AttentionReason): string {
  switch (reason) {
    case 'permission':
      return 'Needs permission'
    case 'done':
      return 'Finished'
    case 'idle':
      return 'Waiting for you'
    case 'bell':
      return 'Needs attention'
    case 'unread':
      return 'Marked unread'
  }
}