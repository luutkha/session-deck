// Pure validation/clamping for the "Remind again after (minutes)" input. No DOM; never throws.
import { MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES } from '../../shared/types'

export const REMINDER_MINUTES_MESSAGE = `Enter a whole number from ${MIN_REMINDER_MINUTES} to ${MAX_REMINDER_MINUTES}.`

/**
 * Rounds to the nearest integer and clamps into MIN_REMINDER_MINUTES..MAX_REMINDER_MINUTES.
 * A non-finite value (NaN, Infinity) falls back to the minimum.
 */
export function clampReminderMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_REMINDER_MINUTES
  const rounded = Math.round(value)
  if (rounded < MIN_REMINDER_MINUTES) return MIN_REMINDER_MINUTES
  if (rounded > MAX_REMINDER_MINUTES) return MAX_REMINDER_MINUTES
  return rounded
}

export interface ReminderMinutesParse {
  /** The clamped minutes when the text is a number, otherwise null. */
  readonly minutes: number | null
  /** A user-facing message when the text is empty or not a number, otherwise null. */
  readonly error: string | null
}

/** Parses the raw input text: a finite number is clamped, an empty or non-numeric value is rejected. */
export function parseReminderMinutes(text: string): ReminderMinutesParse {
  const trimmed = text.trim()
  if (trimmed === '') return { minutes: null, error: REMINDER_MINUTES_MESSAGE }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { minutes: null, error: REMINDER_MINUTES_MESSAGE }
  return { minutes: clampReminderMinutes(value), error: null }
}
