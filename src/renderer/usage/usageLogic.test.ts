import { describe, expect, it } from 'vitest'
import type { SessionUsage, UsageRefreshError, UsageRefreshErrorKind, UsageState } from '../../shared/types'
import {
  carriesFreshAccount,
  mergeUsageState,
  describeRefreshError,
  describeWindow,
  formatAgo,
  formatContext,
  formatCost,
  formatPercent,
  formatResetsIn,
  isStale,
  parseConsent,
  refreshCooldownLeftMs,
  serializeConsent,
  sessionUsageFor,
  usageLevel
} from './usageLogic'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('usageLevel', () => {
  it('is ok below 70', () => {
    expect(usageLevel(0)).toBe('ok')
    expect(usageLevel(69.9)).toBe('ok')
  })
  it('is warn from 70 to 89', () => {
    expect(usageLevel(70)).toBe('warn')
    expect(usageLevel(89.9)).toBe('warn')
  })
  it('is high at 90 and above', () => {
    expect(usageLevel(90)).toBe('high')
    expect(usageLevel(100)).toBe('high')
    expect(usageLevel(120)).toBe('high')
  })
  it('treats negative and non-finite input as ok', () => {
    expect(usageLevel(-5)).toBe('ok')
    expect(usageLevel(Number.NaN)).toBe('ok')
  })
})

