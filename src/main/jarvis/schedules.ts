// Jarvis schedules (D54): an instruction given to Jarvis at a local time, on some weekdays or once. Pure rules:
// parsing what the model or the file gives, and which schedules are due. Times are the PC's local time.
import { isRecord } from '../../shared/guards'
import type { JarvisSchedule } from '../../shared/types'
import { DAY_NAMES } from '../../shared/jarvisSchedule'

export { daysText, scheduleWhen, timeText } from '../../shared/jarvisSchedule'

export const SCHEDULE_MAX = 50
export const SCHEDULE_INSTRUCTION_MAX = 2000
export const SCHEDULE_LABEL_MAX = 60
/** A run found later than this (the PC slept, the app was busy) is skipped instead of run late. */
export const SCHEDULE_LATE_MS = 15 * 60_000

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** "9:05" / "09:05" -> minutes after midnight; null for anything else. */
export function parseTime(text: string): number | null {
  const match = TIME_RE.exec(text.trim())
  return match === null ? null : Number(match[1]) * 60 + Number(match[2])
}

/**
 * Weekdays (0 = Sunday) from words: "every day" / "daily" / [] = all, "weekdays", "weekends", or names like
 * ["mon", "Wednesday"]. Throws for an unknown word.
 */
export function parseDays(value: unknown): readonly number[] {
  if (value === undefined || value === null) return []
  const words = (Array.isArray(value) ? value : [value]).map((word) => {
    if (typeof word !== 'string') throw new Error('"days" must be day names.')
    return word.trim().toLowerCase()
  })
  const days = new Set<number>()
  for (const word of words) {
    if (word === '' || word === 'every day' || word === 'everyday' || word === 'daily' || word === 'all') return []
    if (word === 'weekdays' || word === 'workdays') [1, 2, 3, 4, 5].forEach((d) => days.add(d))
    else if (word === 'weekends' || word === 'weekend') [0, 6].forEach((d) => days.add(d))
    else {
      const index = DAY_NAMES.findIndex((name) => word.startsWith(name))
      if (index < 0) throw new Error(`Unknown day "${word}". Use mon, tue, wed, thu, fri, sat, sun, weekdays or every day.`)
      days.add(index)
    }
  }
  return days.size === 7 ? [] : [...days].sort((a, b) => a - b)
}

/** The next run time (epoch ms) at or after `from`, or null for a one-time schedule that already ran. */
export function nextRun(schedule: JarvisSchedule, from: number): number | null {
  if (schedule.once && schedule.lastRunAt !== null) return null
  const start = new Date(from)
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, Math.floor(schedule.minutes / 60), schedule.minutes % 60, 0, 0)
    if (day.getTime() < from) continue
    if (schedule.days.length === 0 || schedule.days.includes(day.getDay())) return day.getTime()
  }
  return null
}

/** Schedules whose run time falls in (since, now] and is not more than SCHEDULE_LATE_MS ago. */
export function dueSchedules(schedules: readonly JarvisSchedule[], since: number, now: number): readonly JarvisSchedule[] {
  return schedules.filter((schedule) => {
    if (!schedule.enabled) return false
    const at = nextRun(schedule, since + 1)
    return at !== null && at <= now && now - at <= SCHEDULE_LATE_MS
  })
}

/** One stored schedule, or null when the shape is wrong (a broken entry is dropped, never the whole file). */
export function parseStoredSchedule(raw: unknown): JarvisSchedule | null {
  if (!isRecord(raw)) return null
  const { id, label, instruction, minutes, days, once, enabled, createdAt, lastRunAt } = raw
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null
  if (typeof label !== 'string' || label.length > SCHEDULE_LABEL_MAX) return null
  if (typeof instruction !== 'string' || instruction.trim().length === 0 || instruction.length > SCHEDULE_INSTRUCTION_MAX) return null
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) return null
  if (!Array.isArray(days) || days.some((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6)) return null
  if (typeof once !== 'boolean' || typeof enabled !== 'boolean' || typeof createdAt !== 'number') return null
  if (lastRunAt !== null && typeof lastRunAt !== 'number') return null
  return { id, label, instruction, minutes, days: [...new Set(days as number[])].sort((a, b) => a - b), once, enabled, createdAt, lastRunAt }
}

export function parseScheduleFile(text: string): readonly JarvisSchedule[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.schedules)) return []
  return parsed.schedules.map(parseStoredSchedule).filter((s): s is JarvisSchedule => s !== null).slice(0, SCHEDULE_MAX)
}

export function scheduleFileText(schedules: readonly JarvisSchedule[]): string {
  return JSON.stringify({ version: 1, schedules }, null, 2)
}
