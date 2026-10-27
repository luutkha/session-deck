import { describe, expect, it } from 'vitest'
import type { ReminderSettings } from '../../shared/types'
import {
  clampReminderMinutes,
  dueReminders,
  emptyReminderState,
  noteCleared,
  noteRaised,
  noteReminded,
  reminderIntervalMs
} from './reminder'

const ON: ReminderSettings = { enabled: true, afterMinutes: 10 }
const MINUTE = 60_000

describe('reminder minutes', () => {
  it('rounds and clamps into 1..120', () => {
    expect(clampReminderMinutes(1)).toBe(1)
    expect(clampReminderMinutes(120)).toBe(120)
    expect(clampReminderMinutes(0)).toBe(1)
    expect(clampReminderMinutes(-5)).toBe(1)
    expect(clampReminderMinutes(121)).toBe(120)
    expect(clampReminderMinutes(2.6)).toBe(3)
    expect(clampReminderMinutes(Number.NaN)).toBe(1)
    expect(clampReminderMinutes(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('turns minutes into milliseconds with the same clamp', () => {
    expect(reminderIntervalMs({ enabled: true, afterMinutes: 10 })).toBe(10 * MINUTE)
    expect(reminderIntervalMs({ enabled: true, afterMinutes: 0 })).toBe(MINUTE)
    expect(reminderIntervalMs({ enabled: false, afterMinutes: 999 })).toBe(120 * MINUTE)
  })
})

describe('noteRaised / noteReminded / noteCleared', () => {
  it('arms a real reason from now and repeats after the interval, not before', () => {
    let state = noteRaised(emptyReminderState(), 'a', 0, 'done')
    expect(dueReminders(state, ON, 9 * MINUTE)).toEqual([])
    expect(dueReminders(state, ON, 10 * MINUTE)).toEqual(['a'])

    state = noteReminded(state, 'a', 10 * MINUTE)
    expect(dueReminders(state, ON, 19 * MINUTE)).toEqual([])
    expect(dueReminders(state, ON, 20 * MINUTE)).toEqual(['a'])
  })

  it('keeps the original since when the alert repeats', () => {
    const raised = noteRaised(emptyReminderState(), 'a', 1000, 'idle')
    const reminded = noteReminded(raised, 'a', 5000)
    expect(reminded.since.a).toBe(1000)
    expect(reminded.lastRemindAt.a).toBe(5000)
  })

  it('never schedules the user\'s own unread flag', () => {
    const state = noteRaised(emptyReminderState(), 'a', 0, 'unread')
    expect(state).toEqual(emptyReminderState())
    expect(dueReminders(state, { enabled: true, afterMinutes: 1 }, 999 * MINUTE)).toEqual([])
  })

  it('keeps the original since on a priority upgrade but re-arms the repeat immediately', () => {
    let state = noteRaised(emptyReminderState(), 'a', 0, 'idle')
    state = noteReminded(state, 'a', 10 * MINUTE)
    state = noteRaised(state, 'a', 12 * MINUTE, 'permission')
    expect(state.since.a).toBe(0)
    expect(state.lastRemindAt.a).toBeUndefined()
    expect(dueReminders(state, ON, 12 * MINUTE)).toEqual(['a'])
  })

  it('clearing disarms the session', () => {
    let state = noteRaised(emptyReminderState(), 'a', 0, 'done')
    state = noteReminded(state, 'a', 10 * MINUTE)
    state = noteCleared(state, 'a')
    expect(state).toEqual(emptyReminderState())
    expect(dueReminders(state, ON, 99 * MINUTE)).toEqual([])
  })

  it('clearing an unknown or never-reminded session leaves the state untouched', () => {
    const empty = emptyReminderState()
    expect(noteCleared(empty, 'a')).toBe(empty)
    const raised = noteRaised(empty, 'a', 0, 'done')
    expect(noteCleared(raised, 'b')).toBe(raised)
    expect(noteReminded(raised, 'b', 1)).toBe(raised)
  })

  it('does not mutate the input state', () => {
    const empty = emptyReminderState()
    const snapshot = JSON.stringify(empty)
    noteRaised(empty, 'a', 0, 'done')
    noteReminded(empty, 'a', 1)
    noteCleared(empty, 'a')
    expect(JSON.stringify(empty)).toBe(snapshot)
  })
})

describe('dueReminders', () => {
  it('returns nothing when disabled', () => {
    const state = noteRaised(emptyReminderState(), 'a', 0, 'done')
    expect(dueReminders(state, { enabled: false, afterMinutes: 1 }, 999 * MINUTE)).toEqual([])
  })

  it('returns every due id in raise order and skips ones reminded recently', () => {
    let state = noteRaised(emptyReminderState(), 'a', 0, 'done')
    state = noteRaised(state, 'b', 2 * MINUTE, 'permission')
    expect(dueReminders(state, ON, 10 * MINUTE)).toEqual(['a'])
    state = noteReminded(state, 'a', 10 * MINUTE)
    expect(dueReminders(state, ON, 12 * MINUTE)).toEqual(['b'])
  })

  it('uses the reminder interval for a bad afterMinutes instead of firing at 0', () => {
    const state = noteRaised(emptyReminderState(), 'a', 0, 'done')
    expect(dueReminders(state, { enabled: true, afterMinutes: 0 }, MINUTE - 1)).toEqual([])
    expect(dueReminders(state, { enabled: true, afterMinutes: 0 }, MINUTE)).toEqual(['a'])
  })
})
