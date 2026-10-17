import { describe, expect, it } from 'vitest'
import type { WorkerInfo } from '../../shared/types'
import { formatCost, formatElapsed, formatTokens, nextExpiryIn, shortModel, statusText, visibleWorkers, WORKER_LINGER_MS } from './workerLogic'

const w = (id: string, over: Partial<WorkerInfo> = {}): WorkerInfo => ({
  id, name: id, model: 'p/m', status: 'running', statusDetail: 'running', startedAt: 0, finishedAt: null,
  costUsd: 0, tokens: 0, dir: 'd', ownerSessionIds: ['s1'], lines: [], ...over
})

describe('visibleWorkers', () => {
  const base = { dismissed: new Set<string>(), selectedId: null, now: 1_000_000 }
  it('shows only the active session workers', () => {
    const list = [w('a'), w('b', { ownerSessionIds: ['s2'] })]
    expect(visibleWorkers({ ...base, workers: list, activeSessionId: 's1' }).map((x) => x.id)).toEqual(['a'])
    expect(visibleWorkers({ ...base, workers: list, activeSessionId: null })).toEqual([])
  })
  it('hides dismissed workers', () => {
    expect(visibleWorkers({ ...base, workers: [w('a')], activeSessionId: 's1', dismissed: new Set(['a']) })).toEqual([])
  })
  it('closes a finished worker after the linger time, but not while it is being read', () => {
    const finished = w('a', { status: 'done', finishedAt: base.now - WORKER_LINGER_MS - 1 })
    expect(visibleWorkers({ ...base, workers: [finished], activeSessionId: 's1' })).toEqual([])
    expect(visibleWorkers({ ...base, workers: [finished], activeSessionId: 's1', selectedId: 'a' })).toHaveLength(1)
    const recent = w('b', { status: 'done', finishedAt: base.now - 1000 })
    expect(visibleWorkers({ ...base, workers: [recent], activeSessionId: 's1' })).toHaveLength(1)
  })
})

describe('nextExpiryIn', () => {
  it('is the time left of the soonest finished unselected worker', () => {
    const list = [w('r'), w('a', { finishedAt: 1000 }), w('b', { finishedAt: 5000 })]
    expect(nextExpiryIn(list, null, 2000)).toBe(1000 + WORKER_LINGER_MS - 2000)
    expect(nextExpiryIn(list, 'a', 2000)).toBe(5000 + WORKER_LINGER_MS - 2000)
    expect(nextExpiryIn([w('r')], null, 0)).toBeNull()
  })
})

describe('formatting', () => {
  it('formats model, time, cost and tokens', () => {
    expect(shortModel('opencode-go/glm-5.3-flash')).toBe('glm-5.3-flash')
    expect(shortModel('plain')).toBe('plain')
    expect(formatElapsed(9000)).toBe('9s')
    expect(formatElapsed(125000)).toBe('2m 05s')
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.004)).toBe('<$0.01')
    expect(formatCost(1.234)).toBe('$1.23')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12345)).toBe('12.3k')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
  it('explains failures in plain words', () => {
    expect(statusText({ status: 'running', statusDetail: 'running' })).toBe('Working…')
    expect(statusText({ status: 'failed', statusDetail: 'rate-limited' })).toContain('usage limit')
    expect(statusText({ status: 'failed', statusDetail: 'lost' })).toContain('ended unexpectedly')
    expect(statusText({ status: 'failed', statusDetail: 'weird' })).toBe('Stopped: weird')
  })
})
