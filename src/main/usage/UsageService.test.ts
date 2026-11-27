import { describe, it, expect, beforeEach } from 'vitest'
import { createUsageService, type UsageService } from './UsageService'
import type { UsageState } from '../../shared/types'
import type { PolledProvider, ProviderWindows } from './providers/providerUsageTypes'

function rateLimits(fiveHour: number, sevenDay: number): Record<string, unknown> {
  return {
    rate_limits: {
      five_hour: { used_percentage: fiveHour, resets_at: 1000 },
      seven_day: { used_percentage: sevenDay, resets_at: 2000 }
    }
  }
}

function providerWindows(fiveHour: number, sevenDay: number, monthly: number | null): ProviderWindows {
  return {
    fiveHour: { usedPercentage: fiveHour, resetsAt: 1000 },
    sevenDay: { usedPercentage: sevenDay, resetsAt: 2000 },
    monthly: monthly === null ? null : { usedPercentage: monthly, resetsAt: 3000 }
  }
}

/** A Go statusLine payload, used to prove the new providers never disturb Go or Claude. */
function goPayload(fiveHour: number, sevenDay: number, monthly: number): Record<string, unknown> {
  return {
    source: 'opencode-go',
    rate_limits: {
      five_hour: { used_percentage: fiveHour, resets_at: 1000 },
      seven_day: { used_percentage: sevenDay, resets_at: 2000 },
      monthly: { used_percentage: monthly, resets_at: 3000 }
    }
  }
}

const POLLED: readonly PolledProvider[] = ['codex', 'cursor', 'kimi', 'grok']

