import { describe, expect, it } from 'vitest'
import type { Session, Worktree } from '../../shared/types'
import { codeNewDialog, opsNewDialog, worktreeSessionDialog } from './newSessionTarget'

const worktree: Worktree = {
  id: 'w1',
  repoId: 'r1',
  name: 'feature',
  branch: 'feature',
  path: 'C:\\Works\\wt\\feature',
  baseBranch: 'main',
  baseCommit: 'a'.repeat(40),
  createdAt: 1,
  collapsed: false
}

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    name: 'Session',
    cwd: worktree.path,
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...overrides
  }
}

describe('opsNewDialog', () => {
  it('opens an ungrouped, unstatused Ops dialog by default', () => {
    expect(opsNewDialog()).toEqual({ kind: 'ops', groupId: null, statusId: null })
  })

  it('carries the group, status and folder it was given', () => {
    expect(opsNewDialog('g1', 's1', 'C:\\x')).toEqual({ kind: 'ops', groupId: 'g1', statusId: 's1', folder: 'C:\\x' })
  })
})

describe('codeNewDialog', () => {
  it('opens a new session in the worktree of the active session', () => {
    const active = session({ id: 's1', worktreeId: 'w1' })
    expect(codeNewDialog(active, [worktree])).toEqual({ kind: 'worktree-session', worktree })
  })

  it('opens the new worktree dialog when no session is active', () => {
    expect(codeNewDialog(null, [worktree])).toEqual({ kind: 'worktree' })
  })

  it('opens the new worktree dialog when the active session is an Ops session', () => {
    expect(codeNewDialog(session({ id: 's1' }), [worktree])).toEqual({ kind: 'worktree' })
  })

  it('opens the new worktree dialog when the active worktree is no longer stored', () => {
    expect(codeNewDialog(session({ id: 's1', worktreeId: 'gone' }), [worktree])).toEqual({ kind: 'worktree' })
  })
})

describe('worktreeSessionDialog', () => {
  it('finds the worktree by id', () => {
    expect(worktreeSessionDialog('w1', [worktree])).toEqual({ kind: 'worktree-session', worktree })
  })

  it('returns null for an unknown worktree', () => {
    expect(worktreeSessionDialog('nope', [worktree])).toBeNull()
  })
})
