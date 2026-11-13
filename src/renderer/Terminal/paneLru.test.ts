import { describe, expect, it } from 'vitest'
import { MAX_LIVE_PANES, pickEvictions, type PaneLruInput } from './paneLru'
import type { Id } from '../../shared/types'

/** lastShownAt where the given ids were shown in this order (later = more recent). */
function shownInOrder(ids: readonly Id[]): Map<Id, number> {
  const map = new Map<Id, number>()
  ids.forEach((id: Id, index: number): void => {
    map.set(id, index + 1)
  })
  return map
}

describe('pickEvictions (performance step 5: live pane cap)', () => {
  it('evicts nothing while the created panes are within the cap', () => {
    const input: PaneLruInput = {
      createdIds: ['a', 'b', 'c', 'd'],
      visibleIds: ['a'],
      lastShownAt: shownInOrder(['a', 'b', 'c', 'd']),
      max: 4
    }
    expect(pickEvictions(input)).toEqual([])
  })

  it('evicts nothing at exactly the cap', () => {
    expect(
      pickEvictions({
        createdIds: ['a', 'b', 'c'],
        visibleIds: ['a'],
        lastShownAt: shownInOrder(['a', 'b', 'c']),
        max: 3
      })
    ).toEqual([])
  })

  it('evicts the least recently shown hidden pane first', () => {
    // b was shown longest ago, then d, then c.
    const plan = pickEvictions({
      createdIds: ['a', 'b', 'c', 'd', 'e'],
      visibleIds: ['a', 'e'],
      lastShownAt: shownInOrder(['b', 'd', 'c', 'a', 'e']),
      max: 3
    })
    expect(plan).toEqual(['b', 'd'])
  })

  it('never evicts a visible pane, even when the created set is far over the cap', () => {
    const plan = pickEvictions({
      createdIds: ['a', 'b', 'c', 'd'],
      visibleIds: ['a', 'd'],
      lastShownAt: shownInOrder(['a', 'b', 'c', 'd']),
      max: 2
    })
    expect(plan).toEqual(['b', 'c'])
    expect(plan).not.toContain('a')
    expect(plan).not.toContain('d')
  })

  it('keeps every visible pane when the cap is smaller than the visible count', () => {
    const plan = pickEvictions({
      createdIds: ['a', 'b', 'c', 'd'],
      visibleIds: ['a', 'b', 'c'],
      lastShownAt: shownInOrder(['d', 'a', 'b', 'c']),
      max: 1
    })
    // d is the only evictable pane: the visible count wins over the cap.
    expect(plan).toEqual(['d'])
  })

  it('is a no-op when every created pane is visible, whatever the cap', () => {
    expect(
      pickEvictions({
        createdIds: ['a', 'b', 'c'],
        visibleIds: ['a', 'b', 'c'],
        lastShownAt: shownInOrder(['a', 'b', 'c']),
        max: 1
      })
    ).toEqual([])
  })

  it('breaks ties in createdIds order', () => {
    const lastShownAt = new Map<Id, number>([
      ['a', 7],
      ['b', 7],
      ['c', 7],
      ['d', 7]
    ])
    expect(
      pickEvictions({ createdIds: ['c', 'a', 'd', 'b'], visibleIds: [], lastShownAt, max: 2 })
    ).toEqual(['c', 'a'])
  })

  it('treats an id without a lastShownAt entry as the oldest and orders those in createdIds order', () => {
    const lastShownAt = new Map<Id, number>([
      ['a', 3],
      ['c', 4]
    ])
    expect(
      pickEvictions({ createdIds: ['a', 'b', 'c', 'd'], visibleIds: ['a'], lastShownAt, max: 2 })
    ).toEqual(['b', 'd'])
  })

  it('returns an empty list for empty input', () => {
    expect(pickEvictions({ createdIds: [], visibleIds: [], lastShownAt: new Map(), max: 0 })).toEqual([])
    expect(pickEvictions({ createdIds: [], visibleIds: ['a'], lastShownAt: new Map(), max: 4 })).toEqual([])
  })

  it('does not mutate its inputs', () => {
    const createdIds: readonly Id[] = ['a', 'b', 'c', 'd']
    const visibleIds: readonly Id[] = ['a']
    const lastShownAt = new Map<Id, number>([
      ['a', 4],
      ['b', 1],
      ['c', 3],
      ['d', 2]
    ])
    const input: PaneLruInput = { createdIds, visibleIds, lastShownAt, max: 2 }
    pickEvictions(input)
    expect(createdIds).toEqual(['a', 'b', 'c', 'd'])
    expect(visibleIds).toEqual(['a'])
    expect([...lastShownAt.entries()]).toEqual([
      ['a', 4],
      ['b', 1],
      ['c', 3],
      ['d', 2]
    ])
  })

  it('has a cap that leaves room for a split view but not for every session', () => {
    expect(MAX_LIVE_PANES).toBe(12)
    const createdIds: Id[] = []
    for (let index = 0; index < MAX_LIVE_PANES + 3; index += 1) {
      createdIds.push(`p${String(index)}`)
    }
    const plan = pickEvictions({
      createdIds,
      visibleIds: ['p0'],
      lastShownAt: shownInOrder(createdIds),
      max: MAX_LIVE_PANES
    })
    expect(plan).toHaveLength(3)
    expect(plan).toEqual(['p1', 'p2', 'p3'])
  })
})
