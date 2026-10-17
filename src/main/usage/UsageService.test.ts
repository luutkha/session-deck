import { describe, it, expect, beforeEach } from 'vitest'
import { createUsageService, type UsageService } from './UsageService'
import type { UsageState } from '../../shared/types'

function rateLimits(fiveHour: number, sevenDay: number): Record<string, unknown> {
  return {
    rate_limits: {
      five_hour: { used_percentage: fiveHour, resets_at: 1000 },
      seven_day: { used_percentage: sevenDay, resets_at: 2000 }
    }
  }
}

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
      fiveHour: { usedPercentage: 38, resetsAt: 1000 },
      sevenDay: { usedPercentage: 34, resetsAt: 2000 },
      updatedAt: 1000
    })
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

  describe('ingestAccount', () => {
    const windows = {
      fiveHour: { usedPercentage: 40, resetsAt: 1000 },
      sevenDay: { usedPercentage: 12, resetsAt: 2000 }
    }

    it('sets the account usage stamped with the current time and emits once', () => {
      service.ingestAccount(windows)
      expect(service.getState().account).toEqual({ ...windows, updatedAt: 1000 })
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
})
