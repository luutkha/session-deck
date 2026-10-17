import { describe, expect, it } from 'vitest'
import type { Group, Session } from '../../shared/types'
import type { Section } from './selectors'
import { flatSessionIds, workspaceBuckets, workspaceCollapseKey } from './selectors'

function session(id: string, cwd: string, order = 0): Session {
  return { id, name: id, cwd, groupId: null, statusId: null, order, createdAt: 0, claudeArgs: [] }
}

describe('workspaceBuckets', () => {
  it('returns nothing for no sessions', () => {
    expect(workspaceBuckets([])).toEqual([])
  })

  it('buckets sessions by folder in first-seen order and keeps session order', () => {
    const buckets = workspaceBuckets([
      session('a', 'C:\\Work\\alpha'),
      session('b', 'C:\\Work\\beta'),
      session('c', 'C:\\Work\\alpha')
    ])
    expect(buckets.map((b) => b.label)).toEqual(['alpha', 'beta'])
    expect(buckets[0].sessions.map((s) => s.id)).toEqual(['a', 'c'])
    expect(buckets[1].sessions.map((s) => s.id)).toEqual(['b'])
  })

  it('treats slash style, trailing slash and case as the same folder', () => {
    const buckets = workspaceBuckets([
      session('a', 'C:\\Work\\Alpha'),
      session('b', 'c:/work/alpha/'),
      session('c', 'C:\\Work\\Alpha\\')
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0].sessions).toHaveLength(3)
    expect(buckets[0].path).toBe('C:\\Work\\Alpha')
  })

  it('uses parent/name when two workspaces share a folder name', () => {
    const buckets = workspaceBuckets([
      session('a', 'C:\\one\\app'),
      session('b', 'C:\\two\\app'),
      session('c', 'C:\\Work\\solo')
    ])
    expect(buckets.map((b) => b.label)).toEqual(['one/app', 'two/app', 'solo'])
  })

  it('falls back to the full path for a drive root', () => {
    expect(workspaceBuckets([session('a', 'C:\\')])[0].label).toBe('C:')
  })

  it('does not mutate its input', () => {
    const input = [session('a', 'x/y'), session('b', 'x/z')]
    const copy = [...input]
    workspaceBuckets(input)
    expect(input).toEqual(copy)
  })
})

describe('flatSessionIds with workspaces', () => {
  const group: Group = { id: 'g1', name: 'G', collapsed: false } as Group
  const sections: readonly Section[] = [
    { group, sessions: [session('a', 'p/one'), session('b', 'p/two'), session('c', 'p/one')] },
    { group: null, sessions: [session('d', 'p/one')] }
  ]

  it('keeps every session when nothing is collapsed', () => {
    expect(flatSessionIds(sections, new Map(), true)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('skips sessions of a collapsed workspace only inside its own group', () => {
    const collapsed = new Map([[workspaceCollapseKey('g1', 'p/one'), true]])
    expect(flatSessionIds(sections, collapsed, true)).toEqual(['b', 'd'])
  })

  it('ignores workspace collapse when workspaces are hidden', () => {
    const collapsed = new Map([[workspaceCollapseKey('g1', 'p/one'), true]])
    expect(flatSessionIds(sections, collapsed, false)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('defaults to the old behavior without extra arguments', () => {
    expect(flatSessionIds(sections)).toEqual(['a', 'b', 'c', 'd'])
  })
})