describe('formatPercent', () => {
  it('rounds and appends a percent sign', () => {
    expect(formatPercent(38)).toBe('38%')
    expect(formatPercent(38.4)).toBe('38%')
    expect(formatPercent(38.5)).toBe('39%')
  })
  it('clamps to 0..100', () => {
    expect(formatPercent(-5)).toBe('0%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(100)).toBe('100%')
    expect(formatPercent(120)).toBe('100%')
  })
  it('treats non-finite input as 0%', () => {
    expect(formatPercent(Number.NaN)).toBe('0%')
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('0%')
  })
})

describe('formatResetsIn', () => {
  const now = 1_000_000_000
  it('returns "" when resetsAt is null', () => {
    expect(formatResetsIn(now, null)).toBe('')
  })
  it('reports "resetting now" at or past the reset time', () => {
    expect(formatResetsIn(now, (now - SECOND) / SECOND)).toBe('resetting now')
    expect(formatResetsIn(now, now / SECOND)).toBe('resetting now')
  })
  it('formats sub-minute countdowns', () => {
    expect(formatResetsIn(now, (now + 30 * SECOND) / SECOND)).toBe('resets in <1m')
  })
  it('formats minutes', () => {
    expect(formatResetsIn(now, (now + 35 * MINUTE) / SECOND)).toBe('resets in 35m')
  })
  it('formats hours and minutes', () => {
    expect(formatResetsIn(now, (now + 2 * HOUR + 10 * MINUTE) / SECOND)).toBe('resets in 2h 10m')
    expect(formatResetsIn(now, (now + 2 * HOUR) / SECOND)).toBe('resets in 2h')
  })
  it('formats days and hours', () => {
    expect(formatResetsIn(now, (now + 3 * DAY + 4 * HOUR) / SECOND)).toBe('resets in 3d 4h')
    expect(formatResetsIn(now, (now + 3 * DAY) / SECOND)).toBe('resets in 3d')
  })
  it('handles very large countdowns', () => {
    expect(formatResetsIn(now, (now + 100 * DAY + 5 * HOUR) / SECOND)).toBe('resets in 100d 5h')
  })
  it('returns "" for non-finite inputs', () => {
    expect(formatResetsIn(now, Number.NaN)).toBe('')
    expect(formatResetsIn(Number.NaN, now / SECOND)).toBe('')
  })
})

describe('formatCost', () => {
  it('returns "" for null, non-finite and negative values', () => {
    expect(formatCost(null)).toBe('')
    expect(formatCost(Number.NaN)).toBe('')
    expect(formatCost(-1)).toBe('')
  })
  it('formats zero cost', () => {
    expect(formatCost(0)).toBe('$0.00')
  })
  it('formats tiny positive costs', () => {
    expect(formatCost(0.001)).toBe('<$0.01')
    expect(formatCost(0.004)).toBe('<$0.01')
  })
  it('formats normal costs to two decimals', () => {
    expect(formatCost(0.01)).toBe('$0.01')
    expect(formatCost(0.11)).toBe('$0.11')
    expect(formatCost(12.4)).toBe('$12.40')
  })
})

describe('formatContext', () => {
  it('returns "" for null and non-finite values', () => {
    expect(formatContext(null)).toBe('')
    expect(formatContext(Number.NaN)).toBe('')
  })
  it('formats a context label', () => {
    expect(formatContext(5)).toBe('ctx 5%')
    expect(formatContext(0)).toBe('ctx 0%')
    expect(formatContext(100)).toBe('ctx 100%')
    expect(formatContext(120)).toBe('ctx 100%')
  })
})

describe('isStale', () => {
  const now = 10 * HOUR
  it('is false when fresh', () => {
    expect(isStale(now - MINUTE, now)).toBe(false)
  })
  it('is false exactly at the boundary and true past it', () => {
    expect(isStale(now - 15 * MINUTE, now)).toBe(false)
    expect(isStale(now - 15 * MINUTE - 1, now)).toBe(true)
  })
  it('honors a custom max age', () => {
    expect(isStale(now - 2 * MINUTE, now, MINUTE)).toBe(true)
  })
  it('is false for future timestamps and non-finite inputs', () => {
    expect(isStale(now + MINUTE, now)).toBe(false)
    expect(isStale(Number.NaN, now)).toBe(false)
    expect(isStale(now, Number.NaN)).toBe(false)
  })
})

describe('sessionUsageFor', () => {
  function session(id: string): SessionUsage {
    return {
      sessionId: id,
      model: 'Sonnet 5.5',
      contextPercent: 5,
      costUsd: 0.11,
      effort: 'medium',
      updatedAt: 1
    }
  }
  const state: UsageState = { account: null, sessions: [session('a'), session('b')] }
  it('finds the matching session', () => {
    expect(sessionUsageFor(state, 'b')?.sessionId).toBe('b')
  })
  it('returns null for a missing session', () => {
    expect(sessionUsageFor(state, 'zzz')).toBeNull()
  })
  it('returns null when the id is null', () => {
    expect(sessionUsageFor(state, null)).toBeNull()
  })
  it('returns null when there are no sessions', () => {
    expect(sessionUsageFor({ account: null, sessions: [] }, 'a')).toBeNull()
  })
})

describe('formatAgo', () => {
  const now = 10 * DAY
  it('returns "just now" for fresh changes and future timestamps', () => {
    expect(formatAgo(now, now - 10 * SECOND)).toBe('just now')
    expect(formatAgo(now, now + MINUTE)).toBe('just now')
  })
  it('formats minutes, hours and days', () => {
    expect(formatAgo(now, now - 3 * MINUTE)).toBe('3m ago')
    expect(formatAgo(now, now - 2 * HOUR)).toBe('2h ago')
    expect(formatAgo(now, now - 3 * DAY)).toBe('3d ago')
  })
  it('returns "" for non-finite inputs', () => {
    expect(formatAgo(Number.NaN, now)).toBe('')
    expect(formatAgo(now, Number.NaN)).toBe('')
  })
})

describe('describeWindow', () => {
  const now = 10_000_000
  it('composes a full sentence', () => {
    const sentence = describeWindow(
      '5-hour window',
      { usedPercentage: 38, resetsAt: (now + 2 * HOUR + 10 * MINUTE) / SECOND },
      now,
      now - 3 * MINUTE
    )
    expect(sentence).toBe('5-hour window: 38% used, resets in 2h 10m (updated 3m ago)')
  })
  it('omits the reset clause when there is no reset time', () => {
    const sentence = describeWindow('7-day window', { usedPercentage: 72, resetsAt: null }, now, now)
    expect(sentence).toBe('7-day window: 72% used (updated just now)')
  })
  it('reports no data for a null window', () => {
    expect(describeWindow('5-hour window', null, now, now)).toBe('5-hour window: no data')
  })
})

describe('mergeUsageState', () => {
  const account = { fiveHour: { usedPercentage: 38, resetsAt: 1000 }, sevenDay: null, updatedAt: 5 }
  const session = { sessionId: 's1', model: 'Sonnet 5.5', contextPercent: 5, costUsd: 0.1, effort: null, updatedAt: 6 }

  it('keeps the last known account usage when main reports none (right after a restart)', () => {
    const merged = mergeUsageState({ account, sessions: [] }, { account: null, sessions: [session] })
    expect(merged.account).toBe(account)
    expect(merged.sessions).toEqual([session])
  })

  it('takes the new account usage when the update carries it', () => {
    const newer = { ...account, updatedAt: 9 }
    expect(mergeUsageState({ account, sessions: [] }, { account: newer, sessions: [] }).account).toBe(newer)
  })

  it('stays empty when neither side has account usage', () => {
    expect(mergeUsageState({ account: null, sessions: [] }, { account: null, sessions: [] }).account).toBeNull()
  })

  it('only counts an update as fresh when it carries account usage', () => {
    expect(carriesFreshAccount({ account, sessions: [] })).toBe(true)
    expect(carriesFreshAccount({ account: null, sessions: [session] })).toBe(false)
  })
})

function refreshError(
  kind: UsageRefreshErrorKind,
  retryAfterMs: number | null = null
): UsageRefreshError {
  return { kind, message: 'raw', retryAfterMs }
}

describe('describeRefreshError', () => {
  const now = 1_000_000_000
  it('maps every kind to a friendly, credential-free line', () => {
    expect(describeRefreshError(refreshError('no-credentials'), now)).toBe(
      'No Claude login found. Sign in with Claude Code first.'
    )
    expect(describeRefreshError(refreshError('stale-token'), now)).toBe(
      'Your Claude login expired. Open any Claude session (it renews automatically), then try again.'
    )
    expect(describeRefreshError(refreshError('server'), now)).toBe(
      "Anthropic's usage service had a problem. Try again shortly."
    )
    expect(describeRefreshError(refreshError('network'), now)).toBe(
      'Could not reach Anthropic. Check your connection.'
    )
    expect(describeRefreshError(refreshError('unavailable'), now)).toBe(
      'Anthropic returned no usage data.'
    )
  })

  it('formats the rate-limited retry delay with the shared duration buckets', () => {
    expect(describeRefreshError(refreshError('rate-limited', 4 * MINUTE), now)).toBe(
      'Usage is rate limited right now. Try again in 4m.'
    )
    expect(describeRefreshError(refreshError('rate-limited', 2 * HOUR + 10 * MINUTE), now)).toBe(
      'Usage is rate limited right now. Try again in 2h 10m.'
    )
    expect(describeRefreshError(refreshError('rate-limited', 30 * SECOND), now)).toBe(
      'Usage is rate limited right now. Try again in <1m.'
    )
  })

  it('falls back to "in a minute" when rate-limited carries no usable delay', () => {
    const fallback = 'Usage is rate limited right now. Try again in a minute.'
    expect(describeRefreshError(refreshError('rate-limited', null), now)).toBe(fallback)
    expect(describeRefreshError(refreshError('rate-limited', 0), now)).toBe(fallback)
    expect(describeRefreshError(refreshError('rate-limited', -5), now)).toBe(fallback)
    expect(describeRefreshError(refreshError('rate-limited', Number.NaN), now)).toBe(fallback)
    expect(describeRefreshError(refreshError('rate-limited', 4 * MINUTE), Number.NaN)).toBe(fallback)
  })
})

describe('refreshCooldownLeftMs', () => {
  const failedAt = 1_000_000
  it('returns the full delay immediately after a rate-limited failure', () => {
    expect(refreshCooldownLeftMs(refreshError('rate-limited', 4 * MINUTE), failedAt, failedAt)).toBe(
      4 * MINUTE
    )
  })
  it('counts down as time passes', () => {
    expect(
      refreshCooldownLeftMs(refreshError('rate-limited', 4 * MINUTE), failedAt, failedAt + MINUTE)
    ).toBe(3 * MINUTE)
  })
  it('returns zero once the cooldown elapses', () => {
    expect(
      refreshCooldownLeftMs(refreshError('rate-limited', 4 * MINUTE), failedAt, failedAt + 5 * MINUTE)
    ).toBe(0)
  })
  it('is zero for other kinds and unusable delays', () => {
    expect(refreshCooldownLeftMs(refreshError('network'), failedAt, failedAt)).toBe(0)
    expect(refreshCooldownLeftMs(refreshError('rate-limited', null), failedAt, failedAt)).toBe(0)
    expect(refreshCooldownLeftMs(refreshError('rate-limited', 0), failedAt, failedAt)).toBe(0)
    expect(refreshCooldownLeftMs(refreshError('rate-limited', Number.NaN), failedAt, failedAt)).toBe(0)
  })
  it('is zero for non-finite timestamps', () => {
    expect(
      refreshCooldownLeftMs(refreshError('rate-limited', 4 * MINUTE), Number.NaN, failedAt)
    ).toBe(0)
    expect(
      refreshCooldownLeftMs(refreshError('rate-limited', 4 * MINUTE), failedAt, Number.NaN)
    ).toBe(0)
  })
})

describe('consent flag', () => {
  it('serializes to a value the parser round-trips as consented', () => {
    expect(parseConsent(serializeConsent())).toBe(true)
  })
  it('treats absent, empty, and corrupt values as not consented', () => {
    expect(parseConsent(null)).toBe(false)
    expect(parseConsent('')).toBe(false)
    expect(parseConsent('{not json')).toBe(false)
  })
  it('treats non-true values as not consented', () => {
    expect(parseConsent('false')).toBe(false)
    expect(parseConsent('1')).toBe(false)
    expect(parseConsent('0')).toBe(false)
    expect(parseConsent('"true"')).toBe(false)
    expect(parseConsent('{}')).toBe(false)
    expect(parseConsent('null')).toBe(false)
  })
  it('accepts a literal true', () => {
    expect(parseConsent('true')).toBe(true)
  })
})
