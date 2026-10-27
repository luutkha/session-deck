// Pure reminder bookkeeping for the bell escalation (D44): when each needs-you session started waiting and when its
// alert last repeated. No timers here; AttentionService owns the clock and calls these functions.
import type { AttentionReason, ReminderSettings } from '../../shared/types'
import { MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES } from '../../shared/types'

/** How often the service checks for due reminders. The user-facing interval is in minutes (1..120). */
export const REMINDER_TICK_MS = 30_000

export interface ReminderState {
  /** When the session's current needs-you state was first raised (epoch ms). */
  readonly since: Readonly<Record<string, number>>
  /** When the alert last repeated for the session (epoch ms). Absent = never repeated. */
  readonly lastRemindAt: Readonly<Record<string, number>>
}

export function emptyReminderState(): ReminderState {
  return { since: {}, lastRemindAt: {} }
}

/** Rounds to the nearest whole minute and clamps into MIN_REMINDER_MINUTES..MAX_REMINDER_MINUTES. */
export function clampReminderMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_REMINDER_MINUTES
  const rounded = Math.round(value)
  if (rounded < MIN_REMINDER_MINUTES) return MIN_REMINDER_MINUTES
  if (rounded > MAX_REMINDER_MINUTES) return MAX_REMINDER_MINUTES
  return rounded
}

/** The configured repeat interval in milliseconds (clamped, so a bad stored value can never make it 0). */
export function reminderIntervalMs(settings: ReminderSettings): number {
  return clampReminderMinutes(settings.afterMinutes) * 60_000
}

function without(record: Readonly<Record<string, number>>, id: string): Readonly<Record<string, number>> {
  if (record[id] === undefined) return record
  const next = { ...record }
  delete next[id]
  return next
}

/**
 * Arms a newly raised reason. The user's own "unread" flag never schedules a reminder.
 * A priority upgrade of an already-raised session keeps the original `since` but drops `lastRemindAt`, so the next
 * tick repeats the (more urgent) alert like a fresh raise would.
 */
export function noteRaised(state: ReminderState, id: string, at: number, reason: AttentionReason): ReminderState {
  if (reason === 'unread') return state
  if (state.since[id] !== undefined) {
    return { since: state.since, lastRemindAt: without(state.lastRemindAt, id) }
  }
  return { since: { ...state.since, [id]: at }, lastRemindAt: without(state.lastRemindAt, id) }
}

/** Records that the alert repeated now; the original wait start is kept. Unknown ids are ignored. */
export function noteReminded(state: ReminderState, id: string, at: number): ReminderState {
  if (state.since[id] === undefined) return state
  return { since: state.since, lastRemindAt: { ...state.lastRemindAt, [id]: at } }
}

/** Disarms a session when it is read, closed or forgotten. */
export function noteCleared(state: ReminderState, id: string): ReminderState {
  const since = without(state.since, id)
  const lastRemindAt = without(state.lastRemindAt, id)
  if (since === state.since && lastRemindAt === state.lastRemindAt) return state
  return { since, lastRemindAt }
}

/**
 * Ids whose alert is due again, in the order they were first raised. A reminder is due once the interval has passed
 * since whichever came last: the raise (or upgrade) or the previous reminder. Disabled = none.
 */
export function dueReminders(state: ReminderState, settings: ReminderSettings, now: number): string[] {
  if (!settings.enabled) return []
  const interval = reminderIntervalMs(settings)
  const due: string[] = []
  for (const id of Object.keys(state.since)) {
    const last = state.lastRemindAt[id]
    const baseline = last === undefined ? state.since[id] : Math.max(state.since[id], last)
    if (now - baseline >= interval) due.push(id)
  }
  return due
}
