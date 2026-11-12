import { describe, it, expect } from 'vitest'
import type { StoreData, Group, Session, StatusDef, Id } from '../../shared/types'
import {
  dropEmptySections,
  groupedSessions,
  filterByStatus,
  indexById,
  pruneStatusFilter,
  statusOf,
  flatSessionIds,
  countByStatus,
  splitClosed,
  groupByStatus,
  filterBySearch,
  filterStatusSectionsBySearch,
  filterStatusSectionsByStatus,
  orderSectionSessions,
  type StatusSection
} from './selectors'

const makeStore = (overrides: Partial<StoreData> = {}): StoreData => ({
  version: 1,
  sessions: [],
  groups: [],
  statuses: [],
  groupOrder: [],
  ...overrides
})

const makeGroup = (id: Id, name: string, collapsed = false): Group => ({ id, name, collapsed })
const makeSession = (
  id: Id,
  name: string,
  groupId: Id | null,
  order: number,
  statusId: Id | null = null,
  closedAt?: number
): Session => ({
  id,
  name,
  cwd: '/tmp',
  groupId,
  statusId,
  order,
  createdAt: Date.now(),
  claudeArgs: [],
  ...(closedAt !== undefined ? { closedAt } : {})
})
const makeStatus = (id: Id, name: string, color: string): StatusDef => ({ id, name, color })

describe('groupedSessions', () => {
  it('returns sections in groupOrder order', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const g2 = makeGroup('g2', 'Group 2')
    const s1 = makeSession('s1', 'Session 1', 'g1', 0)
    const s2 = makeSession('s2', 'Session 2', 'g1', 1)
    const s3 = makeSession('s3', 'Session 3', 'g2', 0)
    const store = makeStore({
      groups: [g1, g2],
      sessions: [s1, s2, s3],
      groupOrder: ['g2', 'g1']
    })
    const sections = groupedSessions(store)
    expect(sections.map(s => s.group?.id ?? null)).toEqual(['g2', 'g1', null])
    expect(sections[0].sessions.map(s => s.id)).toEqual(['s3'])
    expect(sections[1].sessions.map(s => s.id)).toEqual(['s1', 's2'])
    expect(sections[2].sessions).toEqual([])
  })

  it('sorts sessions by order ascending within each group', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const s1 = makeSession('s1', 'Session 1', 'g1', 2)
    const s2 = makeSession('s2', 'Session 2', 'g1', 0)
    const s3 = makeSession('s3', 'Session 3', 'g1', 1)
    const store = makeStore({ groups: [g1], sessions: [s1, s2, s3], groupOrder: ['g1'] })
    const sections = groupedSessions(store)
    expect(sections[0].sessions.map(s => s.id)).toEqual(['s2', 's3', 's1'])
  })

  it('ungrouped bucket is always last and present when groups exist', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const s1 = makeSession('s1', 'Session 1', 'g1', 0)
    const u1 = makeSession('u1', 'Ungrouped 1', null, 0)
    const u2 = makeSession('u2', 'Ungrouped 2', null, 1)
    const store = makeStore({ groups: [g1], sessions: [s1, u1, u2], groupOrder: ['g1'] })
    const sections = groupedSessions(store)
    expect(sections.length).toBe(2)
    expect(sections[1].group).toBeNull()
    expect(sections[1].sessions.map(s => s.id)).toEqual(['u1', 'u2'])
  })

  it('skips the ungrouped bucket when there are no groups and no ungrouped sessions', () => {
    const store = makeStore()
    const sections = groupedSessions(store)
    expect(sections).toEqual([])
  })

  it('shows the ungrouped bucket when ungrouped sessions exist but no groups do', () => {
    const u1 = makeSession('u1', 'Solo', null, 0)
    const store = makeStore({ sessions: [u1], groupOrder: [] })
    const sections = groupedSessions(store)
    expect(sections.length).toBe(1)
    expect(sections[0].group).toBeNull()
    expect(sections[0].sessions.map(s => s.id)).toEqual(['u1'])
  })

  it('skips groupOrder ids that do not exist in groups', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const s1 = makeSession('s1', 'Session 1', 'g1', 0)
    const store = makeStore({ groups: [g1], sessions: [s1], groupOrder: ['missing', 'g1', 'also-missing'] })
    const sections = groupedSessions(store)
    expect(sections.map(s => s.group?.id ?? null)).toEqual(['g1', null])
  })

  it('excludes closed sessions from groups', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const open = makeSession('s1', 'Open', 'g1', 0)
    const closed = makeSession('s2', 'Closed', 'g1', 1, null, 100)
    const store = makeStore({ groups: [g1], sessions: [open, closed], groupOrder: ['g1'] })
    const sections = groupedSessions(store)
    expect(sections[0].sessions.map(s => s.id)).toEqual(['s1'])
  })
})

