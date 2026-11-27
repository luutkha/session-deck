import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { USAGE_PROVIDERS } from '../../shared/types'
import type {
  AccountUsage,
  SessionUsage,
  UsageProvider,
  UsageRefreshError,
  UsageRefreshErrorKind,
  UsageState
} from '../../shared/types'
import { UsageChips, type UsageChipsProps } from './UsageChips'
import {
  accountHasData,
  accountsForDisplay,
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
  providerLabel,
  providerOf,
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

describe('provider helpers (all six providers)', () => {
  const claude: AccountUsage = {
    provider: 'claude',
    fiveHour: { usedPercentage: 38, resetsAt: 1000 },
    sevenDay: { usedPercentage: 34, resetsAt: 2000 },
    updatedAt: 5
  }
  const go: AccountUsage = {
    provider: 'opencode-go',
    fiveHour: { usedPercentage: 7, resetsAt: 1000 },
    sevenDay: { usedPercentage: 3, resetsAt: 2000 },
    monthly: { usedPercentage: 1, resetsAt: 3000 },
    updatedAt: 6
  }
  const legacy: AccountUsage = { fiveHour: null, sevenDay: null, updatedAt: 7 }

  it('treats a row without a provider as Claude', () => {
    expect(providerOf(legacy)).toBe('claude')
    expect(providerOf(go)).toBe('opencode-go')
  })

  it('labels the groups for the status bar', () => {
    expect(providerLabel('claude')).toBe('Claude')
    expect(providerLabel('opencode-go')).toBe('Go')
    expect(providerLabel('codex')).toBe('Codex')
    expect(providerLabel('cursor')).toBe('Cursor')
    expect(providerLabel('kimi')).toBe('Kimi')
    expect(providerLabel('grok')).toBe('Grok')
  })

  it('requires at least one window (including monthly) for a row to be displayable', () => {
    expect(accountHasData(legacy)).toBe(false)
    expect(accountHasData({ ...go, fiveHour: null, sevenDay: null, monthly: null })).toBe(false)
    expect(accountHasData({ ...go, fiveHour: null, sevenDay: null })).toBe(true)
    expect(accountHasData(claude)).toBe(true)
  })

  it('reads legacy state (no list) as a single Claude row and orders Claude first', () => {
    expect(accountsForDisplay({ account: claude, sessions: [] })).toEqual([claude])
    expect(accountsForDisplay({ account: claude, accounts: [go, claude], sessions: [] })).toEqual([claude, go])
  })

  it('drops empty rows and duplicate providers', () => {
    const state: UsageState = { account: null, accounts: [legacy, go, { ...go, updatedAt: 9 }], sessions: [] }
    expect(accountsForDisplay(state)).toEqual([go])
  })

  it('orders all six providers by USAGE_PROVIDERS, whatever order main sends', () => {
    const rows: readonly AccountUsage[] = USAGE_PROVIDERS.map(
      (provider: UsageProvider, index): AccountUsage => ({
        provider,
        fiveHour: { usedPercentage: index, resetsAt: 1000 + index },
        sevenDay: null,
        ...(provider === 'claude' ? {} : { monthly: { usedPercentage: index, resetsAt: 2000 + index } }),
        updatedAt: index + 1
      })
    )
    const state: UsageState = { account: null, accounts: [...rows].reverse(), sessions: [] }
    expect(accountsForDisplay(state)).toEqual(rows)
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

  const goAccount = {
    provider: 'opencode-go' as const,
    fiveHour: { usedPercentage: 7, resetsAt: 1000 },
    sevenDay: null,
    monthly: null,
    updatedAt: 7
  }

  it('keeps a cached Claude row when main only knows about Go right after a restart', () => {
    const merged = mergeUsageState(
      { account, accounts: [account], sessions: [] },
      { account: null, accounts: [goAccount], sessions: [session] }
    )
    expect(merged.accounts).toEqual([account, goAccount])
    expect(merged.account).toBe(account)
    expect(merged.sessions).toEqual([session])
  })

  it('replaces a cached row when the update carries that provider', () => {
    const newer = { ...account, updatedAt: 9 }
    const merged = mergeUsageState(
      { account, accounts: [account], sessions: [] },
      { account: newer, accounts: [newer], sessions: [] }
    )
    expect(merged.accounts).toEqual([newer])
    expect(merged.account).toBe(newer)
  })

  it('drops a cached Go row when main stops reporting it (the settings toggle)', () => {
    const merged = mergeUsageState(
      { account: null, accounts: [goAccount], sessions: [] },
      { account, accounts: [account], sessions: [] }
    )
    expect(merged.accounts).toEqual([account])
    expect(merged.account).toBe(account)
  })

  it('drops a cached agent row when main stops reporting it, but replaces it when present', () => {
    const codex: AccountUsage = {
      provider: 'codex',
      fiveHour: { usedPercentage: 5, resetsAt: 1000 },
      sevenDay: null,
      monthly: null,
      updatedAt: 7
    }
    const dropped = mergeUsageState(
      { account: null, accounts: [account, codex], sessions: [] },
      { account, accounts: [account], sessions: [] }
    )
    expect(dropped.accounts).toEqual([account])

    const newer = { ...codex, updatedAt: 9 }
    const replaced = mergeUsageState(
      { account: null, accounts: [account, codex], sessions: [] },
      { account: null, accounts: [newer], sessions: [] }
    )
    expect(replaced.accounts).toEqual([account, newer])
  })

  it('counts an accounts-only update as fresh', () => {
    expect(carriesFreshAccount({ account: null, accounts: [goAccount], sessions: [] })).toBe(true)
  })

  it('keeps the cached list exactly when the update has no list at all', () => {
    const merged = mergeUsageState(
      { account, accounts: [account, goAccount], sessions: [] },
      { account: null, sessions: [session] }
    )
    expect(merged.accounts).toEqual([account, goAccount])
    expect(merged.account).toBe(account)
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

// Component markup is checked with react-dom/server: this repo's Vitest environment has no DOM.
describe('UsageChips provider groups', () => {
  const now = 1_700_000_000_000

  function chipAccount(provider: UsageProvider, index: number): AccountUsage {
    return {
      provider,
      fiveHour: { usedPercentage: 30 + index, resetsAt: 1_700_000_000 },
      sevenDay: { usedPercentage: 20 + index, resetsAt: null },
      ...(provider === 'claude' ? {} : { monthly: { usedPercentage: 5 + index, resetsAt: 1_700_300_000 } }),
      updatedAt: now
    }
  }

  function renderChips(
    accounts: readonly AccountUsage[],
    props: Partial<UsageChipsProps> = {}
  ): string {
    return renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(UsageChips, {
          state: { account: null, accounts, sessions: [] },
          activeSessionId: null,
          stale: false,
          now,
          ...props
        })
      )
    )
  }

  function groupOf(markup: string, provider: UsageProvider): string {
    const marker = `data-account="${provider}"`
    const index = markup.indexOf(marker)
    expect(index, marker).toBeGreaterThanOrEqual(0)
    return markup.slice(markup.lastIndexOf('<div', index), markup.indexOf('</div>', index) + 6)
  }

  const rows = USAGE_PROVIDERS.map(chipAccount)

  it('renders every provider group in accounts order', () => {
    const markup = renderChips(rows)
    const positions = USAGE_PROVIDERS.map((provider) => markup.indexOf(`data-account="${provider}"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('shows the Month chip for a non-Go provider with a monthly window', () => {
    expect(groupOf(renderChips(rows), 'kimi')).toContain('>Month<')
  })

  it('hides only the four new providers when showAgentUsage is false', () => {
    const markup = renderChips(rows, { showAgentUsage: false })
    expect(markup).toContain('data-account="claude"')
    expect(markup).toContain('data-account="opencode-go"')
    for (const provider of ['codex', 'cursor', 'kimi', 'grok'] as const) {
      expect(markup).not.toContain(`data-account="${provider}"`)
    }
  })

  it('keeps showOpencodeGo independent of showAgentUsage', () => {
    const withoutGo = renderChips(rows, { showOpencodeGo: false })
    expect(withoutGo).not.toContain('data-account="opencode-go"')
    for (const provider of ['claude', 'codex', 'cursor', 'kimi', 'grok'] as const) {
      expect(withoutGo).toContain(`data-account="${provider}"`)
    }
    const neither = renderChips(rows, { showOpencodeGo: false, showAgentUsage: false })
    expect(neither).toContain('data-account="claude"')
    expect(neither).not.toContain('data-account="opencode-go"')
    expect(neither).not.toContain('data-account="kimi"')
  })

  it('shows provider labels only with two or more groups', () => {
    expect(renderChips([rows[0]])).not.toContain('aria-hidden="true">Claude</span>')
    const markup = renderChips([rows[0], rows[2]])
    expect(markup).toContain('aria-hidden="true">Claude</span>')
    expect(markup).toContain('aria-hidden="true">Codex</span>')
  })
})
