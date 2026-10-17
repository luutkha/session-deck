import { describe, it, expect } from 'vitest'
import type { Id, StatusDef } from '../../shared/types'
import { moveStatus, nextStatusName } from './statusOrder'

const makeStatus = (id: Id, name: string): StatusDef => ({ id, name, color: '#9e9e9e' })
const three = [makeStatus('a', 'A'), makeStatus('b', 'B'), makeStatus('c', 'C')]

describe('moveStatus', () => {
  it('moves an item up', () => {
    expect(moveStatus(three, 'b', 'up')).toEqual(['b', 'a', 'c'])
  })

  it('moves an item down', () => {
    expect(moveStatus(three, 'b', 'down')).toEqual(['a', 'c', 'b'])
  })

  it('moves the first item up one into second place', () => {
    expect(moveStatus(three, 'a', 'down')).toEqual(['b', 'a', 'c'])
  })

  it('returns null for an up move at the top', () => {
    expect(moveStatus(three, 'a', 'up')).toBeNull()
  })

  it('returns null for a down move at the bottom', () => {
    expect(moveStatus(three, 'c', 'down')).toBeNull()
  })

  it('returns null for an unknown id', () => {
    expect(moveStatus(three, 'nope', 'up')).toBeNull()
    expect(moveStatus(three, 'nope', 'down')).toBeNull()
  })

  it('returns null for every move in a single-status list', () => {
    const single = [three[0]]
    expect(moveStatus(single, 'a', 'up')).toBeNull()
    expect(moveStatus(single, 'a', 'down')).toBeNull()
  })

  it('returns a full permutation (no ids lost or duplicated)', () => {
    const order = moveStatus(three, 'b', 'down')
    expect(order).not.toBeNull()
    expect([...(order ?? [])].sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input list', () => {
    const original = three.map((s: StatusDef): Id => s.id)
    moveStatus(three, 'b', 'up')
    expect(three.map((s: StatusDef): Id => s.id)).toEqual(original)
  })

  it('returns a fresh array each call', () => {
    const first = moveStatus(three, 'b', 'up')
    const second = moveStatus(three, 'b', 'up')
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})

describe('nextStatusName', () => {
  it('uses "New status" when nothing is taken', () => {
    expect(nextStatusName([])).toBe('New status')
  })

  it('numbers the second status', () => {
    expect(nextStatusName([makeStatus('s1', 'New status')])).toBe('New status 2')
  })

  it('increments past every taken default name', () => {
    const existing = [
      makeStatus('s1', 'New status'),
      makeStatus('s2', 'New status 2'),
      makeStatus('s3', 'New status 3')
    ]
    expect(nextStatusName(existing)).toBe('New status 4')
  })

  it('matches taken names case-insensitively', () => {
    expect(nextStatusName([makeStatus('s1', 'new status')])).toBe('New status 2')
  })

  it('trims names before comparing', () => {
    expect(nextStatusName([makeStatus('s1', '  New status  ')])).toBe('New status 2')
  })

  it('ignores unrelated status names', () => {
    expect(nextStatusName([makeStatus('s1', 'Todo'), makeStatus('s2', 'Done')])).toBe('New status')
  })

  it('does not mutate the input', () => {
    const original = [makeStatus('s1', 'New status')]
    nextStatusName(original)
    expect(original.length).toBe(1)
    expect(original[0].name).toBe('New status')
  })
})