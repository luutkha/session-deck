import { describe, expect, it } from 'vitest'
import type { Group, Session, StatusDef, StoreData } from '../../shared/types'
import {
  closeSession,
  reopenSession,
  createGroup,
  createSession,
  emptyStore,
  moveSession,
  moveSessionToWorktree,
  removeGroup,
  removeSession,
  removeStatus,
  renameGroup,
  renameSession,
  reorderGroups,
  reorderStatuses,
  setClaudeSessionId,
  setCursorChatId,
  setGroupCollapsed,
  setLastActiveAt,
  setSessionStatus,
  upsertStatus
} from './reducers'

function makeSession(overrides: Partial<Session> & { id: string; name: string }): Session {
  return {
    cwd: '/home/u/proj',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    claudeSessionId: '11111111-1111-1111-1111-111111111111',
    ...overrides
  } as Session
}

function makeGroup(overrides: Partial<Group> & { id: string; name: string }): Group {
  return {
    collapsed: false,
    ...overrides
  } as Group
}

function makeStatus(overrides: Partial<StatusDef> & { id: string; name: string; color: string }): StatusDef {
  return overrides as StatusDef
}

function withGroups(store: StoreData, ...groups: Group[]): StoreData {
  return {
    ...store,
    groups: [...store.groups, ...groups],
    groupOrder: [...store.groupOrder, ...groups.map((g) => g.id)]
  }
}

function withSessions(store: StoreData, ...sessions: Session[]): StoreData {
  return { ...store, sessions: [...store.sessions, ...sessions] }
}

describe('emptyStore', () => {
  it('returns version 1 with no sessions or groups and default statuses', () => {
    const data = emptyStore()
    expect(data.version).toBe(1)
    expect(data.sessions).toEqual([])
    expect(data.groups).toEqual([])
    expect(data.groupOrder).toEqual([])
    expect(data.statuses).toHaveLength(5)
  })
})

describe('createSession', () => {
  it('creates a session with defaults from cwd', () => {
    const data = emptyStore()
    const { data: next, session } = createSession(
      data,
      { cwd: '/home/u/proj' },
      { id: 's1', now: 123 }
    )
    expect(session.name).toBe('proj')
    expect(session.cwd).toBe('/home/u/proj')
    expect(session.groupId).toBeNull()
    expect(session.statusId).toBeNull()
    expect(session.order).toBe(0)
    expect(session.createdAt).toBe(123)
    expect(session.claudeArgs).toEqual([])
    expect(next.sessions).toHaveLength(1)
  })

  it('defaults name from windows paths and trailing slashes', () => {
    const data = emptyStore()
    const { session: a } = createSession(data, { cwd: 'C:\\Work\\proj\\' }, { id: 'a', now: 1 })
    expect(a.name).toBe('proj')
    const { session: b } = createSession(data, { cwd: 'C:\\' }, { id: 'b', now: 1 })
    expect(b.name).toBe('session')
    const { session: c } = createSession(data, { cwd: '/home/u/proj/' }, { id: 'c', now: 1 })
    expect(c.name).toBe('proj')
  })

  it('uses provided name and trims it', () => {
    const data = emptyStore()
    const { session } = createSession(data, { cwd: '/x', name: '  My Session  ' }, { id: 's1', now: 1 })
    expect(session.name).toBe('My Session')
  })

  it('assigns order at the end of the target group', () => {
    const data = withSessions(
      emptyStore(),
      makeSession({ id: 's1', name: 'A', groupId: null, order: 0 }),
      makeSession({ id: 's2', name: 'B', groupId: 'g1', order: 3 })
    )
    const storeWithGroup = withGroups(data, makeGroup({ id: 'g1', name: 'G1' }))
    const { session } = createSession(storeWithGroup, { cwd: '/z', groupId: 'g1' }, { id: 's3', now: 1 })
    expect(session.order).toBe(4)
  })

  it('validates cwd is non-empty after trim', () => {
    expect(() => createSession(emptyStore(), { cwd: '   ' }, { id: 's1', now: 1 })).toThrow()
  })

  it('validates groupId exists when given', () => {
    expect(() =>
      createSession(emptyStore(), { cwd: '/x', groupId: 'missing' }, { id: 's1', now: 1 })
    ).toThrow('Unknown group: missing')
  })

  it('validates statusId exists when given', () => {
    expect(() =>
      createSession(emptyStore(), { cwd: '/x', statusId: 'missing' }, { id: 's1', now: 1 })
    ).toThrow('Unknown status: missing')
  })

  it('accepts null groupId and statusId', () => {
    const { session } = createSession(
      emptyStore(),
      { cwd: '/x', groupId: null, statusId: null },
      { id: 's1', now: 1 }
    )
    expect(session.groupId).toBeNull()
    expect(session.statusId).toBeNull()
  })

  it('preserves provided claudeArgs', () => {
    const { session } = createSession(
      emptyStore(),
      { cwd: '/x', claudeArgs: ['--verbose'] },
      { id: 's1', now: 1 }
    )
    expect(session.claudeArgs).toEqual(['--verbose'])
  })

  it('assigns a claudeSessionId equal to the session id', () => {
    const { session } = createSession(emptyStore(), { cwd: '/x' }, { id: 's1', now: 1 })
    expect(session.claudeSessionId).toBe('s1')
  })
})