describe('UsageService', () => {
  let clock: number
  let service: UsageService
  let emitted: UsageState[]

  beforeEach(() => {
    clock = 1000
    service = createUsageService({ now: () => clock })
    emitted = []
    service.onChange((state) => emitted.push(state))
  })

  it('starts empty', () => {
    expect(service.getState()).toEqual({ account: null, sessions: [] })
  })

  it('stores account usage from a payload with rate_limits', () => {
    service.ingest('s1', rateLimits(38, 34))
    expect(service.getState().account).toEqual({
      provider: 'claude',
      fiveHour: { usedPercentage: 38, resetsAt: 1000 },
      sevenDay: { usedPercentage: 34, resetsAt: 2000 },
      updatedAt: 1000
    })
    expect(service.getState().accounts).toEqual([service.getState().account])
    expect(emitted).toHaveLength(1)
  })

  it('does not erase account usage when a later payload has no rate_limits', () => {
    service.ingest('s1', rateLimits(38, 34))
    clock = 2000
    service.ingest('s1', { model: { display_name: 'Opus' } })
    expect(service.getState().account?.fiveHour?.usedPercentage).toBe(38)
    expect(service.getState().account?.updatedAt).toBe(1000)
  })

  it('takes the most recent account usage', () => {
    service.ingest('s1', rateLimits(10, 10))
    clock = 3000
    service.ingest('s2', rateLimits(50, 60))
    expect(service.getState().account).toEqual({
      provider: 'claude',
      fiveHour: { usedPercentage: 50, resetsAt: 1000 },
      sevenDay: { usedPercentage: 60, resetsAt: 2000 },
      updatedAt: 3000
    })
  })

  it('stores per-session entries sorted by id and replaces a session entry', () => {
    service.ingest('b', { model: { display_name: 'Sonnet' }, cost: { total_cost_usd: 1 } })
    service.ingest('a', { model: { display_name: 'Opus' }, context_window: { used_percentage: 20 } })
    expect(service.getState().sessions.map((s) => s.sessionId)).toEqual(['a', 'b'])

    service.ingest('a', { model: { display_name: 'Haiku' }, effort: { level: 'low' } })
    const a = service.getState().sessions.find((s) => s.sessionId === 'a')
    expect(a).toEqual({
      sessionId: 'a',
      model: 'Haiku',
      contextPercent: null,
      costUsd: null,
      effort: 'low',
      updatedAt: 1000
    })
  })

  it('dedupes: an identical payload does not emit and keeps the old updatedAt', () => {
    const payload = { model: { display_name: 'Sonnet' }, ...rateLimits(5, 5) }
    service.ingest('s1', payload)
    clock = 9000
    service.ingest('s1', payload)
    expect(emitted).toHaveLength(1)
    expect(service.getState().account?.updatedAt).toBe(1000)
    expect(service.getState().sessions[0].updatedAt).toBe(1000)
  })

  it('emits when a value actually changes', () => {
    service.ingest('s1', { cost: { total_cost_usd: 1 } })
    service.ingest('s1', { cost: { total_cost_usd: 2 } })
    expect(emitted).toHaveLength(2)
    expect(emitted[1].sessions[0].costUsd).toBe(2)
  })

  it('emits when the account windows change', () => {
    service.ingest('s1', rateLimits(1, 1))
    service.ingest('s1', rateLimits(1, 2))
    expect(emitted).toHaveLength(2)
  })

  it('ignores garbage payloads without emitting', () => {
    service.ingest('s1', null)
    service.ingest('s1', 'text')
    service.ingest('s1', [1, 2])
    service.ingest('s1', { rate_limits: 'nope', model: 5 })
    service.ingest('', rateLimits(1, 1))
    expect(emitted).toHaveLength(0)
    expect(service.getState()).toEqual({ account: null, sessions: [] })
  })

  it('forget removes a session entry and emits once', () => {
    service.ingest('s1', { cost: { total_cost_usd: 1 } })
    service.ingest('s2', { cost: { total_cost_usd: 2 } })
    service.forget('s1')
    expect(service.getState().sessions.map((s) => s.sessionId)).toEqual(['s2'])
    expect(emitted).toHaveLength(3)
  })

  it('forget of an unknown session does not emit', () => {
    service.ingest('s1', { cost: { total_cost_usd: 1 } })
    service.forget('missing')
    expect(emitted).toHaveLength(1)
  })

  it('forget keeps the account usage', () => {
    service.ingest('s1', rateLimits(7, 8))
    service.forget('s1')
    expect(service.getState().account?.fiveHour?.usedPercentage).toBe(7)
  })

  it('unsubscribe stops notifications', () => {
    const calls: UsageState[] = []
    const unsubscribe = service.onChange((state) => calls.push(state))
    unsubscribe()
    service.ingest('s1', { cost: { total_cost_usd: 1 } })
    expect(calls).toHaveLength(0)
    expect(emitted).toHaveLength(1)
  })

  it('returns immutable snapshots that later ingests do not mutate', () => {
    service.ingest('s1', { cost: { total_cost_usd: 1 } })
    const before = service.getState()
    service.ingest('s1', { cost: { total_cost_usd: 5 } })
    expect(before.sessions[0].costUsd).toBe(1)
    expect(service.getState().sessions[0].costUsd).toBe(5)
  })

  describe('changed session in onChange', () => {
    it('names the session whose entry changed', () => {
      const changes: (string | undefined)[] = []
      service.onChange((_state, sessionId) => changes.push(sessionId))
      service.ingest('s1', { cost: { total_cost_usd: 1 } })
      service.ingest('s2', { model: { display_name: 'Opus' } })
      expect(changes).toEqual(['s1', 's2'])
    })

    it('names the removed session on forget', () => {
      const changes: (string | undefined)[] = []
      service.onChange((_state, sessionId) => changes.push(sessionId))
      service.ingest('s1', { cost: { total_cost_usd: 1 } })
      service.forget('s1')
      expect(changes).toEqual(['s1', 's1'])
    })

    it('omits the session when only the account changed', () => {
      const changes: (string | undefined)[] = []
      service.onChange((_state, sessionId) => changes.push(sessionId))
      service.ingestAccount({ fiveHour: { usedPercentage: 40, resetsAt: 1000 }, sevenDay: null })
      service.ingest('s1', { ...rateLimits(1, 2), cost: { total_cost_usd: 3 } })
      expect(changes).toEqual([undefined, 's1'])
    })

    it('does not report a session for a payload that changed nothing', () => {
      const changes: (string | undefined)[] = []
      service.ingest('s1', { cost: { total_cost_usd: 1 } })
      service.onChange((_state, sessionId) => changes.push(sessionId))
      service.ingest('s1', { cost: { total_cost_usd: 1 } })
      expect(changes).toEqual([])
    })
  })

  describe('ingestAccount', () => {
    const windows = {
      fiveHour: { usedPercentage: 40, resetsAt: 1000 },
      sevenDay: { usedPercentage: 12, resetsAt: 2000 }
    }

    it('sets the account usage stamped with the current time and emits once', () => {
      service.ingestAccount(windows)
      expect(service.getState().account).toEqual({ provider: 'claude', ...windows, updatedAt: 1000 })
      expect(emitted).toHaveLength(1)
    })

    it('keeps existing session entries', () => {
      service.ingest('s1', { model: { display_name: 'Opus' } })
      service.ingestAccount(windows)
      expect(service.getState().sessions).toHaveLength(1)
    })

    it('still stamps a fresh time and notifies when the numbers are unchanged (a manual refresh worked)', () => {
      service.ingestAccount(windows)
      clock = 5000
      service.ingestAccount({ fiveHour: { ...windows.fiveHour }, sevenDay: { ...windows.sevenDay } })
      expect(emitted).toHaveLength(2)
      expect(service.getState().account?.updatedAt).toBe(5000)
    })

    it('emits when a window changes', () => {
      service.ingestAccount(windows)
      clock = 6000
      service.ingestAccount({ fiveHour: { usedPercentage: 41, resetsAt: 1000 }, sevenDay: windows.sevenDay })
      expect(emitted).toHaveLength(2)
      expect(service.getState().account).toEqual({
        provider: 'claude',
        fiveHour: { usedPercentage: 41, resetsAt: 1000 },
        sevenDay: windows.sevenDay,
        updatedAt: 6000
      })
    })

    it('accepts a single window', () => {
      service.ingestAccount({ fiveHour: null, sevenDay: windows.sevenDay })
      expect(service.getState().account?.fiveHour).toBeNull()
      expect(service.getState().account?.sevenDay).toEqual(windows.sevenDay)
    })
  })

  describe('OpenCode Go provider (display only; account stays Claude)', () => {
    function goRateLimits(fiveHour: number, sevenDay: number, monthly: number): Record<string, unknown> {
      return {
        source: 'opencode-go',
        rate_limits: {
          five_hour: { used_percentage: fiveHour, resets_at: 1000 },
          seven_day: { used_percentage: sevenDay, resets_at: 2000 },
          monthly: { used_percentage: monthly, resets_at: 3000 }
        }
      }
    }

    it('keeps the two providers independent and lists Claude first', () => {
      service.ingest('s1', rateLimits(38, 34))
      clock = 2000
      service.ingest('s1', { ...goRateLimits(7, 3, 1), cost: { total_cost_usd: 0.2 } })
      const state = service.getState()
      expect(state.account).toEqual({
        provider: 'claude',
        fiveHour: { usedPercentage: 38, resetsAt: 1000 },
        sevenDay: { usedPercentage: 34, resetsAt: 2000 },
        updatedAt: 1000
      })
      expect(state.accounts).toEqual([
        state.account,
        {
          provider: 'opencode-go',
          fiveHour: { usedPercentage: 7, resetsAt: 1000 },
          sevenDay: { usedPercentage: 3, resetsAt: 2000 },
          monthly: { usedPercentage: 1, resetsAt: 3000 },
          updatedAt: 2000
        }
      ])
      // The same payload still carries the session cost.
      expect(state.sessions[0].costUsd).toBe(0.2)
    })

    it('a Go payload alone leaves the Claude account null (autopilot sees no Claude data)', () => {
      service.ingest('s1', goRateLimits(7, 3, 1))
      expect(service.getState().account).toBeNull()
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['opencode-go'])
    })

    it('a Go payload never overwrites the Claude windows, and Claude never overwrites Go', () => {
      service.ingest('s1', goRateLimits(7, 3, 1))
      service.ingest('s1', rateLimits(80, 70))
      service.ingest('s1', goRateLimits(9, 4, 2))
      const byProvider = new Map((service.getState().accounts ?? []).map((a) => [a.provider, a]))
      expect(byProvider.get('claude')?.fiveHour?.usedPercentage).toBe(80)
      expect(byProvider.get('opencode-go')?.fiveHour?.usedPercentage).toBe(9)
      expect(service.getState().account?.fiveHour?.usedPercentage).toBe(80)
    })

    it('identical Go windows do not emit and keep the old updatedAt', () => {
      service.ingest('s1', goRateLimits(7, 3, 1))
      clock = 9000
      service.ingest('s1', goRateLimits(7, 3, 1))
      expect(emitted).toHaveLength(1)
      expect(service.getState().accounts?.[0].updatedAt).toBe(1000)
    })

    it('disabling Go drops the entry at once; later Go payloads are ignored; re-enabling waits for data', () => {
      service.ingest('s1', rateLimits(38, 34))
      service.ingest('s1', goRateLimits(7, 3, 1))
      const before = emitted.length

      service.setOpencodeGoEnabled(false)
      expect(emitted).toHaveLength(before + 1)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude'])
      expect(service.getState().account?.fiveHour?.usedPercentage).toBe(38)

      service.ingest('s1', goRateLimits(50, 40, 30))
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude'])

      service.setOpencodeGoEnabled(true)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude'])
      service.ingest('s1', goRateLimits(50, 40, 30))
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude', 'opencode-go'])
    })

    it('a Go payload with no usable window adds nothing and does not emit', () => {
      service.ingest('s1', { source: 'opencode-go', rate_limits: { five_hour: { used_percentage: 'x' } } })
      expect(emitted).toHaveLength(0)
      expect(service.getState()).toEqual({ account: null, sessions: [] })
    })
  })

  describe('polled provider accounts (display only; account stays Claude)', () => {
    it('ingests every new provider with its own windows and a monthly bar', () => {
      for (const provider of POLLED) service.ingestProviderAccount(provider, providerWindows(10, 20, 30))
      const accounts = service.getState().accounts ?? []
      expect(accounts.map((a) => a.provider)).toEqual([...POLLED])
      expect(accounts[0]).toEqual({
        provider: 'codex',
        fiveHour: { usedPercentage: 10, resetsAt: 1000 },
        sevenDay: { usedPercentage: 20, resetsAt: 2000 },
        monthly: { usedPercentage: 30, resetsAt: 3000 },
        updatedAt: 1000
      })
      expect(emitted).toHaveLength(4)
    })

    it('keeps a null monthly window as null', () => {
      service.ingestProviderAccount('cursor', providerWindows(1, 2, null))
      expect(service.getState().accounts?.[0].monthly).toBeNull()
    })

    it('orders all six accounts by USAGE_PROVIDERS whichever order they arrive in', () => {
      service.ingestProviderAccount('grok', providerWindows(1, 1, 1))
      service.ingestProviderAccount('codex', providerWindows(2, 2, 2))
      service.ingest('s1', goPayload(7, 3, 1))
      service.ingest('s1', rateLimits(38, 34))
      service.ingestProviderAccount('kimi', providerWindows(3, 3, 3))
      service.ingestProviderAccount('cursor', providerWindows(4, 4, 4))
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual([
        'claude',
        'opencode-go',
        'codex',
        'cursor',
        'kimi',
        'grok'
      ])
      expect(service.getState().account?.provider).toBe('claude')
    })

    it('null removes that provider only; a null for an absent provider is a no-op', () => {
      service.ingestProviderAccount('codex', providerWindows(1, 2, 3))
      service.ingestProviderAccount('kimi', providerWindows(4, 5, 6))
      clock = 2000
      service.ingestProviderAccount('codex', null)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['kimi'])
      expect(emitted).toHaveLength(3)
      service.ingestProviderAccount('codex', null)
      expect(emitted).toHaveLength(3)
      service.ingestProviderAccount('kimi', null)
      expect(service.getState().accounts).toBeUndefined()
      expect(service.getState().account).toBeNull()
      expect(emitted).toHaveLength(4)
    })

    it('unchanged windows neither emit nor replace the entry', () => {
      service.ingestProviderAccount('kimi', providerWindows(1, 2, 3))
      const beforeState = service.getState()
      const beforeEntry = beforeState.accounts?.[0]
      clock = 9000
      service.ingestProviderAccount('kimi', providerWindows(1, 2, 3))
      expect(emitted).toHaveLength(1)
      expect(service.getState()).toBe(beforeState)
      expect(service.getState().accounts?.[0]).toBe(beforeEntry)
    })

    it('a changed window emits once and stamps the new time', () => {
      service.ingestProviderAccount('kimi', providerWindows(1, 2, 3))
      clock = 9000
      service.ingestProviderAccount('kimi', providerWindows(1, 4, 3))
      expect(emitted).toHaveLength(2)
      expect(service.getState().accounts?.[0].updatedAt).toBe(9000)
    })

    it('disabling drops all four at once, blocks ingests, and re-enabling waits for data', () => {
      service.ingest('s1', rateLimits(38, 34))
      service.ingest('s1', goPayload(7, 3, 1))
      for (const provider of POLLED) service.ingestProviderAccount(provider, providerWindows(5, 5, 5))
      const before = emitted.length

      service.setAgentUsageEnabled(false)
      expect(emitted).toHaveLength(before + 1)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude', 'opencode-go'])

      service.ingestProviderAccount('codex', providerWindows(9, 9, 9))
      service.ingestProviderAccount('codex', null)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude', 'opencode-go'])

      service.setAgentUsageEnabled(true)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude', 'opencode-go'])
      service.ingestProviderAccount('codex', providerWindows(9, 9, 9))
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude', 'opencode-go', 'codex'])
    })

    it('a no-op setAgentUsageEnabled does not emit', () => {
      service.ingest('s1', rateLimits(38, 34))
      service.setAgentUsageEnabled(false)
      const before = emitted.length
      service.setAgentUsageEnabled(false)
      service.setAgentUsageEnabled(true)
      expect(emitted).toHaveLength(before)
    })

    it('never changes the Claude account, the Go switch, or session entries', () => {
      service.ingest('s1', { ...rateLimits(38, 34), cost: { total_cost_usd: 0.5 } })
      service.ingest('s1', goPayload(7, 3, 1))
      const claude = service.getState().account
      const sessions = service.getState().sessions

      service.ingestProviderAccount('grok', providerWindows(1, 2, 3))
      expect(service.getState().account).toBe(claude)
      expect(service.getState().sessions).toBe(sessions)

      service.setAgentUsageEnabled(false)
      expect(service.getState().account).toBe(claude)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude', 'opencode-go'])
      service.setOpencodeGoEnabled(false)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude'])
      service.setAgentUsageEnabled(true)
      service.setOpencodeGoEnabled(true)
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude'])
      service.ingest('s1', goPayload(8, 4, 2))
      expect(service.getState().accounts?.map((a) => a.provider)).toEqual(['claude', 'opencode-go'])
    })
  })
})
