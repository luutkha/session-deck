import { describe, expect, it } from 'vitest'
import { USAGE_PROVIDERS } from '../../shared/types'
import type { AccountUsage, UsageProvider } from '../../shared/types'
import { parseCachedAccounts, serializeAccounts } from './usageCache'

const valid: AccountUsage = {
  provider: 'claude',
  fiveHour: { usedPercentage: 38, resetsAt: 1_700_000_000 },
  sevenDay: { usedPercentage: 72, resetsAt: null },
  updatedAt: 1_700_000_000_000
}

const go: AccountUsage = {
  provider: 'opencode-go',
  fiveHour: { usedPercentage: 7, resetsAt: 1_700_000_000 },
  sevenDay: { usedPercentage: 3, resetsAt: null },
  monthly: { usedPercentage: 1, resetsAt: 1_700_300_000 },
  updatedAt: 1_700_000_100_000
}

describe('parseCachedAccounts', () => {
  it('returns null for null input', () => {
    expect(parseCachedAccounts(null)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parseCachedAccounts('{not json')).toBeNull()
    expect(parseCachedAccounts('')).toBeNull()
  })

  it('returns null for non-object payloads', () => {
    expect(parseCachedAccounts('42')).toBeNull()
    expect(parseCachedAccounts('"hi"')).toBeNull()
    expect(parseCachedAccounts('null')).toBeNull()
    expect(parseCachedAccounts('[]')).toBeNull()
  })

  it('round-trips the multi-provider list', () => {
    expect(parseCachedAccounts(serializeAccounts([valid, go]))).toEqual([valid, go])
  })

  it('reads the legacy single-account cache as one Claude row', () => {
    const legacy = { fiveHour: valid.fiveHour, sevenDay: valid.sevenDay, updatedAt: valid.updatedAt }
    expect(parseCachedAccounts(JSON.stringify(legacy))).toEqual([legacy])
  })

  it('keeps an explicit provider supplied by a newer cache', () => {
    expect(parseCachedAccounts(JSON.stringify(valid))).toEqual([valid])
  })

  it('drops duplicate providers (first wins) and keeps the surviving order', () => {
    const secondClaude = { ...valid, updatedAt: 2 }
    const parsed = parseCachedAccounts(JSON.stringify([valid, go, secondClaude]))
    expect(parsed).toEqual([valid, go])
  })

  it('skips corrupt entries but keeps the usable ones', () => {
    const parsed = parseCachedAccounts(JSON.stringify([{ nope: true }, valid, 42, go]))
    expect(parsed).toEqual([valid, go])
  })

  it('returns null when every entry is corrupt', () => {
    expect(parseCachedAccounts(JSON.stringify([{ updatedAt: 'x' }, null]))).toBeNull()
  })

  it('treats missing windows as null (legacy rows)', () => {
    const payload = JSON.stringify({ updatedAt: 1 })
    expect(parseCachedAccounts(payload)).toEqual([{ fiveHour: null, sevenDay: null, updatedAt: 1 }])
  })

  it('returns null for an account whose updatedAt is missing or wrong type', () => {
    expect(parseCachedAccounts(JSON.stringify({ fiveHour: null, sevenDay: null }))).toBeNull()
    expect(
      parseCachedAccounts(JSON.stringify({ fiveHour: null, sevenDay: null, updatedAt: 'x' }))
    ).toBeNull()
    expect(
      parseCachedAccounts(JSON.stringify({ fiveHour: null, sevenDay: null, updatedAt: Number.NaN }))
    ).toBeNull()
  })

  it('round-trips every provider in USAGE_PROVIDERS, with monthly on each non-Claude one', () => {
    const accounts: readonly AccountUsage[] = USAGE_PROVIDERS.map(
      (provider: UsageProvider, index): AccountUsage => ({
        provider,
        fiveHour: { usedPercentage: index, resetsAt: 1_700_000_000 + index },
        sevenDay: { usedPercentage: index + 1, resetsAt: null },
        ...(provider === 'claude' ? {} : { monthly: { usedPercentage: index + 2, resetsAt: 1_700_300_000 } }),
        updatedAt: 1_700_000_000_000 + index
      })
    )
    expect(parseCachedAccounts(serializeAccounts(accounts))).toEqual(accounts)
  })

  it('returns null for an unknown provider', () => {
    expect(parseCachedAccounts(JSON.stringify({ ...valid, provider: 'deepseek' }))).toBeNull()
    expect(parseCachedAccounts(JSON.stringify({ ...go, provider: 'agent-zero' }))).toBeNull()
    const withUnknown = JSON.stringify([valid, go]).replace('"opencode-go"', '"unknown"')
    expect(parseCachedAccounts(withUnknown)).toEqual([valid])
  })

  it('returns null for malformed windows', () => {
    expect(
      parseCachedAccounts(JSON.stringify({ fiveHour: { usedPercentage: 'x', resetsAt: null }, updatedAt: 1 }))
    ).toBeNull()
    expect(
      parseCachedAccounts(JSON.stringify({ fiveHour: { usedPercentage: 1, resetsAt: 'x' }, updatedAt: 1 }))
    ).toBeNull()
    expect(parseCachedAccounts(JSON.stringify({ fiveHour: 5, updatedAt: 1 }))).toBeNull()
    expect(
      parseCachedAccounts(JSON.stringify({ provider: 'opencode-go', monthly: [], updatedAt: 1 }))
    ).toBeNull()
  })

  it('clamps out-of-range percentages', () => {
    const parsed = parseCachedAccounts(
      JSON.stringify({
        fiveHour: { usedPercentage: 150, resetsAt: null },
        sevenDay: { usedPercentage: -20, resetsAt: null },
        updatedAt: 1
      })
    )
    expect(parsed?.[0].fiveHour?.usedPercentage).toBe(100)
    expect(parsed?.[0].sevenDay?.usedPercentage).toBe(0)
  })

  it('keeps a Go monthly window (and omits a null one)', () => {
    const parsed = parseCachedAccounts(serializeAccounts([go]))
    expect(parsed?.[0].monthly).toEqual(go.monthly)
    const withoutMonthly = { ...go, monthly: null }
    expect(parseCachedAccounts(serializeAccounts([withoutMonthly]))?.[0].monthly).toBeUndefined()
  })
})

describe('serializeAccounts', () => {
  it('produces JSON the parser round-trips', () => {
    expect(serializeAccounts([valid, go])).toBe(JSON.stringify([valid, go]))
  })
})
