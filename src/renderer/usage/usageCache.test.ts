import { describe, expect, it } from 'vitest'
import type { AccountUsage } from '../../shared/types'
import { parseCachedAccountUsage, serializeAccountUsage } from './usageCache'

const valid: AccountUsage = {
  fiveHour: { usedPercentage: 38, resetsAt: 1_700_000_000 },
  sevenDay: { usedPercentage: 72, resetsAt: null },
  updatedAt: 1_700_000_000_000
}

describe('parseCachedAccountUsage', () => {
  it('returns null for null input', () => {
    expect(parseCachedAccountUsage(null)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parseCachedAccountUsage('{not json')).toBeNull()
    expect(parseCachedAccountUsage('')).toBeNull()
  })

  it('returns null for non-object payloads', () => {
    expect(parseCachedAccountUsage('42')).toBeNull()
    expect(parseCachedAccountUsage('"hi"')).toBeNull()
    expect(parseCachedAccountUsage('[]')).toBeNull()
    expect(parseCachedAccountUsage('null')).toBeNull()
  })

  it('round-trips valid data', () => {
    expect(parseCachedAccountUsage(serializeAccountUsage(valid))).toEqual(valid)
  })

  it('accepts null windows', () => {
    const payload = JSON.stringify({ fiveHour: null, sevenDay: null, updatedAt: 1 })
    expect(parseCachedAccountUsage(payload)).toEqual({ fiveHour: null, sevenDay: null, updatedAt: 1 })
  })

  it('treats missing windows as null', () => {
    const payload = JSON.stringify({ updatedAt: 1 })
    expect(parseCachedAccountUsage(payload)).toEqual({ fiveHour: null, sevenDay: null, updatedAt: 1 })
  })

  it('returns null when updatedAt is missing or wrong type', () => {
    expect(parseCachedAccountUsage(JSON.stringify({ fiveHour: null, sevenDay: null }))).toBeNull()
    expect(
      parseCachedAccountUsage(JSON.stringify({ fiveHour: null, sevenDay: null, updatedAt: 'x' }))
    ).toBeNull()
    expect(
      parseCachedAccountUsage(
        JSON.stringify({ fiveHour: null, sevenDay: null, updatedAt: Number.NaN })
      )
    ).toBeNull()
  })

  it('returns null for malformed windows', () => {
    expect(
      parseCachedAccountUsage(
        JSON.stringify({ fiveHour: { usedPercentage: 'x', resetsAt: null }, updatedAt: 1 })
      )
    ).toBeNull()
    expect(
      parseCachedAccountUsage(
        JSON.stringify({ fiveHour: { usedPercentage: 1, resetsAt: 'x' }, updatedAt: 1 })
      )
    ).toBeNull()
    expect(
      parseCachedAccountUsage(JSON.stringify({ fiveHour: 5, updatedAt: 1 }))
    ).toBeNull()
  })

  it('clamps out-of-range percentages', () => {
    const parsed = parseCachedAccountUsage(
      JSON.stringify({
        fiveHour: { usedPercentage: 150, resetsAt: null },
        sevenDay: { usedPercentage: -20, resetsAt: null },
        updatedAt: 1
      })
    )
    expect(parsed?.fiveHour?.usedPercentage).toBe(100)
    expect(parsed?.sevenDay?.usedPercentage).toBe(0)
  })
})

describe('serializeAccountUsage', () => {
  it('produces JSON the parser round-trips', () => {
    expect(serializeAccountUsage(valid)).toBe(JSON.stringify(valid))
  })
})
