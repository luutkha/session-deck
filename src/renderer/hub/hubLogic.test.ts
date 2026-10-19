import { describe, it, expect } from 'vitest'
import type { Id, RuntimeState, Session, SessionUsage, StatusDef, StoreData } from '../../shared/types'
import {
  buildColumns,
  busiestColumnIndex,
  closedSessions,
  computeStatusDrop,
  describeCardUsage,
  hubColumnKey,
  hubTotals,
  runIndicatorClass,
  runIndicatorLabel,
  totalCost
} from './hubLogic'

const makeStore = (overrides: Partial<StoreData> = {}): StoreData => ({
  version: 1,
  sessions: [],
  groups: [],
  statuses: [],
  groupOrder: [],
  ...overrides
})

const makeStatus = (id: Id, name: string, color = '#123456'): StatusDef => ({ id, name, color })

const makeSession = (partial: Partial<Session> & { readonly id: Id }): Session => ({
  name: partial.id,
  cwd: '/tmp',
  groupId: null,
  statusId: null,
  order: 0,
  createdAt: 0,
  claudeArgs: [],
  ...partial
})

describe('buildColumns', () => {
  it('returns only the "No status" column for an empty store', () => {
    const columns = buildColumns(makeStore(), '', new Map())
    expect(columns).toHaveLength(1)
    expect(columns[0].status).toBeNull()
    expect(columns[0].sessions).toEqual([])
  })

  it('orders "No status" first, then statuses in array order', () => {
    const todo = makeStatus('todo', 'Todo')
    const done = makeStatus('done', 'Done')
    const store = makeStore({ statuses: [todo, done] })
    const columns = buildColumns(store, '', new Map())
    expect(columns.map((c) => c.status?.id ?? null)).toEqual([null, 'todo', 'done'])
  })

  it('buckets a session with no statuses defined into "No status"', () => {
    const store = makeStore({ sessions: [makeSession({ id: 'a', statusId: 'todo' })] })
    const columns = buildColumns(store, '', new Map())
    expect(columns).toHaveLength(1)
    expect(columns[0].sessions.map((s) => s.id)).toEqual(['a'])
  })

  it('places a session whose status was deleted into "No status"', () => {
    const store = makeStore({
      statuses: [makeStatus('todo', 'Todo')],
      sessions: [makeSession({ id: 'a', statusId: 'gone' }), makeSession({ id: 'b', statusId: 'todo' })]
    })
    const columns = buildColumns(store, '', new Map())
    const none = columns[0]
    const todo = columns[1]
    expect(none.sessions.map((s) => s.id)).toEqual(['a'])
    expect(todo.sessions.map((s) => s.id)).toEqual(['b'])
  })

  it('excludes closed sessions from every column', () => {
    const store = makeStore({
      statuses: [makeStatus('todo', 'Todo')],
      sessions: [
        makeSession({ id: 'open', statusId: 'todo' }),
        makeSession({ id: 'closed', statusId: 'todo', closedAt: 100 }),
        makeSession({ id: 'closedNone', closedAt: 200 })
      ]
    })
    const columns = buildColumns(store, '', new Map())
    expect(columns[0].sessions).toEqual([])
    expect(columns[1].sessions.map((s) => s.id)).toEqual(['open'])
  })

  it('orders sessions by most recent activity descending', () => {
    const store = makeStore({
      statuses: [makeStatus('todo', 'Todo')],
      sessions: [
        makeSession({ id: 'a', statusId: 'todo', createdAt: 10 }),
        makeSession({ id: 'b', statusId: 'todo', createdAt: 20 }),
        makeSession({ id: 'c', statusId: 'todo', createdAt: 30 })
      ]
    })
    const lastChange = new Map<Id, number>([
      ['a', 100],
      ['b', 300],
      ['c', 200]
    ])
    const columns = buildColumns(store, '', lastChange)
    expect(columns[1].sessions.map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('falls back to createdAt when there is no lastChange entry', () => {
    const store = makeStore({
      statuses: [makeStatus('todo', 'Todo')],
      sessions: [
        makeSession({ id: 'a', statusId: 'todo', createdAt: 100 }),
        makeSession({ id: 'b', statusId: 'todo', createdAt: 300 }),
        makeSession({ id: 'c', statusId: 'todo', createdAt: 200 })
      ]
    })
    const columns = buildColumns(store, '', new Map([['a', 500]]))
    expect(columns[1].sessions.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks ordering ties deterministically by id', () => {
    const store = makeStore({
      statuses: [makeStatus('todo', 'Todo')],
      sessions: [
        makeSession({ id: 'b', statusId: 'todo', createdAt: 10 }),
        makeSession({ id: 'a', statusId: 'todo', createdAt: 10 }),
        makeSession({ id: 'c', statusId: 'todo', createdAt: 10 })
      ]
    })
    const columns = buildColumns(store, '', new Map())
    expect(columns[1].sessions.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters by name case-insensitively without dropping empty columns', () => {
    const store = makeStore({
      statuses: [makeStatus('todo', 'Todo'), makeStatus('done', 'Done')],
      sessions: [
        makeSession({ id: 'alpha', name: 'Alpha', statusId: 'todo' }),
        makeSession({ id: 'beta', name: 'Beta', statusId: 'done' })
      ]
    })
    const columns = buildColumns(store, '  ALPHA ', new Map())
    expect(columns[0].sessions).toEqual([])
    expect(columns[1].sessions.map((s) => s.id)).toEqual(['alpha'])
    expect(columns[2].sessions).toEqual([])
    expect(columns.map((c) => c.status?.id ?? null)).toEqual([null, 'todo', 'done'])
  })

  it('filters by the final path segment of cwd', () => {
    const store = makeStore({
      sessions: [
        makeSession({ id: 'a', cwd: '/home/me/rocket-app' }),
        makeSession({ id: 'b', cwd: 'C:\\code\\engine' })
      ]
    })
    const columns = buildColumns(store, 'rocket', new Map())
    expect(columns[0].sessions.map((s) => s.id)).toEqual(['a'])
  })

  it('does not mutate the input store or its sessions', () => {
    const sessions = [makeSession({ id: 'a', statusId: 'todo' }), makeSession({ id: 'b' })]
    const store = makeStore({ statuses: [makeStatus('todo', 'Todo')], sessions })
    buildColumns(store, '', new Map())
    expect(store.sessions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(store.sessions).toBe(sessions)
  })
})

describe('computeStatusDrop', () => {
  const statuses = [makeStatus('todo', 'Todo'), makeStatus('done', 'Done')]
  const data = makeStore({
    statuses,
    sessions: [
      makeSession({ id: 's1', statusId: 'todo' }),
      makeSession({ id: 's2', statusId: null }),
      makeSession({ id: 's3', statusId: 'gone' }),
      makeSession({ id: 'closed', statusId: 'todo', closedAt: 1 })
    ]
  })

  it('returns null for an unknown session', () => {
    expect(computeStatusDrop('nope', 'done', data)).toBeNull()
  })

  it('returns null for a closed session', () => {
    expect(computeStatusDrop('closed', 'done', data)).toBeNull()
  })

  it('returns null for an unknown target status', () => {
    expect(computeStatusDrop('s1', 'missing', data)).toBeNull()
  })

  it('returns null when the target is the current effective status', () => {
    expect(computeStatusDrop('s1', 'todo', data)).toBeNull()
    expect(computeStatusDrop('s2', null, data)).toBeNull()
  })

  it('returns null when a session with a deleted status is dropped on "No status"', () => {
    expect(computeStatusDrop('s3', null, data)).toBeNull()
  })

  it('moves a session to a different status', () => {
    expect(computeStatusDrop('s1', 'done', data)).toEqual({ sessionId: 's1', statusId: 'done' })
  })

  it('moves a session to "No status"', () => {
    expect(computeStatusDrop('s1', null, data)).toEqual({ sessionId: 's1', statusId: null })
  })

  it('moves a deleted-status session into a real status', () => {
    expect(computeStatusDrop('s3', 'done', data)).toEqual({ sessionId: 's3', statusId: 'done' })
  })
})

describe('hubTotals', () => {
  const runtime = (id: Id, attention: RuntimeState['attention']): RuntimeState => ({
    sessionId: id,
    run: 'running',
    exitCode: null,
    attention
  })

  it('reports zero for an empty store', () => {
    expect(hubTotals(makeStore(), new Map())).toEqual({ sessions: 0, needAttention: 0 })
  })

  it('counts open sessions only', () => {
    const data = makeStore({
      sessions: [
        makeSession({ id: 'a' }),
        makeSession({ id: 'b' }),
        makeSession({ id: 'c', closedAt: 5 })
      ]
    })
    expect(hubTotals(data, new Map()).sessions).toBe(2)
  })

  it('counts open sessions with an attention reason', () => {
    const data = makeStore({
      sessions: [makeSession({ id: 'a' }), makeSession({ id: 'b' }), makeSession({ id: 'c' })]
    })
    const map = new Map<Id, RuntimeState>([
      ['a', runtime('a', 'permission')],
      ['b', runtime('b', null)],
      ['c', runtime('c', 'bell')]
    ])
    expect(hubTotals(data, map).needAttention).toBe(2)
  })

  it('ignores attention on a closed session', () => {
    const data = makeStore({ sessions: [makeSession({ id: 'a', closedAt: 5 })] })
    const map = new Map<Id, RuntimeState>([['a', runtime('a', 'done')]])
    expect(hubTotals(data, map)).toEqual({ sessions: 0, needAttention: 0 })
  })

  it('treats a session absent from the runtime map as no attention', () => {
    const data = makeStore({ sessions: [makeSession({ id: 'a' })] })
    expect(hubTotals(data, new Map()).needAttention).toBe(0)
  })
})

describe('closedSessions', () => {
  it('returns an empty list when nothing is closed', () => {
    expect(closedSessions(makeStore({ sessions: [makeSession({ id: 'a' })] }))).toEqual([])
  })

  it('returns closed sessions most recently closed first', () => {
    const data = makeStore({
      sessions: [
        makeSession({ id: 'open' }),
        makeSession({ id: 'old', closedAt: 10 }),
        makeSession({ id: 'new', closedAt: 30 })
      ]
    })
    expect(closedSessions(data).map((s) => s.id)).toEqual(['new', 'old'])
  })
})

describe('hubColumnKey', () => {
  it('uses the status id when present and a sentinel for "No status"', () => {
    expect(hubColumnKey(makeStatus('todo', 'Todo'))).toBe('todo')
    expect(hubColumnKey(null)).not.toBe('todo')
    expect(hubColumnKey(null)).toBe(hubColumnKey(null))
  })
})

describe('indicator helpers', () => {
  it('maps run state to tokens and labels', () => {
    expect(runIndicatorClass('running')).toBe('bg-status-success')
    expect(runIndicatorClass('exited')).toBe('bg-destructive')
    expect(runIndicatorLabel('running')).toBe('Running')
    expect(runIndicatorLabel('exited')).toBe('Exited')
  })
})

function usage(sessionId: Id, costUsd: number | null): SessionUsage {
  return { sessionId, model: 'Sonnet 5.5', contextPercent: null, costUsd, effort: null, updatedAt: 0 }
}

describe('totalCost', () => {
  it('sums known open session costs', () => {
    const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' })]
    const map = new Map<Id, SessionUsage>([['a', usage('a', 0.08)], ['b', usage('b', 1.15)]])
    expect(totalCost(sessions, map)).toBeCloseTo(1.23, 5)
  })

  it('ignores closed sessions', () => {
    const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b', closedAt: 5 })]
    const map = new Map<Id, SessionUsage>([['a', usage('a', 0.5)], ['b', usage('b', 9)]])
    expect(totalCost(sessions, map)).toBeCloseTo(0.5, 5)
  })

  it('skips missing, null and non-finite costs', () => {
    const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' }), makeSession({ id: 'c' })]
    const map = new Map<Id, SessionUsage>([
      ['a', usage('a', null)],
      ['b', usage('b', Number.NaN)]
    ])
    expect(totalCost(sessions, map)).toBe(0)
  })

  it('returns zero with no usage', () => {
    expect(totalCost([makeSession({ id: 'a' })], new Map())).toBe(0)
  })
})

describe('describeCardUsage', () => {
  it('joins model, cost and context', () => {
    const record: SessionUsage = {
      sessionId: 'a',
      model: 'Sonnet 5.5',
      contextPercent: 12,
      costUsd: 0.08,
      effort: 'medium',
      updatedAt: 0
    }
    expect(describeCardUsage(record)).toBe('Model: Sonnet 5.5 · Cost: $0.08 · Context: 12%')
  })

  it('omits missing parts', () => {
    const record: SessionUsage = {
      sessionId: 'a',
      model: null,
      contextPercent: null,
      costUsd: 1,
      effort: null,
      updatedAt: 0
    }
    expect(describeCardUsage(record)).toBe('Cost: $1.00')
  })
})

describe('busiestColumnIndex', () => {
  const column = (count: number): { readonly sessions: readonly Session[] } => ({
    sessions: Array.from({ length: count }, (_, i) => makeSession({ id: `s${String(count)}-${String(i)}` }))
  })

  it('is the column with the most sessions', () => {
    expect(busiestColumnIndex([column(1), column(4), column(2)])).toBe(1)
  })

  it('picks the leftmost column on a tie', () => {
    expect(busiestColumnIndex([column(0), column(3), column(3)])).toBe(1)
  })

  it('is null when every column is empty or there are none', () => {
    expect(busiestColumnIndex([column(0), column(0)])).toBeNull()
    expect(busiestColumnIndex([])).toBeNull()
  })
})
