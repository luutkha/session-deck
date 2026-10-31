import { describe, expect, it } from 'vitest'
import type { TimelineTurn } from '../../shared/types'
import { costTotals, dailyCosts, niceMax, sessionCostRows, startOfDay } from './costLogic'

const NOW = new Date(2026, 9, 31, 15, 0, 0).getTime() // Oct 31, 15:00 local
const at = (daysAgo: number, hour = 10): number => {
  const d = new Date(2026, 9, 31, hour, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.getTime()
}
const turn = (sessionId: string, startedAt: number, costUsd: number | null): TimelineTurn => ({
  id: `${sessionId}-${startedAt}`, sessionId, prompt: '', startedAt, endedAt: startedAt + 1000, end: 'finished', costUsd, neededYou: false
})

describe('dailyCosts', () => {
  it('returns 14 local days, oldest first, ending today, summing known costs only', () => {
    const days = dailyCosts([turn('a', at(0), 0.5), turn('a', at(0, 9), 0.25), turn('a', at(3), 1), turn('a', at(3), null), turn('a', at(20), 9)], NOW)
    expect(days).toHaveLength(14)
    expect(days[13]?.dayStart).toBe(startOfDay(NOW))
    expect(days[13]).toMatchObject({ total: 0.75, turns: 2 })
    expect(days[10]).toMatchObject({ total: 1, turns: 1 })
    expect(days.reduce((sum, d) => sum + d.total, 0)).toBe(1.75)
  })
})

describe('costTotals', () => {
  it('sums today, the last 7 and the last 30 calendar days', () => {
    const turns = [turn('a', at(0), 1), turn('a', at(6), 2), turn('a', at(7), 4), turn('a', at(29), 8), turn('a', at(30), 16), turn('a', at(1), null)]
    expect(costTotals(turns, NOW)).toEqual({ today: 1, week: 3, month: 15 })
  })
})

describe('sessionCostRows', () => {
  it('lists sessions with cost in the last 30 days, most expensive first', () => {
    const map = new Map([
      ['a', [turn('a', at(0), 1)]],
      ['b', [turn('b', at(2), 3), turn('b', at(0), 0.5)]],
      ['c', [turn('c', at(40), 5)]],
      ['d', [turn('d', at(1), null)]]
    ])
    const rows = sessionCostRows([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Old' }, { id: 'd', name: 'Unknown' }], map, NOW)
    expect(rows).toEqual([
      { id: 'b', name: 'Beta', today: 0.5, week: 3.5, month: 3.5, turns: 2 },
      { id: 'a', name: 'Alpha', today: 1, week: 1, month: 1, turns: 1 }
    ])
  })
})

describe('niceMax', () => {
  it.each([[0, 1], [0.03, 0.05], [0.7, 1], [1.2, 2], [2.2, 2.5], [4, 5], [7, 10], [13, 20]])('%d -> %d', (value, expected) => {
    expect(niceMax(value)).toBeCloseTo(expected)
  })
})