describe('setClaudeSessionId', () => {
  it('sets the claudeSessionId on an existing session', () => {
    const data = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    const next = setClaudeSessionId(data, 's1', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(next.sessions[0].claudeSessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('validates UUID format', () => {
    const data = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    expect(() => setClaudeSessionId(data, 's1', 'not-a-uuid')).toThrow('Invalid claudeSessionId')
    expect(() => setClaudeSessionId(data, 's1', '')).toThrow('Invalid claudeSessionId')
  })

  it('throws for unknown session', () => {
    expect(() => setClaudeSessionId(emptyStore(), 'nope', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toThrow(
      'Unknown session: nope'
    )
  })
})

describe('renameSession', () => {
  it('renames and trims the session', () => {
    const data = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    const next = renameSession(data, 's1', '  B  ')
    expect(next.sessions[0].name).toBe('B')
  })

  it('throws for empty or long names', () => {
    const data = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    expect(() => renameSession(data, 's1', '   ')).toThrow('Name required')
    expect(() => renameSession(data, 's1', 'x'.repeat(101))).toThrow('Name too long')
  })

  it('throws for unknown session', () => {
    expect(() => renameSession(emptyStore(), 'nope', 'A')).toThrow('Unknown session: nope')
  })
})

describe('setSessionStatus', () => {
  it('sets status and clears it', () => {
    const data = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    const withStatus = setSessionStatus(data, 's1', 'working')
    expect(withStatus.sessions[0].statusId).toBe('working')
    const cleared = setSessionStatus(withStatus, 's1', null)
    expect(cleared.sessions[0].statusId).toBeNull()
  })

  it('throws for unknown status', () => {
    const data = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    expect(() => setSessionStatus(data, 's1', 'missing')).toThrow('Unknown status: missing')
  })

  it('throws for unknown session', () => {
    expect(() => setSessionStatus(emptyStore(), 'nope', 'working')).toThrow('Unknown session: nope')
  })
})

describe('moveSession', () => {
  it('moves a session to another group at the requested index', () => {
    const data = withGroups(
      withSessions(
        emptyStore(),
        makeSession({ id: 's1', name: 'A', groupId: 'g1', order: 0 }),
        makeSession({ id: 's2', name: 'B', groupId: 'g1', order: 1 }),
        makeSession({ id: 's3', name: 'C', groupId: 'g2', order: 0 })
      ),
      makeGroup({ id: 'g1', name: 'G1' }),
      makeGroup({ id: 'g2', name: 'G2' })
    )
    const next = moveSession(data, 's1', 'g2', 0)
    const g2 = next.sessions.filter((s) => s.groupId === 'g2')
    expect(g2.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(g2[0].order).toBe(0)
    expect(g2[1].order).toBe(1)
    const g1 = next.sessions.filter((s) => s.groupId === 'g1')
    expect(g1.map((s) => s.id)).toEqual(['s2'])
    expect(g1[0].order).toBe(0)
  })

  it('clamps index to 0..len and handles negatives', () => {
    const data = withGroups(
      withSessions(
        emptyStore(),
        makeSession({ id: 's1', name: 'A', groupId: 'g1', order: 0 }),
        makeSession({ id: 's2', name: 'B', groupId: 'g1', order: 1 })
      ),
      makeGroup({ id: 'g1', name: 'G1' })
    )
    expect(moveSession(data, 's1', 'g1', 99).sessions.map((s) => s.id)).toEqual(['s2', 's1'])
    expect(moveSession(data, 's1', 'g1', -1).sessions.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('moves within the same group', () => {
    const data = withGroups(
      withSessions(
        emptyStore(),
        makeSession({ id: 's1', name: 'A', groupId: 'g1', order: 0 }),
        makeSession({ id: 's2', name: 'B', groupId: 'g1', order: 1 }),
        makeSession({ id: 's3', name: 'C', groupId: 'g1', order: 2 })
      ),
      makeGroup({ id: 'g1', name: 'G1' })
    )
    const next = moveSession(data, 's1', 'g1', 2)
    expect(next.sessions.map((s) => s.id)).toEqual(['s2', 's3', 's1'])
    expect(next.sessions.map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('removes from source group and renormalizes both groups', () => {
    const data = withGroups(
      withSessions(
        emptyStore(),
        makeSession({ id: 's1', name: 'A', groupId: 'g1', order: 0 }),
        makeSession({ id: 's2', name: 'B', groupId: 'g1', order: 1 }),
        makeSession({ id: 's3', name: 'C', groupId: 'g1', order: 2 })
      ),
      makeGroup({ id: 'g1', name: 'G1' })
    )
    const next = moveSession(data, 's2', null, 0)
    const ungrouped = next.sessions.filter((s) => s.groupId === null)
    expect(ungrouped.map((s) => s.id)).toEqual(['s2'])
    expect(ungrouped[0].order).toBe(0)
    const g1 = next.sessions.filter((s) => s.groupId === 'g1')
    expect(g1.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(g1.map((s) => s.order)).toEqual([0, 1])
  })

  it('throws for unknown session', () => {
    expect(() => moveSession(emptyStore(), 'nope', null, 0)).toThrow('Unknown session: nope')
  })

  it('throws for unknown group', () => {
    const data = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A', groupId: null }))
    expect(() => moveSession(data, 's1', 'missing', 0)).toThrow('Unknown group: missing')
  })
})

describe('removeSession', () => {
  it('removes the session and renormalizes its group', () => {
    const data = withGroups(
      withSessions(
        emptyStore(),
        makeSession({ id: 's1', name: 'A', groupId: 'g1', order: 0 }),
        makeSession({ id: 's2', name: 'B', groupId: 'g1', order: 1 }),
        makeSession({ id: 's3', name: 'C', groupId: 'g2', order: 0 })
      ),
      makeGroup({ id: 'g1', name: 'G1' }),
      makeGroup({ id: 'g2', name: 'G2' })
    )
    const next = removeSession(data, 's1')
    expect(next.sessions.map((s) => s.id)).toEqual(['s2', 's3'])
    expect(next.sessions.find((s) => s.id === 's2')?.order).toBe(0)
  })

  it('throws for unknown session', () => {
    expect(() => removeSession(emptyStore(), 'nope')).toThrow('Unknown session: nope')
  })
})

describe('createGroup', () => {
  it('creates a group and appends it to groupOrder', () => {
    const data = emptyStore()
    const { data: next, group } = createGroup(data, 'My Group', 'g1')
    expect(group.name).toBe('My Group')
    expect(group.collapsed).toBe(false)
    expect(next.groups).toHaveLength(1)
    expect(next.groupOrder).toEqual(['g1'])
  })

  it('trims and validates name', () => {
    expect(() => createGroup(emptyStore(), '   ', 'g1')).toThrow('Name required')
    expect(() => createGroup(emptyStore(), 'x'.repeat(101), 'g1')).toThrow('Name too long')
  })

  it('allows duplicate names', () => {
    const { data: next } = createGroup(emptyStore(), 'Same', 'g1')
    const { group } = createGroup(next, 'Same', 'g2')
    expect(group.name).toBe('Same')
  })
})

describe('renameGroup', () => {
  it('renames and trims the group', () => {
    const data = withGroups(emptyStore(), makeGroup({ id: 'g1', name: 'A' }))
    const next = renameGroup(data, 'g1', '  B  ')
    expect(next.groups[0].name).toBe('B')
  })

  it('throws for unknown group', () => {
    expect(() => renameGroup(emptyStore(), 'nope', 'A')).toThrow('Unknown group: nope')
  })
})

describe('removeGroup', () => {
  it('removes group and appends its sessions to ungrouped keeping order', () => {
    const data = withGroups(
      withSessions(
        emptyStore(),
        makeSession({ id: 'u1', name: 'U1', groupId: null, order: 0 }),
        makeSession({ id: 's1', name: 'S1', groupId: 'g1', order: 0 }),
        makeSession({ id: 's2', name: 'S2', groupId: 'g1', order: 1 })
      ),
      makeGroup({ id: 'g1', name: 'G1' })
    )
    const next = removeGroup(data, 'g1')
    expect(next.groups).toHaveLength(0)
    expect(next.groupOrder).toEqual([])
    const ungrouped = next.sessions.filter((s) => s.groupId === null)
    expect(ungrouped.map((s) => s.id)).toEqual(['u1', 's1', 's2'])
    expect(ungrouped.map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('throws for unknown group', () => {
    expect(() => removeGroup(emptyStore(), 'nope')).toThrow('Unknown group: nope')
  })
})

describe('setGroupCollapsed', () => {
  it('updates collapsed state', () => {
    const data = withGroups(emptyStore(), makeGroup({ id: 'g1', name: 'G1', collapsed: false }))
    const next = setGroupCollapsed(data, 'g1', true)
    expect(next.groups[0].collapsed).toBe(true)
  })

  it('throws for unknown group', () => {
    expect(() => setGroupCollapsed(emptyStore(), 'nope', true)).toThrow('Unknown group: nope')
  })
})

describe('reorderGroups', () => {
  it('reorders groups', () => {
    const data = withGroups(
      emptyStore(),
      makeGroup({ id: 'g1', name: 'A' }),
      makeGroup({ id: 'g2', name: 'B' }),
      makeGroup({ id: 'g3', name: 'C' })
    )
    const next = reorderGroups(data, ['g3', 'g1', 'g2'])
    expect(next.groupOrder).toEqual(['g3', 'g1', 'g2'])
  })

  it('throws when order is missing, extra, or duplicate', () => {
    const data = withGroups(
      emptyStore(),
      makeGroup({ id: 'g1', name: 'A' }),
      makeGroup({ id: 'g2', name: 'B' })
    )
    expect(() => reorderGroups(data, ['g1'])).toThrow('Invalid group order')
    expect(() => reorderGroups(data, ['g1', 'g2', 'g3'])).toThrow('Invalid group order')
    expect(() => reorderGroups(data, ['g1', 'g1'])).toThrow('Invalid group order')
  })
})

describe('upsertStatus', () => {
  it('adds a new status', () => {
    const data = emptyStore()
    const next = upsertStatus(data, makeStatus({ id: 'new', name: 'New', color: '#123456' }))
    expect(next.statuses).toHaveLength(6)
    expect(next.statuses.find((s) => s.id === 'new')?.name).toBe('New')
  })

  it('updates an existing status', () => {
    const data = emptyStore()
    const next = upsertStatus(data, makeStatus({ id: 'todo', name: 'Pending', color: '#111111' }))
    expect(next.statuses.find((s) => s.id === 'todo')).toEqual({
      id: 'todo',
      name: 'Pending',
      color: '#111111'
    })
  })

  it('validates name and color', () => {
    expect(() => upsertStatus(emptyStore(), makeStatus({ id: 'x', name: '  ', color: '#123456' }))).toThrow(
      'Name required'
    )
    expect(() => upsertStatus(emptyStore(), makeStatus({ id: 'x', name: 'X', color: 'red' }))).toThrow(
      'Invalid status color'
    )
    expect(() => upsertStatus(emptyStore(), makeStatus({ id: 'x', name: 'X', color: '#12345' }))).toThrow(
      'Invalid status color'
    )
  })
})

describe('removeStatus', () => {
  it('removes status and clears it from sessions', () => {
    const data = withSessions(
      emptyStore(),
      makeSession({ id: 's1', name: 'A', statusId: 'working' }),
      makeSession({ id: 's2', name: 'B', statusId: 'todo' })
    )
    const next = removeStatus(data, 'working')
    expect(next.statuses.find((s) => s.id === 'working')).toBeUndefined()
    expect(next.sessions.find((s) => s.id === 's1')?.statusId).toBeNull()
    expect(next.sessions.find((s) => s.id === 's2')?.statusId).toBe('todo')
  })

  it('throws for unknown status', () => {
    expect(() => removeStatus(emptyStore(), 'nope')).toThrow('Unknown status: nope')
  })
})

describe('reorderStatuses', () => {
  const ids = (data: StoreData): string[] => data.statuses.map((s) => s.id)

  it('rearranges statuses into the given order', () => {
    const data = emptyStore()
    const current = ids(data)
    const reversed = [...current].reverse()
    const next = reorderStatuses(data, reversed)
    expect(ids(next)).toEqual(reversed)
  })

  it('keeps status definitions intact', () => {
    const data = emptyStore()
    const reversed = [...ids(data)].reverse()
    const next = reorderStatuses(data, reversed)
    expect([...next.statuses].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...data.statuses].sort((a, b) => a.id.localeCompare(b.id))
    )
  })

  it('leaves sessions and groups untouched', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A', statusId: 'working' }))
    const next = reorderStatuses(base, [...ids(base)].reverse())
    expect(next.sessions).toEqual(base.sessions)
    expect(next.groups).toEqual(base.groups)
    expect(next.groupOrder).toEqual(base.groupOrder)
  })

  it('does not mutate the input data', () => {
    const data = emptyStore()
    const before = JSON.stringify(data)
    const beforeStatuses = data.statuses
    const next = reorderStatuses(data, [...ids(data)].reverse())
    expect(JSON.stringify(data)).toBe(before)
    expect(data.statuses).toBe(beforeStatuses)
    expect(next).not.toBe(data)
    expect(next.statuses).not.toBe(data.statuses)
  })

  it('returns equal order for a no-op order', () => {
    const data = emptyStore()
    const next = reorderStatuses(data, ids(data))
    expect(ids(next)).toEqual(ids(data))
    expect(next).not.toBe(data)
  })

  it('throws when an id is missing', () => {
    const data = emptyStore()
    const order = ids(data).slice(1)
    expect(() => reorderStatuses(data, order)).toThrow('Invalid status order')
  })

  it('throws when an extra id is present', () => {
    const data = emptyStore()
    const order = [...ids(data), 'extra']
    expect(() => reorderStatuses(data, order)).toThrow('Invalid status order')
  })

  it('throws when an id is duplicated and the length still matches', () => {
    const data = emptyStore()
    const all = ids(data)
    const order = [all[0], all[0], ...all.slice(2)]
    expect(all.length).toBeGreaterThan(2)
    expect(order).toHaveLength(all.length)
    expect(() => reorderStatuses(data, order)).toThrow('Invalid status order')
  })

  it('throws when an unknown id replaces a known one', () => {
    const data = emptyStore()
    const all = ids(data)
    const order = [...all.slice(1), 'unknown']
    expect(() => reorderStatuses(data, order)).toThrow('Invalid status order')
  })

  it('throws for an empty order when statuses exist', () => {
    expect(() => reorderStatuses(emptyStore(), [])).toThrow('Invalid status order')
  })
})

describe('immutability', () => {
  it('does not mutate input store', () => {
    const original = emptyStore()
    const { data: next } = createSession(original, { cwd: '/x' }, { id: 's1', now: 1 })
    expect(original.sessions).toHaveLength(0)
    expect(next.sessions).not.toBe(original.sessions)
  })
})

describe('performance', () => {
  it('moves a session among 1000 sessions in under 100ms', () => {
    const sessions: Session[] = []
    for (let i = 0; i < 1000; i++) {
      sessions.push(makeSession({ id: `s${i}`, name: `S${i}`, groupId: 'g1', order: i }))
    }
    const data = withGroups(emptyStore(), makeGroup({ id: 'g1', name: 'G' }))
    const store = withSessions(data, ...sessions)
    const start = performance.now()
    const next = moveSession(store, 's500', 'g1', 10)
    const elapsed = performance.now() - start
    expect(next.sessions.find((s) => s.id === 's500')?.order).toBe(10)
    expect(elapsed).toBeLessThan(100)
  })
})

describe('closeSession', () => {
  it('sets closedAt to now and keeps the other fields', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A', groupId: null, statusId: 'todo' }))
    const next = closeSession(base, 's1', 5000)
    const closed = next.sessions.find((s) => s.id === 's1')
    expect(closed?.closedAt).toBe(5000)
    expect(closed?.name).toBe('A')
    expect(closed?.statusId).toBe('todo')
    expect(closed?.claudeSessionId).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('does not mutate the input', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    const snapshot = JSON.stringify(base)
    closeSession(base, 's1', 5000)
    expect(JSON.stringify(base)).toBe(snapshot)
  })

  it('is a no-op returning the same data when already closed', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A', closedAt: 100 }))
    const next = closeSession(base, 's1', 5000)
    expect(next).toBe(base)
    expect(next.sessions[0].closedAt).toBe(100)
  })

  it('throws for an unknown id', () => {
    expect(() => closeSession(emptyStore(), 'nope', 1)).toThrow('Unknown session: nope')
  })
})

describe('reopenSession', () => {
  it('removes closedAt and keeps the other fields', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A', closedAt: 100 }))
    const next = reopenSession(base, 's1')
    const session = next.sessions.find((s) => s.id === 's1')
    expect(session).toBeDefined()
    expect('closedAt' in (session ?? {})).toBe(false)
    expect(session?.name).toBe('A')
    expect(session?.claudeSessionId).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('does not mutate the input', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A', closedAt: 100 }))
    const snapshot = JSON.stringify(base)
    reopenSession(base, 's1')
    expect(JSON.stringify(base)).toBe(snapshot)
  })

  it('is a no-op returning the same data when not closed', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    expect(reopenSession(base, 's1')).toBe(base)
  })

  it('throws for an unknown id', () => {
    expect(() => reopenSession(emptyStore(), 'nope')).toThrow('Unknown session: nope')
  })

  it('round-trips close then reopen back to the original session shape', () => {
    const base = withSessions(emptyStore(), makeSession({ id: 's1', name: 'A' }))
    const roundTrip = reopenSession(closeSession(base, 's1', 9), 's1')
    expect(roundTrip.sessions).toEqual(base.sessions)
  })
})

describe('setLastActiveAt (D61)', () => {
  it('sets the time, returns the same data for the same value or an unknown id', () => {
    const { data } = createSession(emptyStore(), { cwd: '/x' }, { id: 's1', now: 1 })
    const next = setLastActiveAt(data, 's1', 50)
    expect(next.sessions[0].lastActiveAt).toBe(50)
    expect(setLastActiveAt(next, 's1', 50)).toBe(next)
    expect(setLastActiveAt(next, 'gone', 60)).toBe(next)
  })
})

describe('cursor sessions (D81)', () => {
  it('createSession stores agent cursor, a trimmed model and no Claude conversation id', () => {
    const { data, session } = createSession(
      emptyStore(),
      { cwd: '/x', agent: 'cursor', model: '  gpt-5  ' },
      { id: 's1', now: 1 }
    )
    expect(session.agent).toBe('cursor')
    expect(session.model).toBe('gpt-5')
    expect(session.claudeSessionId).toBeUndefined()
    expect(data.sessions[0]).toBe(session)
  })

  it('an empty or missing model is stored as none', () => {
    const empty = createSession(emptyStore(), { cwd: '/x', agent: 'cursor', model: '   ' }, { id: 's1', now: 1 })
    expect(empty.session.model).toBeUndefined()
    const missing = createSession(emptyStore(), { cwd: '/x', agent: 'cursor' }, { id: 's2', now: 1 })
    expect(missing.session.model).toBeUndefined()
  })

  it('setCursorChatId stores the chat id, is a no-op for the same value, and rejects a bad id', () => {
    const { data } = createSession(emptyStore(), { cwd: '/x', agent: 'cursor' }, { id: 's1', now: 1 })
    const next = setCursorChatId(data, 's1', 'chat_ABCDEF12')
    expect(next.sessions[0].cursorChatId).toBe('chat_ABCDEF12')
    expect(setCursorChatId(next, 's1', 'chat_ABCDEF12')).toBe(next)
    expect(() => setCursorChatId(data, 's1', 'bad id')).toThrow('Invalid cursorChatId')
  })
})

describe('moveSessionToWorktree (D88)', () => {
  const SHA = 'a'.repeat(40)
  function withWorktree(): { data: StoreData; sessionId: string } {
    let data = emptyStore()
    const created = createSession(data, { cwd: 'C:\notes', name: 'Docs', agent: 'opencode' }, { id: 's1', now: 1 })
    data = created.data
    data = { ...data, sessions: data.sessions.map((s) => ({ ...s, opencodeSessionId: 'ses_abc123', notes: 'keep' })) }
    data = { ...data, repos: [{ id: 'r1', name: 'app', path: 'C:\app', createdAt: 1, collapsed: false }], worktrees: [{ id: 'w1', repoId: 'r1', name: 'one', branch: 'sd/one', path: 'C:\wt\one', baseBranch: 'main', baseCommit: SHA, createdAt: 1, collapsed: false }] }
    return { data, sessionId: 's1' }
  }

  it('retargets the folder, drops the old conversation id, keeps the rest', () => {
    const { data, sessionId } = withWorktree()
    const next = moveSessionToWorktree(data, sessionId, 'w1')
    const s = next.sessions[0]
    expect(s).toMatchObject({ id: 's1', name: 'Docs', cwd: 'C:\wt\one', worktreeId: 'w1', groupId: null, notes: 'keep' })
    expect(s.opencodeSessionId).toBeUndefined()
  })

  it('refuses Jarvis, an unknown worktree and a session already there', () => {
    const { data, sessionId } = withWorktree()
    expect(() => moveSessionToWorktree(data, sessionId, 'nope')).toThrow('Worktree not found')
    const moved = moveSessionToWorktree(data, sessionId, 'w1')
    expect(() => moveSessionToWorktree(moved, sessionId, 'w1')).toThrow('already in this worktree')
    const jarvis = { ...data, sessions: data.sessions.map((s) => ({ ...s, role: 'jarvis' as const })) }
    expect(() => moveSessionToWorktree(jarvis, sessionId, 'w1')).toThrow('Jarvis')
  })
})
