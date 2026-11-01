// D54: how a Jarvis schedule is written for people ("09:00 weekdays"), shared by the tools (main) and the panel list.
import type { JarvisSchedule } from './types'

export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export function timeText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function daysText(days: readonly number[]): string {
  if (days.length === 0) return 'every day'
  if (days.join() === '1,2,3,4,5') return 'weekdays'
  if (days.join() === '0,6') return 'weekends'
  return days.map((d) => DAY_NAMES[d]).join(', ')
}

/** "09:00 weekdays", "18:30 once" */
export function scheduleWhen(schedule: Pick<JarvisSchedule, 'minutes' | 'days' | 'once'>): string {
  return `${timeText(schedule.minutes)} ${schedule.once ? 'once' : daysText(schedule.days)}`
}
