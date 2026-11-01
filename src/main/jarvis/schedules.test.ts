import { describe, expect, it, vi } from 'vitest'
import type { JarvisSchedule } from '../../shared/types'
import { daysText, dueSchedules, nextRun, parseDays, parseScheduleFile, parseTime, SCHEDULE_LATE_MS, scheduleFileText, scheduleWhen } from './schedules'
import { createScheduleService } from './scheduleService'

const at = (y: number, mo: number, d: number, h: number, mi: number): number => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
const schedule = (extra: Partial<JarvisSchedule> = {}): JarvisSchedule => ({
  id: 's1', label: 'tests', instruction: 'run the tests', minutes: 9 * 60, days: [], once: false, enabled: true, createdAt: 0, lastRunAt: null, ...extra
})

describe('schedule rules', () => {
  it('parses times and day words', () => {
    expect(parseTime('9:05')).toBe(545)
    expect(parseTime('23:59')).toBe(1439)
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('9am')).toBeNull()
    expect(parseDays(undefined)).toEqual([])
    expect(parseDays('weekdays')).toEqual([1, 2, 3, 4, 5])
    expect(parseDays(['Monday', 'wed'])).toEqual([1, 3])
    expect(parseDays(['weekdays', 'weekends'])).toEqual([])
    expect(() => parseDays(['someday'])).toThrow('Unknown day "someday"')
    expect(daysText([1, 2, 3, 4, 5])).toBe('weekdays')
    expect(scheduleWhen(schedule({ days: [1, 3] }))).toBe('09:00 mon, wed')
  })

  it('finds the next run on a matching weekday', () => {
    // 2026-11-01 is a Sunday.
    expect(nextRun(schedule(), at(2026, 11, 1, 8, 0))).toBe(at(2026, 11, 1, 9, 0))
    expect(nextRun(schedule(), at(2026, 11, 1, 10, 0))).toBe(at(2026, 11, 2, 9, 0))
    expect(nextRun(schedule({ days: [1, 2, 3, 4, 5] }), at(2026, 11, 1, 8, 0))).toBe(at(2026, 11, 2, 9, 0))
    expect(nextRun(schedule({ once: true, lastRunAt: 5 }), at(2026, 11, 1, 8, 0))).toBeNull()
  })

  it('is due when the time is crossed, but not when found too late or disabled', () => {
    const list = [schedule()]
    expect(dueSchedules(list, at(2026, 11, 1, 8, 59), at(2026, 11, 1, 9, 0))).toHaveLength(1)
    expect(dueSchedules(list, at(2026, 11, 1, 9, 0), at(2026, 11, 1, 9, 1))).toHaveLength(0)
    expect(dueSchedules(list, at(2026, 11, 1, 8, 0), at(2026, 11, 1, 9, 0) + SCHEDULE_LATE_MS + 1)).toHaveLength(0)
    expect(dueSchedules([schedule({ enabled: false })], at(2026, 11, 1, 8, 59), at(2026, 11, 1, 9, 0))).toHaveLength(0)
  })

  it('round-trips the file and drops broken entries', () => {
    const text = scheduleFileText([schedule(), { ...schedule({ id: 's2' }), minutes: 9999 } as JarvisSchedule])
    expect(parseScheduleFile(text).map((s) => s.id)).toEqual(['s1'])
    expect(parseScheduleFile('{nope')).toEqual([])
  })
})

describe('createScheduleService', () => {
  function service(start: number) {
    let clock = start
    const written: string[] = []
    const delivered: JarvisSchedule[] = []
    const svc = createScheduleService({
      readFile: async () => { throw new Error('ENOENT') },
      writeFile: async (text) => { written.push(text) },
      now: () => clock,
      newId: () => 'id1',
      deliver: async (s) => { delivered.push(s) },
      onChange: vi.fn(),
      setInterval: vi.fn(() => 0 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
      onError: vi.fn()
    })
    return { svc, written, delivered, set: (t: number) => { clock = t } }
  }

  it('adds, runs once when due, and disables a one-time schedule after its run', async () => {
    const { svc, delivered, set } = service(at(2026, 11, 1, 8, 59))
    await svc.load()
    const added = svc.add({ instruction: 'wake API', time: '09:00', once: true, label: 'morning' })
    expect(added).toMatchObject({ minutes: 540, once: true, enabled: true, label: 'morning' })
    set(at(2026, 11, 1, 9, 0))
    svc.tick()
    svc.tick()
    expect(delivered).toHaveLength(1)
    expect(svc.list()[0]).toMatchObject({ enabled: false, lastRunAt: at(2026, 11, 1, 9, 0) })
  })

  it('rejects a bad time and removes or pauses by id', async () => {
    const { svc } = service(0)
    await svc.load()
    expect(() => svc.add({ instruction: 'x', time: '25:00' })).toThrow('is not a time')
    svc.add({ instruction: 'x', time: '10:00', days: 'weekdays' })
    expect(svc.setEnabled('id1', false).enabled).toBe(false)
    expect(svc.remove('id1').instruction).toBe('x')
    expect(svc.list()).toEqual([])
    expect(() => svc.remove('id1')).toThrow('No schedule')
  })
})