describe('filterByStatus', () => {
  it('empty set returns sections unchanged', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const s1 = makeSession('s1', 'Session 1', 'g1', 0, 'status1')
    const s2 = makeSession('s2', 'Session 2', 'g1', 1, 'status2')
    const sections = [{ group: g1, sessions: [s1, s2] }, { group: null, sessions: [] }]
    const result = filterByStatus(sections, new Set())
    expect(result).toBe(sections)
  })

  it('filters sessions by statusId', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const s1 = makeSession('s1', 'Session 1', 'g1', 0, 'status1')
    const s2 = makeSession('s2', 'Session 2', 'g1', 1, 'status2')
    const s3 = makeSession('s3', 'Session 3', null, 0, 'status1')
    const sections = [
      { group: g1, sessions: [s1, s2] },
      { group: null, sessions: [s3] }
    ]
    const result = filterByStatus(sections, new Set(['status1']))
    expect(result[0].sessions.map(s => s.id)).toEqual(['s1'])
    expect(result[1].sessions.map(s => s.id)).toEqual(['s3'])
  })

  it('null in set matches sessions with no status', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const s1 = makeSession('s1', 'Session 1', 'g1', 0, 'status1')
    const s2 = makeSession('s2', 'Session 2', 'g1', 1, null)
    const sections = [{ group: g1, sessions: [s1, s2] }, { group: null, sessions: [] }]
    const result = filterByStatus(sections, new Set([null]))
    expect(result[0].sessions.map(s => s.id)).toEqual(['s2'])
  })

  it('groups stay even if they end up empty', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const s1 = makeSession('s1', 'Session 1', 'g1', 0, 'status1')
    const sections = [{ group: g1, sessions: [s1] }, { group: null, sessions: [] }]
    const result = filterByStatus(sections, new Set(['status2']))
    expect(result[0].group?.id).toBe('g1')
    expect(result[0].sessions).toEqual([])
  })
})

describe('filterStatusSectionsByStatus', () => {
  function statusSections(): readonly StatusSection[] {
    return [
      {
        key: 'todo',
        label: 'Todo',
        statusId: 'todo',
        color: '#9e9e9e',
        sessions: [makeSession('a', 'A', null, 0, 'todo')]
      },
      {
        key: 'done',
        label: 'Done',
        statusId: 'done',
        color: '#66bb6a',
        sessions: [makeSession('b', 'B', null, 0, 'done')]
      }
    ]
  }

  it('returns the same reference when the filter set is empty', () => {
    const sections = statusSections()
    expect(filterStatusSectionsByStatus(sections, new Set())).toBe(sections)
  })

  it('keeps matching sessions and preserves the section header', () => {
    const sections = statusSections()
    const result = filterStatusSectionsByStatus(sections, new Set(['done']))
    expect(result[0].sessions).toEqual([])
    expect(result[0].key).toBe('todo')
    expect(result[0].color).toBe('#9e9e9e')
    expect(result[1].sessions.map((s) => s.id)).toEqual(['b'])
  })

  it('matches the null "No status" bucket', () => {
    const sections: readonly StatusSection[] = [
      {
        key: 'none',
        label: 'No status',
        statusId: null,
        color: null,
        sessions: [makeSession('n', 'None', null, 0, null)]
      }
    ]
    const result = filterStatusSectionsByStatus(sections, new Set([null]))
    expect(result[0].sessions.map((s) => s.id)).toEqual(['n'])
  })

  it('does not mutate the input sections', () => {
    const sections = statusSections()
    filterStatusSectionsByStatus(sections, new Set(['done']))
    expect(sections[0].sessions.map((s) => s.id)).toEqual(['a'])
  })
})

