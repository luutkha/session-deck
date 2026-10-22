import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Session, StoreData, Worktree } from '../../shared/types'
import { emptyStore } from './reducers'
import {
  addRepo,
  addWorktree,
  pathKey,
  removeRepo,
  removeWorktree,
  setRepoCollapsed,
  setWorktreeCollapsed
} from './codeReducers'

const SHA = 'a'.repeat(40)

function session(id: string, worktreeId?: string): Session {
  return {
    id,
    name: id,
    cwd: '/x',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...(worktreeId !== undefined ? { worktreeId } : {})
  } as Session
}

function worktreeOf(id: string, repoId: string, path: string): Worktree {
  return {
    id,
    repoId,
    name: id,
    branch: `sd/${id}`,
    path,
    baseBranch: 'main',
    baseCommit: SHA,
    createdAt: 1,
    collapsed: false
  }
}

/** Two repos, two worktrees under repo r1, one worktree under r2, plus an Ops session. */
function sample(): StoreData {
  return {
    ...emptyStore(),
    repos: [
      { id: 'r1', name: 'one', path: resolve('/repos/one'), createdAt: 1, collapsed: false },
      { id: 'r2', name: 'two', path: resolve('/repos/two'), createdAt: 1, collapsed: false }
    ],
    worktrees: [
      worktreeOf('w1', 'r1', resolve('/wt/w1')),
      worktreeOf('w2', 'r1', resolve('/wt/w2')),
      worktreeOf('w3', 'r2', resolve('/wt/w3'))
    ],
    sessions: [session('ops'), session('s1', 'w1'), session('s2', 'w2'), session('s3', 'w3')]
  }
}

describe('pathKey', () => {
  it('ignores a trailing separator and "." segments', () => {
    expect(pathKey(resolve('/a/b/'))).toBe(pathKey(resolve('/a/b')))
    expect(pathKey(resolve('/a/./b'))).toBe(pathKey(resolve('/a/b')))
  })

  it.runIf(process.platform === 'win32')('ignores case on Windows', () => {
    expect(pathKey('C:\\Works\\Repo')).toBe(pathKey('c:/works/repo/'))
  })
})

describe('addRepo', () => {
  it('appends a new repo with a trimmed name, the resolved path and collapsed false', () => {
    const { data, repo } = addRepo(emptyStore(), { name: ' app ', path: resolve('/src/app') }, { id: 'r', now: 5 })
    expect(repo).toEqual({ id: 'r', name: 'app', path: resolve('/src/app'), createdAt: 5, collapsed: false })
    expect(data.repos).toEqual([repo])
  })

  it.runIf(process.platform === 'win32')('returns the existing repo when the same path comes with other case and slashes', () => {
    const first = addRepo(emptyStore(), { name: 'app', path: 'C:\\Works\\App' }, { id: 'r1', now: 1 })
    const second = addRepo(first.data, { name: 'other', path: 'c:/works/app/' }, { id: 'r2', now: 2 })
    expect(second.repo.id).toBe('r1')
    expect(second.data).toBe(first.data)
    expect(second.data.repos).toHaveLength(1)
  })

  it('rejects an empty name and an empty path', () => {
    expect(() => addRepo(emptyStore(), { name: '  ', path: '/a' }, { id: 'r', now: 1 })).toThrow('Name required')
    expect(() => addRepo(emptyStore(), { name: 'a', path: ' ' }, { id: 'r', now: 1 })).toThrow('Invalid repo path')
  })
})

describe('removeRepo', () => {
  it('removes the repo, its worktrees and their sessions, and leaves Ops sessions alone', () => {
    const next = removeRepo(sample(), 'r1')
    expect(next.repos?.map((r) => r.id)).toEqual(['r2'])
    expect(next.worktrees?.map((w) => w.id)).toEqual(['w3'])
    expect(next.sessions.map((s) => s.id)).toEqual(['ops', 's3'])
  })

  it('an unknown id returns the same data object', () => {
    const data = sample()
    expect(removeRepo(data, 'missing')).toBe(data)
  })
})

describe('addWorktree', () => {
  const draft = (overrides: Partial<Worktree> = {}) => ({
    repoId: 'r1',
    branch: 'sd/feature',
    name: 'feature',
    path: resolve('/wt/feature'),
    baseBranch: 'main',
    baseCommit: SHA,
    ...overrides
  })

  it('appends a worktree with a generated id, createdAt and collapsed false', () => {
    const { data, worktree } = addWorktree(sample(), draft(), { id: 'w9', now: 77 })
    expect(worktree).toMatchObject({ id: 'w9', repoId: 'r1', createdAt: 77, collapsed: false })
    expect(data.worktrees?.at(-1)).toEqual(worktree)
  })

  it('throws Repo not found for an unknown repo', () => {
    expect(() => addWorktree(sample(), draft({ repoId: 'nope' }), { id: 'w9', now: 1 })).toThrow('Repo not found')
  })

  it('throws when the path is already a worktree (any repo, same path key)', () => {
    expect(() => addWorktree(sample(), draft({ path: resolve('/wt/w3') }), { id: 'w9', now: 1 })).toThrow(
      'Worktree already added'
    )
  })
})

describe('removeWorktree', () => {
  it('removes the worktree and its sessions only', () => {
    const next = removeWorktree(sample(), 'w1')
    expect(next.worktrees?.map((w) => w.id)).toEqual(['w2', 'w3'])
    expect(next.sessions.map((s) => s.id)).toEqual(['ops', 's2', 's3'])
  })

  it('an unknown id returns the same data object', () => {
    const data = sample()
    expect(removeWorktree(data, 'missing')).toBe(data)
  })
})

describe('collapse flags', () => {
  it('setRepoCollapsed and setWorktreeCollapsed change only the matching item', () => {
    const repo = setRepoCollapsed(sample(), 'r1', true)
    expect(repo.repos?.[0].collapsed).toBe(true)
    expect(repo.repos?.[1].collapsed).toBe(false)
    const wt = setWorktreeCollapsed(sample(), 'w2', true)
    expect(wt.worktrees?.[1].collapsed).toBe(true)
    expect(wt.worktrees?.[0].collapsed).toBe(false)
  })

  it('unknown ids are no-ops', () => {
    const data = sample()
    expect(setRepoCollapsed(data, 'x', true)).toBe(data)
    expect(setWorktreeCollapsed(data, 'x', true)).toBe(data)
  })

  it('does not mutate the input', () => {
    const data = sample()
    setWorktreeCollapsed(data, 'w1', true)
    expect(data.worktrees?.[0].collapsed).toBe(false)
  })
})
