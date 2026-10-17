// Pure validation/clamping for the "Sleep after (minutes)" input. No DOM; never throws.
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'

export const SLEEP_MINUTES_MESSAGE = `Enter a whole number from ${MIN_SLEEP_MINUTES} to ${MAX_SLEEP_MINUTES}.`

/**
 * Rounds to the nearest integer and clamps into MIN_SLEEP_MINUTES..MAX_SLEEP_MINUTES.
 * A non-finite value (NaN, Infinity) falls back to the minimum.
 */
export function clampSleepMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_SLEEP_MINUTES
  const rounded = Math.round(value)
  if (rounded < MIN_SLEEP_MINUTES) return MIN_SLEEP_MINUTES
  if (rounded > MAX_SLEEP_MINUTES) return MAX_SLEEP_MINUTES
  return rounded
}

export interface SleepMinutesParse {
  /** The clamped minutes when the text is a number, otherwise null. */
  readonly minutes: number | null
  /** A user-facing message when the text is empty or not a number, otherwise null. */
  readonly error: string | null
}

/** Parses the raw input text: a finite number is clamped, an empty or non-numeric value is rejected. */
export function parseSleepMinutes(text: string): SleepMinutesParse {
  const trimmed = text.trim()
  if (trimmed === '') return { minutes: null, error: SLEEP_MINUTES_MESSAGE }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { minutes: null, error: SLEEP_MINUTES_MESSAGE }
  return { minutes: clampSleepMinutes(value), error: null }
}