describe('pruneStatusFilter', () => {
  const statuses = [makeStatus('todo', 'Todo', '#9e9e9e'), makeStatus('done', 'Done', '#66bb6a')]

  it('returns the same empty set when nothing is selected', () => {
    const selected = new Set<Id | null>()
    expect(pruneStatusFilter(selected, statuses)).toBe(selected)
  })

  it('keeps existing status ids and the None bucket', () => {
    const result = pruneStatusFilter(new Set<Id | null>(['todo', null]), statuses)
    expect(result.has('todo')).toBe(true)
    expect(result.has(null)).toBe(true)
    expect(result.size).toBe(2)
  })

  it('drops a status id that no longer exists', () => {
    const result = pruneStatusFilter(new Set<Id | null>(['todo', 'deleted']), statuses)
    expect([...result]).toEqual(['todo'])
  })

  it('returns an empty set when every selected id was deleted', () => {
    const result = pruneStatusFilter(new Set<Id | null>(['gone-a', 'gone-b']), statuses)
    expect(result.size).toBe(0)
  })

  it('always retains null even with no statuses defined', () => {
    const result = pruneStatusFilter(new Set<Id | null>([null, 'todo']), [])
    expect([...result]).toEqual([null])
  })

  it('does not mutate the original selection', () => {
    const original = new Set<Id | null>(['todo', 'deleted'])
    pruneStatusFilter(original, statuses)
    expect([...original]).toEqual(['todo', 'deleted'])
  })
})

describe('statusOf', () => {
  it('returns status def for session with statusId', () => {
    const status = makeStatus('st1', 'Todo', '#9e9e9e')
    const session = makeSession('s1', 'Session 1', null, 0, 'st1')
    const store = makeStore({ statuses: [status], sessions: [session] })
    expect(statusOf(store, session)).toEqual(status)
  })

  it('returns null for session with null statusId', () => {
    const session = makeSession('s1', 'Session 1', null, 0, null)
    const store = makeStore({ statuses: [], sessions: [session] })
    expect(statusOf(store, session)).toBeNull()
  })

  it('returns null for unknown statusId', () => {
    const session = makeSession('s1', 'Session 1', null, 0, 'unknown')
    const store = makeStore({ statuses: [], sessions: [session] })
    expect(statusOf(store, session)).toBeNull()
  })
})

describe('flatSessionIds', () => {
  it('returns visible order skipping sessions in collapsed groups', () => {
    const g1 = makeGroup('g1', 'Group 1', true) // collapsed
    const g2 = makeGroup('g2', 'Group 2', false)
    const s1 = makeSession('s1', 'Session 1', 'g1', 0)
    const s2 = makeSession('s2', 'Session 2', 'g2', 0)
    const u1 = makeSession('u1', 'Ungrouped 1', null, 0)
    const sections = [
      { group: g1, sessions: [s1] },
      { group: g2, sessions: [s2] },
      { group: null, sessions: [u1] }
    ]
    expect(flatSessionIds(sections)).toEqual(['s2', 'u1'])
  })

  it('ungrouped sessions always visible', () => {
    const g1 = makeGroup('g1', 'Group 1', true) // collapsed
    const s1 = makeSession('s1', 'Session 1', 'g1', 0)
    const u1 = makeSession('u1', 'Ungrouped 1', null, 0)
    const sections = [
      { group: g1, sessions: [s1] },
      { group: null, sessions: [u1] }
    ]
    expect(flatSessionIds(sections)).toEqual(['u1'])
  })

  it('respects session order within groups', () => {
    const g1 = makeGroup('g1', 'Group 1', false)
    const s1 = makeSession('s1', 'Session 1', 'g1', 1)
    const s2 = makeSession('s2', 'Session 2', 'g1', 0)
    // sessions should be pre-sorted by order (as groupedSessions does)
    const sections = [{ group: g1, sessions: [s2, s1] }, { group: null, sessions: [] }]
    expect(flatSessionIds(sections)).toEqual(['s2', 's1'])
  })

  it('empty sections returns empty array', () => {
    expect(flatSessionIds([])).toEqual([])
  })

  it('excludes closed sessions', () => {
    const g1 = makeGroup('g1', 'Group 1')
    const open = makeSession('s1', 'Open', 'g1', 0)
    const closed = makeSession('s2', 'Closed', 'g1', 1, null, 100)
    const store = makeStore({ groups: [g1], sessions: [open, closed], groupOrder: ['g1'] })
    expect(flatSessionIds(groupedSessions(store))).toEqual(['s1'])
  })
})

