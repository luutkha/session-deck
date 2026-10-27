import { describe, expect, it } from 'vitest'
import { MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES } from '../../shared/types'
import { REMINDER_MINUTES_MESSAGE, clampReminderMinutes, parseReminderMinutes } from './reminderValidation'

describe('clampReminderMinutes', () => {
  it('keeps values inside the range and rounds fractions', () => {
    expect(clampReminderMinutes(1)).toBe(1)
    expect(clampReminderMinutes(10)).toBe(10)
    expect(clampReminderMinutes(120)).toBe(120)
    expect(clampReminderMinutes(2.4)).toBe(2)
    expect(clampReminderMinutes(2.6)).toBe(3)
  })

  it('clamps outside the range', () => {
    expect(clampReminderMinutes(0)).toBe(MIN_REMINDER_MINUTES)
    expect(clampReminderMinutes(-3)).toBe(MIN_REMINDER_MINUTES)
    expect(clampReminderMinutes(121)).toBe(MAX_REMINDER_MINUTES)
    expect(clampReminderMinutes(99_999)).toBe(MAX_REMINDER_MINUTES)
  })

  it('falls back to the minimum for a non-finite value', () => {
    expect(clampReminderMinutes(Number.NaN)).toBe(MIN_REMINDER_MINUTES)
    expect(clampReminderMinutes(Number.POSITIVE_INFINITY)).toBe(MIN_REMINDER_MINUTES)
  })
})

describe('parseReminderMinutes', () => {
  it('parses and clamps numeric text', () => {
    expect(parseReminderMinutes('10')).toEqual({ minutes: 10, error: null })
    expect(parseReminderMinutes(' 7 ')).toEqual({ minutes: 7, error: null })
    expect(parseReminderMinutes('0')).toEqual({ minutes: MIN_REMINDER_MINUTES, error: null })
    expect(parseReminderMinutes('500')).toEqual({ minutes: MAX_REMINDER_MINUTES, error: null })
  })

  it('rejects empty and non-numeric text with a message', () => {
    expect(parseReminderMinutes('')).toEqual({ minutes: null, error: REMINDER_MINUTES_MESSAGE })
    expect(parseReminderMinutes('   ')).toEqual({ minutes: null, error: REMINDER_MINUTES_MESSAGE })
    expect(parseReminderMinutes('soon')).toEqual({ minutes: null, error: REMINDER_MINUTES_MESSAGE })
  })
})
