// Jarvis schedules (D54): kept in <userData>/jarvis/schedules.json, checked every 30 s; a due schedule is handed to
// `deliver` (Jarvis gets the instruction as a prompt). A run that would be more than 15 minutes late is skipped.
import type { JarvisSchedule } from '../../shared/types'
import {
  dueSchedules,
  parseDays,
  parseScheduleFile,
  parseTime,
  SCHEDULE_INSTRUCTION_MAX,
  SCHEDULE_LABEL_MAX,
  SCHEDULE_MAX,
  scheduleFileText
} from './schedules'

export const SCHEDULE_TICK_MS = 30_000

export interface ScheduleInput {
  readonly instruction: string
  /** "HH:MM", local time. */
  readonly time: string
  /** Day words (see parseDays); absent = every day. */
  readonly days?: unknown
  readonly once?: boolean
  readonly label?: string
}

export interface ScheduleServiceDeps {
  readonly readFile: () => Promise<string>
  readonly writeFile: (text: string) => Promise<void>
  readonly now: () => number
  readonly newId: () => string
  readonly deliver: (schedule: JarvisSchedule) => Promise<void>
  readonly onChange: (schedules: readonly JarvisSchedule[]) => void
  readonly setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  readonly clearInterval: (timer: ReturnType<typeof setInterval>) => void
  readonly onError: (where: string, error: unknown) => void
}

export interface ScheduleService {
  load(): Promise<void>
  start(): void
  stop(): void
  list(): readonly JarvisSchedule[]
  add(input: ScheduleInput): JarvisSchedule
  remove(id: string): JarvisSchedule
  setEnabled(id: string, enabled: boolean): JarvisSchedule
  /** Runs the check once now (the timer calls this). */
  tick(): void
}

export function createScheduleService(deps: ScheduleServiceDeps): ScheduleService {
  let schedules: readonly JarvisSchedule[] = []
  let lastTick = deps.now()
  let timer: ReturnType<typeof setInterval> | null = null
  let saving: Promise<void> = Promise.resolve()

  function commit(next: readonly JarvisSchedule[]): void {
    schedules = next
    const text = scheduleFileText(next)
    saving = saving.then(() => deps.writeFile(text)).catch((error: unknown) => deps.onError('jarvis schedules save', error))
    deps.onChange(next)
  }

  function find(id: string): JarvisSchedule {
    const schedule = schedules.find((s) => s.id === id)
    if (schedule === undefined) throw new Error(`No schedule with id ${id}.`)
    return schedule
  }

  function replace(updated: JarvisSchedule): void {
    commit(schedules.map((s) => (s.id === updated.id ? updated : s)))
  }

  return {
    async load(): Promise<void> {
      try {
        schedules = parseScheduleFile(await deps.readFile())
      } catch {
        schedules = [] // no file yet
      }
      lastTick = deps.now()
      deps.onChange(schedules)
    },

    start(): void {
      if (timer !== null) return
      timer = deps.setInterval(() => this.tick(), SCHEDULE_TICK_MS)
    },

    stop(): void {
      if (timer !== null) deps.clearInterval(timer)
      timer = null
    },

    list: () => schedules,

    add(input: ScheduleInput): JarvisSchedule {
      if (schedules.length >= SCHEDULE_MAX) throw new Error(`At most ${SCHEDULE_MAX} schedules; remove one first.`)
      const instruction = input.instruction.trim()
      if (instruction.length === 0 || instruction.length > SCHEDULE_INSTRUCTION_MAX) {
        throw new Error(`The instruction must be 1 to ${SCHEDULE_INSTRUCTION_MAX} characters.`)
      }
      const minutes = parseTime(input.time)
      if (minutes === null) throw new Error(`"${input.time}" is not a time; use HH:MM in 24-hour form, e.g. 09:00 or 18:30.`)
      const label = (input.label ?? '').trim().slice(0, SCHEDULE_LABEL_MAX)
      const schedule: JarvisSchedule = {
        id: deps.newId(),
        label,
        instruction,
        minutes,
        days: parseDays(input.days),
        once: input.once === true,
        enabled: true,
        createdAt: deps.now(),
        lastRunAt: null
      }
      commit([...schedules, schedule])
      return schedule
    },

    remove(id: string): JarvisSchedule {
      const schedule = find(id)
      commit(schedules.filter((s) => s.id !== id))
      return schedule
    },

    setEnabled(id: string, enabled: boolean): JarvisSchedule {
      const updated = { ...find(id), enabled }
      replace(updated)
      return updated
    },

    tick(): void {
      const now = deps.now()
      const due = dueSchedules(schedules, lastTick, now)
      lastTick = now
      for (const schedule of due) {
        // Marked first: a slow delivery must not run it twice; a one-time schedule is done (disabled) after it.
        const ran: JarvisSchedule = { ...schedule, lastRunAt: now, enabled: schedule.once ? false : schedule.enabled }
        replace(ran)
        deps.deliver(ran).catch((error: unknown) => deps.onError(`jarvis schedule ${schedule.id}`, error))
      }
    }
  }
}