describe('countByStatus', () => {
  it('counts open sessions by statusId including null', () => {
    const s1 = makeSession('s1', 'Session 1', 'g1', 0, 'st1')
    const s2 = makeSession('s2', 'Session 2', 'g1', 1, 'st1')
    const s3 = makeSession('s3', 'Session 3', null, 0, 'st2')
    const s4 = makeSession('s4', 'Session 4', null, 1, null)
    const store = makeStore({ sessions: [s1, s2, s3, s4] })
    const counts = countByStatus(store)
    expect(counts.get('st1')).toBe(2)
    expect(counts.get('st2')).toBe(1)
    expect(counts.get(null)).toBe(1)
  })

  it('excludes closed sessions', () => {
    const open = makeSession('s1', 'Open', null, 0, 'st1')
    const closed = makeSession('s2', 'Closed', null, 1, 'st1', 100)
    const store = makeStore({ sessions: [open, closed] })
    const counts = countByStatus(store)
    expect(counts.get('st1')).toBe(1)
  })

  it('returns empty map for empty store', () => {
    const store = makeStore()
    const counts = countByStatus(store)
    expect(counts.size).toBe(0)
  })
})

describe('splitClosed', () => {
  it('returns empty arrays for an empty store', () => {
    expect(splitClosed(makeStore())).toEqual({ open: [], closed: [] })
  })

  it('separates open and closed sessions', () => {
    const a = makeSession('a', 'A', null, 0)
    const b = makeSession('b', 'B', null, 1, null, 100)
    const c = makeSession('c', 'C', null, 2, null, 200)
    const store = makeStore({ sessions: [a, b, c] })
    const result = splitClosed(store)
    expect(result.open.map(s => s.id)).toEqual(['a'])
    expect(result.closed.map(s => s.id)).toEqual(['c', 'b'])
  })

  it('sorts closed sessions by closedAt descending', () => {
    const old = makeSession('old', 'Old', null, 0, null, 50)
    const newest = makeSession('new', 'New', null, 1, null, 500)
    const mid = makeSession('mid', 'Mid', null, 2, null, 200)
    const store = makeStore({ sessions: [old, newest, mid] })
    expect(splitClosed(store).closed.map(s => s.id)).toEqual(['new', 'mid', 'old'])
  })

  it('does not mutate the input sessions array', () => {
    const closed = makeSession('a', 'A', null, 0, null, 100)
    const original = [closed]
    const store = makeStore({ sessions: original })
    splitClosed(store)
    expect(original.map(s => s.id)).toEqual(['a'])
  })
})

