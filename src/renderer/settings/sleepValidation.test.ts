import { describe, expect, it } from 'vitest'
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'
import { SLEEP_MINUTES_MESSAGE, clampSleepMinutes, parseSleepMinutes } from './sleepValidation'

describe('clampSleepMinutes', () => {
  it('keeps an in-range integer', () => {
    expect(clampSleepMinutes(30)).toBe(30)
    expect(clampSleepMinutes(MIN_SLEEP_MINUTES)).toBe(MIN_SLEEP_MINUTES)
    expect(clampSleepMinutes(MAX_SLEEP_MINUTES)).toBe(MAX_SLEEP_MINUTES)
  })

  it('clamps to the allowed range', () => {
    expect(clampSleepMinutes(0)).toBe(MIN_SLEEP_MINUTES)
    expect(clampSleepMinutes(-5)).toBe(MIN_SLEEP_MINUTES)
    expect(clampSleepMinutes(MAX_SLEEP_MINUTES + 100)).toBe(MAX_SLEEP_MINUTES)
  })

  it('rounds fractions to a whole number', () => {
    expect(clampSleepMinutes(29.4)).toBe(29)
    expect(clampSleepMinutes(29.5)).toBe(30)
    expect(clampSleepMinutes(0.4)).toBe(MIN_SLEEP_MINUTES)
  })

  it('falls back to the minimum for non-finite values', () => {
    expect(clampSleepMinutes(Number.NaN)).toBe(MIN_SLEEP_MINUTES)
    expect(clampSleepMinutes(Number.POSITIVE_INFINITY)).toBe(MIN_SLEEP_MINUTES)
  })
})

describe('parseSleepMinutes', () => {
  it('accepts a valid number and clamps it', () => {
    expect(parseSleepMinutes('15')).toEqual({ minutes: 15, error: null })
    expect(parseSleepMinutes(' 15 ')).toEqual({ minutes: 15, error: null })
    expect(parseSleepMinutes('99999')).toEqual({ minutes: MAX_SLEEP_MINUTES, error: null })
    expect(parseSleepMinutes('0')).toEqual({ minutes: MIN_SLEEP_MINUTES, error: null })
  })

  it('rejects an empty or non-numeric value with a message', () => {
    expect(parseSleepMinutes('')).toEqual({ minutes: null, error: SLEEP_MINUTES_MESSAGE })
    expect(parseSleepMinutes('   ')).toEqual({ minutes: null, error: SLEEP_MINUTES_MESSAGE })
    expect(parseSleepMinutes('abc')).toEqual({ minutes: null, error: SLEEP_MINUTES_MESSAGE })
  })
})
