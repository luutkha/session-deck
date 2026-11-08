import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session } from '../../shared/types'
import {
  attentionRank,
  isLiveSort,
  lastActiveOf,
  parseSessionSort,
  sessionSortLabel,
  sortPositions,
  sortSessions
} from './sessionSort'

function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: id, cwd: 'C:\\w', groupId: null, statusId: null, order: 0, createdAt: 100, claudeArgs: [], ...extra }
}

function rt(sessionId: string, extra: Partial<RuntimeState> = {}): RuntimeState {
  return { sessionId, run: 'running', exitCode: null, attention: null, ...extra }
}

const ids = (list: readonly Session[]): string[] => list.map((s) => s.id)

describe('parseSessionSort / labels (D61)', () => {
  it('accepts the five sorts and turns anything else into manual', () => {
    for (const value of ['manual', 'attention', 'recent', 'newest', 'name']) expect(parseSessionSort(value)).toBe(value)
    expect(parseSessionSort(null)).toBe('manual')
    expect(parseSessionSort('Name')).toBe('manual')
    expect(parseSessionSort(3)).toBe('manual')
  })

  it('labels each sort', () => {
    expect(sessionSortLabel('name')).toBe('Name A–Z')
    expect(sessionSortLabel('recent')).toBe('Last active')
  })

  it('only attention and recent are live sorts', () => {
    expect(['manual', 'attention', 'recent', 'newest', 'name'].filter((s) => isLiveSort(parseSessionSort(s)))).toEqual(['attention', 'recent'])
  })
})

describe('lastActiveOf', () => {
  it('uses lastActiveAt, else createdAt', () => {
    expect(lastActiveOf(session('a', { createdAt: 5 }))).toBe(5)
    expect(lastActiveOf(session('a', { createdAt: 5, lastActiveAt: 9 }))).toBe(9)
  })
})

describe('attentionRank', () => {
  it('ranks needs-you, working, finished, idle, sleeping, not running', () => {
    expect(attentionRank(rt('a', { attention: 'done' }))).toBe(0)
    expect(attentionRank(rt('a', { activity: 'needs-input', activityMessage: 'Claude needs your permission to use Bash' }))).toBe(0)
    expect(attentionRank(rt('a', { activity: 'working' }))).toBe(1)
    expect(attentionRank(rt('a', { activity: 'finished' }))).toBe(2)
    expect(attentionRank(rt('a', { activity: 'needs-input', activityMessage: 'Claude is waiting for your input' }))).toBe(2)
    expect(attentionRank(rt('a'))).toBe(3)
    expect(attentionRank(rt('a', { sleeping: true, run: 'exited' }))).toBe(4)
    expect(attentionRank(rt('a', { run: 'exited' }))).toBe(5)
    expect(attentionRank(undefined)).toBe(5)
  })
})

describe('sortSessions', () => {
  const none = new Map<string, RuntimeState>()

  it('manual returns the input as is', () => {
    const list = [session('b'), session('a')]
    expect(sortSessions(list, 'manual', none)).toBe(list)
  })

  it('name sorts naturally and ignores case', () => {
    const list = [session('s10', { name: 'session 10' }), session('s2', { name: 'Session 2' }), session('x', { name: 'alpha' })]
    expect(ids(sortSessions(list, 'name', none))).toEqual(['x', 's2', 's10'])
  })

  it('newest sorts by createdAt descending', () => {
    const list = [session('old', { createdAt: 1 }), session('new', { createdAt: 3 }), session('mid', { createdAt: 2 })]
    expect(ids(sortSessions(list, 'newest', none))).toEqual(['new', 'mid', 'old'])
  })

  it('recent sorts by lastActiveAt descending, falling back to createdAt', () => {
    const list = [
      session('never', { createdAt: 50 }),
      session('long-ago', { createdAt: 10, lastActiveAt: 20 }),
      session('just-now', { createdAt: 10, lastActiveAt: 90 })
    ]
    expect(ids(sortSessions(list, 'recent', none))).toEqual(['just-now', 'never', 'long-ago'])
  })

  it('attention sorts by rank, then last active', () => {
    const list = [session('exited'), session('idle-old', { lastActiveAt: 1 }), session('working'), session('bell'), session('idle-new', { lastActiveAt: 500 })]
    const runtime = new Map<string, RuntimeState>([
      ['exited', rt('exited', { run: 'exited' })],
      ['idle-old', rt('idle-old')],
      ['idle-new', rt('idle-new')],
      ['working', rt('working', { activity: 'working' })],
      ['bell', rt('bell', { attention: 'permission' })]
    ])
    expect(ids(sortSessions(list, 'attention', runtime))).toEqual(['bell', 'working', 'idle-new', 'idle-old', 'exited'])
  })

  it('keeps the input order for ties (stable)', () => {
    const list = [session('b', { name: 'same' }), session('a', { name: 'same' })]
    expect(ids(sortSessions(list, 'name', none))).toEqual(['b', 'a'])
  })

  it('does not mutate the input', () => {
    const list = [session('b', { createdAt: 1 }), session('a', { createdAt: 2 })]
    sortSessions(list, 'newest', none)
    expect(ids(list)).toEqual(['b', 'a'])
  })

  it('a frozen snapshot pins a live sort; new sessions go after the known ones', () => {
    const a = session('a', { lastActiveAt: 10 })
    const b = session('b', { lastActiveAt: 20 })
    const frozen = sortPositions([a, b], 'recent', none) // b, a
    const aNow = { ...a, lastActiveAt: 99 } // a became active while the pointer is over the list
    const c = session('c', { lastActiveAt: 50 })
    expect(ids(sortSessions([aNow, b, c], 'recent', none, frozen))).toEqual(['b', 'a', 'c'])
    expect(ids(sortSessions([aNow, b, c], 'recent', none))).toEqual(['a', 'c', 'b'])
  })

  it('a frozen snapshot does not affect a non-live sort', () => {
    const list = [session('b', { name: 'b' }), session('a', { name: 'a' })]
    const frozen = new Map([['b', 0], ['a', 1]])
    expect(ids(sortSessions(list, 'name', none, frozen))).toEqual(['a', 'b'])
  })
})