describe('groupByStatus', () => {
  const todo = makeStatus('todo', 'Todo', '#9e9e9e')
  const done = makeStatus('done', 'Done', '#66bb6a')

  it('returns empty array for an empty store', () => {
    expect(groupByStatus(makeStore())).toEqual([])
  })

  it('lists sections in status order with their color', () => {
    const s1 = makeSession('s1', 'One', null, 0, 'done')
    const s2 = makeSession('s2', 'Two', null, 1, 'todo')
    const store = makeStore({ statuses: [todo, done], sessions: [s1, s2] })
    const sections = groupByStatus(store)
    expect(sections.map(s => s.label)).toEqual(['Todo', 'Done'])
    expect(sections[0].color).toBe('#9e9e9e')
  })

  it('adds a "No status" section at the end for null statusId', () => {
    const s1 = makeSession('s1', 'None', null, 0, null)
    const s2 = makeSession('s2', 'Done', null, 1, 'done')
    const store = makeStore({ statuses: [done], sessions: [s1, s2] })
    const sections = groupByStatus(store)
    expect(sections.map(s => s.label)).toEqual(['Done', 'No status'])
    expect(sections[1].statusId).toBeNull()
    expect(sections[1].color).toBeNull()
  })

  it('omits a status with no sessions', () => {
    const s = makeSession('s1', 'Only Todo', null, 0, 'todo')
    const store = makeStore({ statuses: [todo, done], sessions: [s] })
    expect(groupByStatus(store).map(x => x.label)).toEqual(['Todo'])
  })

  it('sorts sessions within a status by order', () => {
    const s1 = makeSession('s1', 'A', null, 2, 'todo')
    const s2 = makeSession('s2', 'B', null, 0, 'todo')
    const s3 = makeSession('s3', 'C', null, 1, 'todo')
    const store = makeStore({ statuses: [todo], sessions: [s1, s2, s3] })
    expect(groupByStatus(store)[0].sessions.map(s => s.id)).toEqual(['s2', 's3', 's1'])
  })

  it('excludes closed sessions', () => {
    const open = makeSession('s1', 'Open', null, 0, 'todo')
    const closed = makeSession('s2', 'Closed', null, 1, 'todo', 100)
    const store = makeStore({ statuses: [todo], sessions: [open, closed] })
    const sections = groupByStatus(store)
    expect(sections[0].sessions.map(s => s.id)).toEqual(['s1'])
  })

  it('returns empty array when every session is closed', () => {
    const closed = makeSession('s1', 'Closed', null, 0, 'todo', 100)
    const store = makeStore({ statuses: [todo], sessions: [closed] })
    expect(groupByStatus(store)).toEqual([])
  })
})

describe('filterBySearch', () => {
  const g1 = makeGroup('g1', 'Group 1')
  const s1 = makeSession('s1', 'Alpha', 'g1', 0)
  const s2: Session = { ...makeSession('s2', 'Beta', 'g1', 1), cwd: '/home/me/beta-app' }
  const s3: Session = { ...makeSession('s3', 'Gamma', 'g1', 2), cwd: 'C:\\code\\gamma' }

  it('returns sections unchanged for an empty query', () => {
    const sections = [{ group: g1, sessions: [s1, s2, s3] }]
    expect(filterBySearch(sections, '')).toBe(sections)
  })

  it('returns sections unchanged for a whitespace-only query', () => {
    const sections = [{ group: g1, sessions: [s1, s2, s3] }]
    expect(filterBySearch(sections, '   ')).toBe(sections)
  })

  it('matches case-insensitively on the session name', () => {
    const sections = [{ group: g1, sessions: [s1, s2, s3] }]
    const result = filterBySearch(sections, 'alpha')
    expect(result[0].sessions.map(s => s.id)).toEqual(['s1'])
  })

  it('matches the final path segment of cwd', () => {
    const sections = [{ group: g1, sessions: [s1, s2, s3] }]
    const result = filterBySearch(sections, 'beta-app')
    expect(result[0].sessions.map(s => s.id)).toEqual(['s2'])
  })

  it('keeps the section header even when nothing matches', () => {
    const sections = [{ group: g1, sessions: [s1] }]
    expect(filterBySearch(sections, 'nope')[0].sessions).toEqual([])
  })

  it('does not mutate the input', () => {
    const sections = [{ group: g1, sessions: [s1, s2] }]
    const original = sections[0].sessions
    filterBySearch(sections, 'alpha')
    expect(sections[0].sessions).toBe(original)
  })
})

