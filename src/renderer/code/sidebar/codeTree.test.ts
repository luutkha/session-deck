import { describe, expect, it } from 'vitest'
import type { Repo, Session, Worktree } from '../../../shared/types'
import {
  buildCodeTree,
  filterCodeTree,
  isSearching,
  normalizeQuery,
  repoSessionCount,
  visibleSessionIds,
  visibleWorktreeIds,
  worktreeSessionCount,
  type CodeTree
} from './codeTree'

function repo(id: string, name = id, collapsed = false): Repo {
  return { id, name, path: `C:\\repos\\${name}`, createdAt: 1, collapsed }
}

function worktree(id: string, repoId: string, name = id, branch = `branch-${id}`, collapsed = false): Worktree {
  return {
    id,
    repoId,
    name,
    branch,
    path: `C:\\wt\\${id}`,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    createdAt: 1,
    collapsed
  }
}

function session(id: string, worktreeId: string, createdAt: number, extra: Partial<Session> = {}): Session {
  return {
    id,
    name: `session ${id}`,
    cwd: `C:\\wt\\${worktreeId}`,
    groupId: null,
    statusId: null,
    order: 0,
    createdAt,
    claudeArgs: [],
    worktreeId,
    ...extra
  }
}

function ids(tree: CodeTree): readonly string[] {
  return tree.repos.map((node) => node.repo.id)
}

describe('buildCodeTree', () => {
  it('nests worktrees under their repo in stored order', () => {
    const tree = buildCodeTree({
      repos: [repo('r2'), repo('r1')],
      worktrees: [worktree('w1', 'r1'), worktree('w2', 'r2'), worktree('w3', 'r1')],
      sessions: []
    })
    expect(ids(tree)).toEqual(['r2', 'r1'])
    expect(tree.repos[1].worktrees.map((node) => node.worktree.id)).toEqual(['w1', 'w3'])
  })

  it('sorts a worktree sessions by createdAt', () => {
    const tree = buildCodeTree({
      repos: [repo('r1')],
      worktrees: [worktree('w1', 'r1')],
      sessions: [session('late', 'w1', 30), session('early', 'w1', 10), session('mid', 'w1', 20)]
    })
    expect(tree.repos[0].worktrees[0].sessions.map((s) => s.id)).toEqual(['early', 'mid', 'late'])
  })

  it('moves closed sessions to the closed list and keeps them out of the worktree', () => {
    const tree = buildCodeTree({
      repos: [repo('r1')],
      worktrees: [worktree('w1', 'r1')],
      sessions: [session('open', 'w1', 1), session('shut', 'w1', 2, { closedAt: 99 })]
    })
    expect(tree.repos[0].worktrees[0].sessions.map((s) => s.id)).toEqual(['open'])
    expect(tree.closed.map((s) => s.id)).toEqual(['shut'])
  })

  it('keeps a repo with no worktrees', () => {
    const tree = buildCodeTree({ repos: [repo('r1')], worktrees: [], sessions: [] })
    expect(tree.repos).toEqual([{ repo: repo('r1'), worktrees: [] }])
  })

  it('keeps a worktree that has only closed sessions, with no sessions under it', () => {
    const tree = buildCodeTree({
      repos: [repo('r1')],
      worktrees: [worktree('w1', 'r1')],
      sessions: [session('shut', 'w1', 1, { closedAt: 5 })]
    })
    expect(tree.repos[0].worktrees).toHaveLength(1)
    expect(tree.repos[0].worktrees[0].sessions).toEqual([])
    expect(tree.closed).toHaveLength(1)
  })

  it('skips worktrees whose repo is missing', () => {
    const tree = buildCodeTree({
      repos: [repo('r1')],
      worktrees: [worktree('orphan', 'gone'), worktree('w1', 'r1')],
      sessions: []
    })
    const allWorktreeIds = tree.repos.flatMap((node) => node.worktrees.map((w) => w.worktree.id))
    expect(allWorktreeIds).toEqual(['w1'])
  })

  it('treats absent repos and worktrees as empty', () => {
    expect(buildCodeTree({ sessions: [] })).toEqual({ repos: [], closed: [] })
  })

  it('drops open sessions whose worktree is unknown', () => {
    const tree = buildCodeTree({
      repos: [repo('r1')],
      worktrees: [worktree('w1', 'r1')],
      sessions: [session('lost', 'nope', 1)]
    })
    expect(tree.repos[0].worktrees[0].sessions).toEqual([])
  })
})

describe('isSearching and normalizeQuery', () => {
  it('treats whitespace-only text as no search', () => {
    expect(isSearching('   ')).toBe(false)
    expect(isSearching(' api ')).toBe(true)
  })

  it('trims and lowercases the query', () => {
    expect(normalizeQuery('  API  ')).toBe('api')
  })
})

