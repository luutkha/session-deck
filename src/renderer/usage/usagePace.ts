import type { UsageWindow } from '../../shared/types'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** localStorage key holding the sampled plan-usage history. */
export const USAGE_HISTORY_KEY = 'sessiondeck.usage.history.v1'

/** Default retention for history samples (7 days). */
export const DEFAULT_HISTORY_MAX_AGE_MS = 7 * DAY_MS
/** Default cap on stored history samples. */
export const DEFAULT_HISTORY_MAX_LEN = 2000

/** How far back each window's pace is measured. */
const FIVE_HOUR_WINDOW_MS = 90 * MINUTE_MS
const SEVEN_DAY_WINDOW_MS = 24 * HOUR_MS
/** Minimum span between the first and last sample before a slope is trusted. */
const MIN_PACE_SPAN_MS = 5 * MINUTE_MS

export type PaceWindow = 'fiveHour' | 'sevenDay'

/** One observation of the account plan windows, captured when fresh usage arrives. */
export interface PaceSample {
  readonly at: number // epoch ms
  readonly fiveHour: number | null
  readonly sevenDay: number | null
  readonly fiveHourResetsAt: number | null // epoch seconds
  readonly sevenDayResetsAt: number | null // epoch seconds
}

/** Burn-rate projection for one plan window. */
export interface Pace {
  readonly percentPerHour: number
  readonly hoursToLimit: number | null
}

/** Text shown when the projected limit lands after the window resets. */
export const PACE_WONT_HIT = "won't hit the limit before it resets"

function sameValues(a: PaceSample, b: PaceSample): boolean {
  return (
    a.fiveHour === b.fiveHour &&
    a.sevenDay === b.sevenDay &&
    a.fiveHourResetsAt === b.fiveHourResetsAt &&
    a.sevenDayResetsAt === b.sevenDayResetsAt
  )
}

/**
 * Appends one sample to the history. Identical consecutive values are dropped
 * (no new information), samples older than `maxAgeMs` are discarded, and the
 * list is capped at `maxLen` most-recent entries. Pure: never mutates `history`.
 */
export function appendSample(
  history: readonly PaceSample[],
  sample: PaceSample,
  maxAgeMs: number = DEFAULT_HISTORY_MAX_AGE_MS,
  maxLen: number = DEFAULT_HISTORY_MAX_LEN
): readonly PaceSample[] {
  const last = history.length > 0 ? history[history.length - 1] : null
  if (last !== null && sameValues(last, sample)) return history
  const cutoff = sample.at - maxAgeMs
  const kept = history.filter((entry) => entry.at >= cutoff)
  const next = [...kept, sample]
  if (next.length > maxLen) return next.slice(next.length - maxLen)
  return next
}

function percentOf(sample: PaceSample, window: PaceWindow): number | null {
  return window === 'fiveHour' ? sample.fiveHour : sample.sevenDay
}

function resetsAtOf(sample: PaceSample, window: PaceWindow): number | null {
  return window === 'fiveHour' ? sample.fiveHourResetsAt : sample.sevenDayResetsAt
}

/**
 * Projects the burn rate for one window from the samples that share the latest
 * window's `resetsAt`. Needs at least two usable samples within the window's
 * lookback (90m for 5-hour, 24h for 7-day) spanning >= 5 minutes with a
 * positive slope; otherwise returns null.
 */
export function paceFor(
  history: readonly PaceSample[],
  window: PaceWindow,
  nowMs: number
): Pace | null {
  if (!Number.isFinite(nowMs)) return null
  const lookback = window === 'fiveHour' ? FIVE_HOUR_WINDOW_MS : SEVEN_DAY_WINDOW_MS
  const relevant = history.filter((sample) => percentOf(sample, window) !== null)
  if (relevant.length < 2) return null

  const latest = relevant[relevant.length - 1]
  const resetsAt = resetsAtOf(latest, window)
  const inWindow = relevant.filter((sample) => {
    if (resetsAtOf(sample, window) !== resetsAt) return false
    return sample.at <= nowMs && sample.at >= nowMs - lookback
  })
  if (inWindow.length < 2) return null

  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  const spanMs = last.at - first.at
  if (spanMs < MIN_PACE_SPAN_MS) return null

  const firstPercent = percentOf(first, window)
  const lastPercent = percentOf(last, window)
  if (firstPercent === null || lastPercent === null) return null

  const percentPerHour = (lastPercent - firstPercent) / (spanMs / HOUR_MS)
  if (!(percentPerHour > 0)) return null

  const remaining = 100 - lastPercent
  const hoursToLimit = remaining <= 0 ? 0 : remaining / percentPerHour
  return { percentPerHour, hoursToLimit }
}

function formatDuration(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60))
  if (totalMinutes < 1) return '<1m'
  const days = Math.floor(totalMinutes / 1440)
  const hoursPart = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hoursPart > 0 ? `${String(days)}d ${String(hoursPart)}h` : `${String(days)}d`
  if (hoursPart > 0) {
    return minutes > 0
      ? `${String(hoursPart)}h ${String(minutes)}m`
      : `${String(hoursPart)}h`
  }
  return `${String(minutes)}m`
}

/**
 * Human pace sentence for a window tooltip, e.g. "~1h 20m left at this pace",
 * "won't hit the limit before it resets", or "" when there is no usable pace.
 */
export function formatPace(pace: Pace | null, resetsAtSec: number | null, nowMs: number): string {
  if (pace === null || pace.hoursToLimit === null) return ''
  if (!Number.isFinite(nowMs)) return ''
  const limitAtMs = nowMs + pace.hoursToLimit * HOUR_MS
  if (resetsAtSec !== null && Number.isFinite(resetsAtSec)) {
    if (limitAtMs > resetsAtSec * SECOND_MS) return PACE_WONT_HIT
  }
  return `~${formatDuration(pace.hoursToLimit)} left at this pace`
}

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function parseSample(value: unknown): PaceSample | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const at = finiteOrNull(record.at)
  if (typeof at !== 'number') return null
  const fiveHour = finiteOrNull(record.fiveHour)
  const sevenDay = finiteOrNull(record.sevenDay)
  const fiveHourResetsAt = finiteOrNull(record.fiveHourResetsAt)
  const sevenDayResetsAt = finiteOrNull(record.sevenDayResetsAt)
  if (
    fiveHour === undefined ||
    sevenDay === undefined ||
    fiveHourResetsAt === undefined ||
    sevenDayResetsAt === undefined
  ) {
    return null
  }
  return { at, fiveHour, sevenDay, fiveHourResetsAt, sevenDayResetsAt }
}

/** Defensive parse of the persisted history; any corrupt shape yields []. */
export function parseHistory(raw: string | null): readonly PaceSample[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const samples: PaceSample[] = []
  for (const entry of parsed) {
    const sample = parseSample(entry)
    if (sample !== null) samples.push(sample)
  }
  return samples
}

/** Serializes the history for localStorage. */
export function serializeHistory(history: readonly PaceSample[]): string {
  return JSON.stringify(history)
}

/** Builds a sample from the account windows at `updatedAtMs`. */
export function sampleFromWindows(
  updatedAtMs: number,
  fiveHour: UsageWindow | null,
  sevenDay: UsageWindow | null
): PaceSample {
  return {
    at: updatedAtMs,
    fiveHour: fiveHour?.usedPercentage ?? null,
    sevenDay: sevenDay?.usedPercentage ?? null,
    fiveHourResetsAt: fiveHour?.resetsAt ?? null,
    sevenDayResetsAt: sevenDay?.resetsAt ?? null
  }
}