describe('filterStatusSectionsBySearch', () => {
  const s1 = makeSession('s1', 'Alpha', null, 0, 'todo')
  const s2: Session = { ...makeSession('s2', 'Beta', null, 1, 'todo'), cwd: '/home/me/beta-app' }

  it('returns sections unchanged for an empty query', () => {
    const sections = [{ key: 'todo', label: 'Todo', statusId: 'todo', color: '#9e9e9e', sessions: [s1, s2] }]
    expect(filterStatusSectionsBySearch(sections, '')).toBe(sections)
  })

  it('matches name and folder case-insensitively', () => {
    const sections = [{ key: 'todo', label: 'Todo', statusId: 'todo', color: '#9e9e9e', sessions: [s1, s2] }]
    expect(filterStatusSectionsBySearch(sections, 'BETA')[0].sessions.map(s => s.id)).toEqual(['s2'])
    expect(filterStatusSectionsBySearch(sections, 'alpha')[0].sessions.map(s => s.id)).toEqual(['s1'])
  })

  it('preserves the section header when nothing matches', () => {
    const sections = [{ key: 'todo', label: 'Todo', statusId: 'todo', color: '#9e9e9e', sessions: [s1] }]
    const result = filterStatusSectionsBySearch(sections, 'nope')
    expect(result[0].sessions).toEqual([])
    expect(result[0].label).toBe('Todo')
  })
})
describe('dropEmptySections', () => {
  const full = { sessions: [{ id: 'a' }] as unknown as readonly Session[] }
  const empty = { sessions: [] as readonly Session[] }

  it('keeps empty sections when no filter is active (they are drop targets)', () => {
    expect(dropEmptySections([full, empty], false)).toEqual([full, empty])
  })

  it('drops sections without matches while a search or status filter is active', () => {
    expect(dropEmptySections([full, empty, empty], true)).toEqual([full])
  })

  it('returns an empty list when nothing matches', () => {
    expect(dropEmptySections([empty], true)).toEqual([])
  })
})

describe('orderSectionSessions', () => {
  const g1 = makeGroup('g1', 'Group 1')
  const g2 = makeGroup('g2', 'Group 2')
  const s1 = makeSession('s1', 'Session 1', 'g1', 0)
  const s2 = makeSession('s2', 'Session 2', 'g1', 1)
  const s3 = makeSession('s3', 'Session 3', 'g2', 0)
  const reverse = (sessions: readonly Session[]): readonly Session[] => [...sessions].reverse()

  it('orders the sessions inside every section and keeps section order and fields', () => {
    const sections = [
      { group: g1, sessions: [s1, s2] },
      { group: g2, sessions: [s3] }
    ]
    const result = orderSectionSessions(sections, reverse)
    expect(result.map(section => section.group.id)).toEqual(['g1', 'g2'])
    expect(result[0].sessions.map(s => s.id)).toEqual(['s2', 's1'])
    expect(result[1].sessions.map(s => s.id)).toEqual(['s3'])
  })

  it('gives the order function only the sessions of that section', () => {
    const seen: string[][] = []
    const order = (sessions: readonly Session[]): readonly Session[] => {
      seen.push(sessions.map(s => s.id))
      return sessions
    }
    orderSectionSessions(
      [
        { group: g1, sessions: [s1, s2] },
        { group: g2, sessions: [s3] }
      ],
      order
    )
    expect(seen).toEqual([['s1', 's2'], ['s3']])
  })

  it('keeps empty sections and works with sections that are not group sections', () => {
    const sections = [{ key: 'todo', sessions: [] as readonly Session[], label: 'Todo' }]
    const result = orderSectionSessions(sections, reverse)
    expect(result).toEqual([{ key: 'todo', sessions: [], label: 'Todo' }])
  })

  it('does not mutate the input sections or their session lists', () => {
    const sessions = [s1, s2]
    const sections = [{ group: g1, sessions }]
    const result = orderSectionSessions(sections, reverse)
    expect(sections[0].sessions).toBe(sessions)
    expect(sessions.map(s => s.id)).toEqual(['s1', 's2'])
    expect(result[0]).not.toBe(sections[0])
    expect(result[0].sessions.map(s => s.id)).toEqual(['s2', 's1'])
  })
})

describe('indexById', () => {
  it('maps every item by id and keeps the original object identity', () => {
    const a = makeStatus('todo', 'Todo', '#9e9e9e')
    const b = makeStatus('doing', 'Doing', '#42a5f5')
    const map = indexById([a, b])
    expect(map.get('todo')).toBe(a)
    expect(map.get('doing')).toBe(b)
    expect(map.size).toBe(2)
  })

  it('returns an empty map for an empty list and a missing id reads as undefined', () => {
    expect(indexById([]).size).toBe(0)
    expect(indexById([makeStatus('todo', 'Todo', '#9e9e9e')]).get('missing')).toBeUndefined()
  })

  it('keeps the last item when ids repeat', () => {
    const first = makeStatus('todo', 'First', '#9e9e9e')
    const second = makeStatus('todo', 'Second', '#42a5f5')
    expect(indexById([first, second]).get('todo')).toBe(second)
  })
})
