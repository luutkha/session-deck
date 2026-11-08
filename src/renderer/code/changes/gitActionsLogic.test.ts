import { describe, expect, it } from 'vitest'
import type { BranchStatus, WorktreeChanges } from '../../../shared/types'
import {
  aheadBehindLabel,
  chosenPaths,
  commitCandidates,
  commitState,
  mergeState,
  pruneUnticked,
  pullRequestState,
  pushState
} from './gitActionsLogic'

const changes: WorktreeChanges = {
  worktreeId: 'w1',
  files: [
    { path: 'a.ts', kind: 'modified', additions: 1, deletions: 0, uncommitted: true },
    { path: 'done.ts', kind: 'modified', additions: 1, deletions: 0 },
    { path: 'new.ts', kind: 'untracked', additions: 3, deletions: 0, uncommitted: true }
  ],
  truncated: false, additions: 5, deletions: 0, computedAt: 1
}

function status(extra: Partial<BranchStatus> = {}): BranchStatus {
  return {
    worktreeId: 'w1', branch: 'fix', baseBranch: 'main', remote: 'origin', upstream: 'origin/fix', ahead: 2, behind: 0,
    uncommitted: 0, repoFolder: false, compareUrl: 'https://github.com/a/b/compare/main...fix?expand=1', ghReady: false, ...extra
  }
}

describe('commit selection (D60)', () => {
  it('only uncommitted files are candidates; unticked ones are left out', () => {
    expect(commitCandidates(changes).map((f) => f.path)).toEqual(['a.ts', 'new.ts'])
    expect(commitCandidates(null)).toEqual([])
    expect(chosenPaths(changes, new Set(['new.ts']))).toEqual(['a.ts'])
  })

  it('pruneUnticked drops paths that are no longer candidates and keeps the same set when nothing changed', () => {
    const same = new Set(['a.ts'])
    expect(pruneUnticked(changes, same)).toBe(same)
    expect([...pruneUnticked(changes, new Set(['a.ts', 'done.ts', 'gone.ts']))]).toEqual(['a.ts'])
  })

  it('commitState needs files and a message', () => {
    expect(commitState('', 2, false)).toEqual({ enabled: false, hint: 'Write a commit message.' })
    expect(commitState('fix', 0, false).enabled).toBe(false)
    expect(commitState('fix', 1, true).enabled).toBe(false)
    expect(commitState('fix', 2, false)).toEqual({ enabled: true, hint: 'Commit 2 files (Ctrl+Enter)' })
  })
})

describe('branch actions (D60)', () => {
  it('push needs a remote and commits to send', () => {
    expect(pushState(null, false).enabled).toBe(false)
    expect(pushState(status({ remote: null }), false).hint).toBe('This repository has no remote.')
    expect(pushState(status({ ahead: 0 }), false).hint).toBe('Up to date with origin/fix.')
    expect(pushState(status({ upstream: null, ahead: 0 }), false).hint).toBe('No commits to push yet.')
    expect(pushState(status(), false)).toEqual({ enabled: true, hint: 'Push 2 commits to origin' })
  })

  it('pull request: own branch, remote, known host, something committed; says what it will do', () => {
    expect(pullRequestState(status({ branch: 'main' }), false).enabled).toBe(false)
    expect(pullRequestState(status({ compareUrl: null }), false).hint).toContain('GitHub, GitLab and Bitbucket')
    expect(pullRequestState(status({ upstream: null, ahead: 0 }), false).hint).toBe('Commit something first.')
    expect(pullRequestState(status(), false).hint).toBe('Pushes, then opens the pull request page in your browser.')
    expect(pullRequestState(status({ ahead: 0, ghReady: true }), false).hint).toBe('Creates the pull request with the GitHub CLI.')
  })

  it('merge is hidden for the repository folder and needs everything committed', () => {
    expect(mergeState(status({ repoFolder: true }), false)).toBeNull()
    expect(mergeState(status({ uncommitted: 2 }), false)?.enabled).toBe(false)
    expect(mergeState(status(), false)).toEqual({ enabled: true, hint: 'Merge fix into main in the repository folder.' })
  })

  it('ahead/behind label', () => {
    expect(aheadBehindLabel(status({ ahead: 2, behind: 1 }))).toBe('↑2 ↓1')
    expect(aheadBehindLabel(status({ ahead: 0 }))).toBe('')
    expect(aheadBehindLabel(null)).toBe('')
  })
})
