import { describe, expect, it } from 'vitest'
import type { Repo, Session, Worktree } from '../../shared/types'
import { moveToCodeItems } from './paletteItems'

const repo: Repo = { id: 'r1', name: 'app', path: 'C:\code\app', createdAt: 1, collapsed: false }
const wt = (id: string, name: string): Worktree => ({
  id, repoId: 'r1', name, branch: `sd/${name}`, path: `C:\wt\${name}`, baseBranch: 'main', baseCommit: 'a'.repeat(40), createdAt: 1, collapsed: false
})
const session = (extra: Partial<Session> = {}): Session => ({
  id: 's1', name: 'Docs', cwd: 'C:\notes', groupId: null, statusId: null, order: 0, createdAt: 1, claudeArgs: [], ...extra
})

describe('moveToCodeItems (D88)', () => {
  it('offers "new worktree…" first, then one item per worktree, naming repo and worktree', () => {
    const items = moveToCodeItems(session(), [repo], [wt('w1', 'one'), wt('w2', 'two')], 'Running')
    expect(items.map((i) => i.label)).toEqual(['Move to Code mode: new worktree…', 'Move to Code mode: app / one', 'Move to Code mode: app / two'])
    expect(items[0].run).toEqual({ kind: 'move-to-new-worktree', id: 's1' })
    expect(items[2].run).toEqual({ kind: 'move-to-code', id: 's1', worktreeId: 'w2' })
    expect(new Set(items.map((i) => i.id)).size).toBe(3)
  })

  it('offers nothing for a session already in a worktree, for Jarvis, or with no worktrees', () => {
    expect(moveToCodeItems(session({ worktreeId: 'w1' }), [repo], [wt('w1', 'one')], '')).toEqual([])
    expect(moveToCodeItems(session({ role: 'jarvis' }), [repo], [wt('w1', 'one')], '')).toEqual([])
    expect(moveToCodeItems(session(), [], [], '')).toEqual([])
    expect(moveToCodeItems(session(), [repo], [], '').map((i) => i.run.kind)).toEqual(['move-to-new-worktree'])
  })

  it('caps a huge worktree list', () => {
    const many = Array.from({ length: 80 }, (_, i) => wt(`w${i}`, `n${i}`))
    expect(moveToCodeItems(session(), [repo], many, '').length).toBe(31)
  })
})