describe('filterCodeTree', () => {
  const data = {
    repos: [repo('r1', 'Billing'), repo('r2', 'Website')],
    worktrees: [
      worktree('w1', 'r1', 'Fix Invoices', 'feature/invoice-pdf'),
      worktree('w2', 'r1', 'Refunds', 'refunds'),
      worktree('w3', 'r2', 'Landing', 'landing')
    ],
    sessions: [
      session('s1', 'w1', 1, { name: 'Claude pass' }),
      session('s2', 'w2', 2, { name: 'refund api' }),
      session('s3', 'w3', 3, { name: 'hero copy' }),
      session('s4', 'w2', 4, { name: 'other', closedAt: 9 })
    ]
  }

  it('returns the same tree for an empty query', () => {
    const tree = buildCodeTree(data)
    expect(filterCodeTree(tree, '   ')).toBe(tree)
  })

  it('matches the repo name and keeps all of its worktrees and sessions', () => {
    const tree = filterCodeTree(buildCodeTree(data), 'BILLING')
    expect(ids(tree)).toEqual(['r1'])
    expect(tree.repos[0].worktrees.map((node) => node.worktree.id)).toEqual(['w1', 'w2'])
    expect(tree.repos[0].worktrees[0].sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('matches a worktree name and shows all its sessions', () => {
    const tree = filterCodeTree(buildCodeTree(data), 'refunds')
    expect(tree.repos[0].worktrees.map((node) => node.worktree.id)).toEqual(['w2'])
    expect(tree.repos[0].worktrees[0].sessions.map((s) => s.id)).toEqual(['s2'])
  })

  it('matches the branch only and still shows the worktree row', () => {
    const tree = filterCodeTree(buildCodeTree(data), 'invoice-pdf')
    expect(tree.repos[0].worktrees.map((node) => node.worktree.id)).toEqual(['w1'])
    expect(tree.repos[0].worktrees[0].worktree.name).toBe('Fix Invoices')
    expect(tree.repos[0].worktrees[0].sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('matches a session name and keeps only that session under its worktree', () => {
    const tree = filterCodeTree(buildCodeTree(data), 'hero')
    expect(ids(tree)).toEqual(['r2'])
    expect(tree.repos[0].worktrees[0].sessions.map((s) => s.id)).toEqual(['s3'])
  })

  it('drops repos and worktrees with no match', () => {
    const tree = filterCodeTree(buildCodeTree(data), 'zzz')
    expect(tree.repos).toEqual([])
  })

  it('filters closed sessions by name', () => {
    const tree = filterCodeTree(buildCodeTree(data), 'other')
    expect(tree.closed.map((s) => s.id)).toEqual(['s4'])
    expect(tree.repos).toEqual([])
  })
})

describe('visibleSessionIds', () => {
  const data = {
    repos: [repo('r1', 'a', true), repo('r2', 'b')],
    worktrees: [worktree('w1', 'r1'), worktree('w2', 'r2', 'x', 'x', true), worktree('w3', 'r2')],
    sessions: [session('s1', 'w1', 1), session('s2', 'w2', 1), session('s3', 'w3', 2), session('s4', 'w3', 1)]
  }

  it('lists sessions in on-screen order, skipping collapsed repos and worktrees', () => {
    expect(visibleSessionIds(buildCodeTree(data), false)).toEqual(['s4', 's3'])
  })

  it('lists every session while searching, even inside collapsed nodes', () => {
    expect(visibleSessionIds(buildCodeTree(data), true)).toEqual(['s1', 's2', 's4', 's3'])
  })

  it('lists nothing when there are no sessions', () => {
    expect(visibleSessionIds(buildCodeTree({ sessions: [] }), false)).toEqual([])
  })
})

describe('visibleWorktreeIds', () => {
  it('lists the worktree ids on screen in tree order', () => {
    const tree = buildCodeTree({
      repos: [repo('r1')],
      worktrees: [worktree('w2', 'r1'), worktree('w1', 'r1')],
      sessions: []
    })
    expect(visibleWorktreeIds(tree)).toEqual(['w2', 'w1'])
  })
})

describe('session counts for the remove dialogs', () => {
  const data = {
    repos: [repo('r1'), repo('r2')],
    worktrees: [worktree('w1', 'r1'), worktree('w2', 'r1'), worktree('w3', 'r2')],
    sessions: [
      session('s1', 'w1', 1),
      session('s2', 'w2', 2, { closedAt: 3 }),
      session('s3', 'w3', 4)
    ]
  }

  it('counts open and closed sessions of all worktrees in a repo', () => {
    expect(repoSessionCount(data, 'r1')).toBe(2)
    expect(repoSessionCount(data, 'r2')).toBe(1)
  })

  it('counts 0 for a repo with no worktrees', () => {
    expect(repoSessionCount(data, 'none')).toBe(0)
  })

  it('counts the sessions of one worktree', () => {
    expect(worktreeSessionCount(data, 'w2')).toBe(1)
    expect(worktreeSessionCount(data, 'w1')).toBe(1)
  })
})
