import { describe, it, expect } from 'vitest'
import type { StoreData, Group, Session, Id } from '../../shared/types'
import { computeDrop, type DragItem, type DropOver } from './dropTarget'

const makeStore = (overrides: Partial<StoreData> = {}): StoreData => ({
  version: 1,
  sessions: [],
  groups: [],
  statuses: [],
  groupOrder: [],
  ...overrides
})

const makeGroup = (id: Id, name: string, collapsed = false): Group => ({ id, name, collapsed })
const makeSession = (id: Id, name: string, groupId: Id | null, order: number, statusId: Id | null = null): Session => ({
  id,
  name,
  cwd: '/tmp',
  groupId,
  statusId,
  order,
  createdAt: Date.now(),
  claudeArgs: []
})

describe('computeDrop', () => {
  const g1 = makeGroup('g1', 'Group 1')
  const g2 = makeGroup('g2', 'Group 2')
  const s1 = makeSession('s1', 'Session 1', 'g1', 0)
  const s2 = makeSession('s2', 'Session 2', 'g1', 1)
  const s3 = makeSession('s3', 'Session 3', 'g1', 2)
  const s4 = makeSession('s4', 'Session 4', 'g2', 0)
  const u1 = makeSession('u1', 'Ungrouped 1', null, 0)
  const u2 = makeSession('u2', 'Ungrouped 2', null, 1)

  const store = makeStore({
    groups: [g1, g2],
    sessions: [s1, s2, s3, s4, u1, u2],
    groupOrder: ['g1', 'g2']
  })

  describe('session onto group header (inside)', () => {
    it('moves session to end of target group', () => {
      const drag: DragItem = { kind: 'session', id: 's4' }
      const over: DropOver = { kind: 'group', id: 'g1', position: 'inside' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's4', groupId: 'g1', index: 3 })
    })

    it('moves ungrouped session to end of group', () => {
      const drag: DragItem = { kind: 'session', id: 'u1' }
      const over: DropOver = { kind: 'group', id: 'g1', position: 'inside' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 'u1', groupId: 'g1', index: 3 })
    })

    it('returns null for unknown group id', () => {
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'group', id: 'unknown', position: 'inside' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for unknown session id', () => {
      const drag: DragItem = { kind: 'session', id: 'unknown' }
      const over: DropOver = { kind: 'group', id: 'g1', position: 'inside' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })
  })

  describe('session onto session (before/after)', () => {
    it('moves session before target in same group', () => {
      const drag: DragItem = { kind: 'session', id: 's3' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'before' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's3', groupId: 'g1', index: 0 })
    })

    it('moves session after target in same group', () => {
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'session', id: 's2', position: 'after' }
      const action = computeDrop(drag, over, store)
      // s1 at index 0, dropping after s2 (index 1) -> target index 2, but s1 removed first so index becomes 1
      expect(action).toEqual({ type: 'moveSession', sessionId: 's1', groupId: 'g1', index: 1 })
    })

    it('adjusts index when moving down in same group (old index < new index)', () => {
      // s1 at index 0, dropping after s2 (index 1) -> target index 2, but s1 removed first so index becomes 1
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'session', id: 's2', position: 'after' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's1', groupId: 'g1', index: 1 })
    })

    it('does not adjust index when moving up in same group (old index > new index)', () => {
      // s3 at index 2, dropping before s1 (index 0) -> target index 0, s3 removed after so no adjustment
      const drag: DragItem = { kind: 'session', id: 's3' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'before' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's3', groupId: 'g1', index: 0 })
    })

    it('moves session from another group before target', () => {
      const drag: DragItem = { kind: 'session', id: 's4' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'before' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's4', groupId: 'g1', index: 0 })
    })

    it('moves session from another group after target', () => {
      const drag: DragItem = { kind: 'session', id: 's4' }
      const over: DropOver = { kind: 'session', id: 's2', position: 'after' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's4', groupId: 'g1', index: 2 })
    })

    it('moves ungrouped session before target in group', () => {
      const drag: DragItem = { kind: 'session', id: 'u1' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'before' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 'u1', groupId: 'g1', index: 0 })
    })

    it('returns null when dropping on itself', () => {
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for unknown target session', () => {
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'session', id: 'unknown', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for unknown dragged session', () => {
      const drag: DragItem = { kind: 'session', id: 'unknown' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for no-op move (same position)', () => {
      // s1 at index 0, dropping before s1 is prevented above, but dropping after s1 when it's the only one?
      const singleStore = makeStore({
        groups: [g1],
        sessions: [s1],
        groupOrder: ['g1']
      })
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'after' }
      expect(computeDrop(drag, over, singleStore)).toBeNull()
    })
  })

  describe('session onto ungrouped (inside)', () => {
    it('moves session to end of ungrouped list', () => {
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'ungrouped', position: 'inside' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's1', groupId: null, index: 2 })
    })

    it('moves session from another group to end of ungrouped', () => {
      const drag: DragItem = { kind: 'session', id: 's4' }
      const over: DropOver = { kind: 'ungrouped', position: 'inside' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'moveSession', sessionId: 's4', groupId: null, index: 2 })
    })

    it('returns null for no-op (already at end of ungrouped)', () => {
      const drag: DragItem = { kind: 'session', id: 'u2' }
      const over: DropOver = { kind: 'ungrouped', position: 'inside' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for unknown session', () => {
      const drag: DragItem = { kind: 'session', id: 'unknown' }
      const over: DropOver = { kind: 'ungrouped', position: 'inside' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })
  })

  describe('group reorder (before/after)', () => {
    it('reorders groups when dropping group before another group', () => {
      const drag: DragItem = { kind: 'group', id: 'g2' }
      const over: DropOver = { kind: 'group', id: 'g1', position: 'before' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'reorderGroups', order: ['g2', 'g1'] })
    })

    it('reorders groups when dropping group after another group', () => {
      const drag: DragItem = { kind: 'group', id: 'g1' }
      const over: DropOver = { kind: 'group', id: 'g2', position: 'after' }
      const action = computeDrop(drag, over, store)
      expect(action).toEqual({ type: 'reorderGroups', order: ['g2', 'g1'] })
    })

    it('returns null for unknown group', () => {
      const drag: DragItem = { kind: 'group', id: 'unknown' }
      const over: DropOver = { kind: 'group', id: 'g1', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for unknown target group', () => {
      const drag: DragItem = { kind: 'group', id: 'g1' }
      const over: DropOver = { kind: 'group', id: 'unknown', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for no-op reorder (already in position)', () => {
      const drag: DragItem = { kind: 'group', id: 'g1' }
      const over: DropOver = { kind: 'group', id: 'g2', position: 'before' }
      // g1 is already before g2, so dropping g1 before g2 is no-op? Actually the order is g1,g2.
      // Dropping g1 before g2 would result in same order g1,g2.
      expect(computeDrop(drag, over, store)).toBeNull()
    })
  })

  describe('invalid combinations', () => {
    it('returns null for group dropped on session', () => {
      const drag: DragItem = { kind: 'group', id: 'g1' }
      const over: DropOver = { kind: 'session', id: 's1', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for group dropped on ungrouped', () => {
      const drag: DragItem = { kind: 'group', id: 'g1' }
      const over: DropOver = { kind: 'ungrouped', position: 'inside' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for group dropped on group with position inside', () => {
      const drag: DragItem = { kind: 'group', id: 'g1' }
      const over: DropOver = { kind: 'group', id: 'g2', position: 'inside' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for session dropped on group with position before/after', () => {
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'group', id: 'g1', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })

    it('returns null for session dropped on ungrouped with position before/after', () => {
      const drag: DragItem = { kind: 'session', id: 's1' }
      const over: DropOver = { kind: 'ungrouped', position: 'before' }
      expect(computeDrop(drag, over, store)).toBeNull()
    })
  })
})