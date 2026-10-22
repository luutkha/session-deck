import { describe, expect, it } from 'vitest'
import type { FileDiff, WorktreeChanges } from '../../../shared/types'
import { CHANGES_LOAD_FAILED, DIFF_LOAD_FAILED } from './changesLoad'
import {
  INITIAL_CHANGES_VIEW,
  INITIAL_DIFF_VIEW,
  applyPushedChanges,
  beginChangesLoad,
  beginDiffLoad,
  diffForKey,
  diffKey,
  finishChangesLoad,
  finishDiffLoad,
  idSetKey,
  idsFromKey,
  isStillChanged,
  putCount,
  pruneCounts,
  viewFor,
  type ChangesViewState,
  type DiffViewState
} from './changesState'

function snapshot(worktreeId: string, computedAt: number): WorktreeChanges {
  return { worktreeId, files: [], truncated: false, additions: 0, deletions: 0, computedAt }
}

function loadedFor(worktreeId: string, computedAt: number): ChangesViewState {
  return { worktreeId, changes: snapshot(worktreeId, computedAt), loading: false, error: null }
}

function fileDiff(path: string, diff: string): FileDiff {
  return { worktreeId: 'w1', path, diff, binary: false, truncated: false }
}

describe('changes list transitions', () => {
  it('starts with nothing shown and no worktree', () => {
    expect(INITIAL_CHANGES_VIEW).toEqual({ worktreeId: null, changes: null, loading: false, error: null })
  })

  it('drops the previous worktree data as soon as another worktree starts loading', () => {
    const next = beginChangesLoad(loadedFor('w1', 3), 'w2')
    expect(next).toEqual({ worktreeId: 'w2', changes: null, loading: true, error: null })
  })

  it('keeps the shown data while the same worktree reloads', () => {
    const next = beginChangesLoad(loadedFor('w1', 3), 'w1')
    expect(next.changes).toEqual(snapshot('w1', 3))
    expect(next.loading).toBe(true)
  })

  it('stores the reply for the worktree being shown', () => {
    const begun = beginChangesLoad(INITIAL_CHANGES_VIEW, 'w1')
    const done = finishChangesLoad(begun, 'w1', { ok: true, value: snapshot('w1', 7) })
    expect(done).toEqual({ worktreeId: 'w1', changes: snapshot('w1', 7), loading: false, error: null })
  })

  it('drops a reply for a worktree that is no longer shown (out of order across ids)', () => {
    const begun = beginChangesLoad(INITIAL_CHANGES_VIEW, 'w2')
    const done = finishChangesLoad(begun, 'w1', { ok: true, value: snapshot('w1', 7) })
    expect(done).toBe(begun)
  })

  it('shows a short message when the load failed and keeps no stale error', () => {
    const begun = beginChangesLoad(INITIAL_CHANGES_VIEW, 'w1')
    const failed = finishChangesLoad(begun, 'w1', { ok: false, error: CHANGES_LOAD_FAILED })
    expect(failed).toEqual({ worktreeId: 'w1', changes: null, loading: false, error: CHANGES_LOAD_FAILED })
    expect(beginChangesLoad(failed, 'w1').error).toBeNull()
  })

  it('does not let an older reply overwrite a newer pushed snapshot', () => {
    const pushed = applyPushedChanges(beginChangesLoad(INITIAL_CHANGES_VIEW, 'w1'), snapshot('w1', 9))
    const late = finishChangesLoad(pushed, 'w1', { ok: true, value: snapshot('w1', 4) })
    expect(late.changes).toEqual(snapshot('w1', 9))
  })

  it('shows nothing when no worktree is selected', () => {
    expect(viewFor(loadedFor('w1', 3), null)).toEqual(INITIAL_CHANGES_VIEW)
  })

  it('shows a loading placeholder, not the previous worktree, before the state catches up', () => {
    expect(viewFor(loadedFor('w1', 3), 'w2')).toEqual({ worktreeId: 'w2', changes: null, loading: true, error: null })
  })

  it('shows the stored state when it belongs to the selected worktree', () => {
    const stored = loadedFor('w1', 3)
    expect(viewFor(stored, 'w1')).toBe(stored)
  })

  it('applies pushed changes for the worktree shown and clears loading', () => {
    const next = applyPushedChanges(beginChangesLoad(INITIAL_CHANGES_VIEW, 'w1'), snapshot('w1', 5))
    expect(next).toEqual({ worktreeId: 'w1', changes: snapshot('w1', 5), loading: false, error: null })
  })

  it('ignores pushed changes for another worktree', () => {
    const before = loadedFor('w1', 3)
    expect(applyPushedChanges(before, snapshot('w2', 8))).toBe(before)
  })
})

describe('isStillChanged', () => {
  const withFile = (path: string): WorktreeChanges => ({
    worktreeId: 'w1',
    files: [{ path, kind: 'modified', additions: 1, deletions: 1 }],
    truncated: false,
    additions: 1,
    deletions: 1,
    computedAt: 1
  })

  it('is true while the selected path is in the list', () => {
    expect(isStillChanged(withFile('a.ts'), 'a.ts')).toBe(true)
  })

  it('is false once the path has left the list, and when nothing is selected or loaded', () => {
    expect(isStillChanged(withFile('a.ts'), 'b.ts')).toBe(false)
    expect(isStillChanged(withFile('a.ts'), null)).toBe(false)
    expect(isStillChanged(null, 'a.ts')).toBe(false)
  })
})

describe('worktree count map', () => {
  it('stores a snapshot under its worktree id', () => {
    const counts = putCount(new Map(), snapshot('w1', 2))
    expect(counts.get('w1')).toEqual(snapshot('w1', 2))
  })

  it('keeps the newer snapshot when an older one arrives late', () => {
    const counts = putCount(new Map(), snapshot('w1', 9))
    expect(putCount(counts, snapshot('w1', 4))).toBe(counts)
  })

  it('returns the same map when the very same snapshot is stored again', () => {
    const stored = snapshot('w1', 9)
    const counts = putCount(new Map(), stored)
    expect(putCount(counts, stored)).toBe(counts)
  })

  it('drops counts of worktrees that are no longer wanted', () => {
    const counts = new Map([
      ['w1', snapshot('w1', 1)],
      ['w2', snapshot('w2', 1)]
    ])
    const pruned = pruneCounts(counts, new Set(['w2']))
    expect([...pruned.keys()]).toEqual(['w2'])
  })

  it('returns the same map when every count is still wanted', () => {
    const counts = new Map([['w1', snapshot('w1', 1)]])
    expect(pruneCounts(counts, new Set(['w1', 'w2']))).toBe(counts)
  })
})

describe('id set key', () => {
  it('ignores order and duplicates, so the same set gives the same key', () => {
    expect(idSetKey(['w2', 'w1', 'w2'])).toBe(idSetKey(['w1', 'w2']))
  })

  it('round-trips the ids and gives no ids for an empty set', () => {
    expect(idsFromKey(idSetKey(['w2', 'w1']))).toEqual(['w1', 'w2'])
    expect(idsFromKey(idSetKey([]))).toEqual([])
  })
})

describe('file diff transitions', () => {
  it('builds a key that differs for another path or another worktree', () => {
    expect(diffKey('w1', 'a.ts')).not.toBe(diffKey('w1', 'b.ts'))
    expect(diffKey('w1', 'a.ts')).not.toBe(diffKey('w2', 'a.ts'))
    expect(diffKey('w1', 'a.ts')).toBe(diffKey('w1', 'a.ts'))
  })

  it('reads as loading for a key that has not been loaded yet', () => {
    expect(diffForKey(INITIAL_DIFF_VIEW, diffKey('w1', 'a.ts'))).toEqual({ diff: null, loading: true, error: null })
  })

  it('stores a diff for the key it was loaded for', () => {
    const key = diffKey('w1', 'a.ts')
    const done = finishDiffLoad(beginDiffLoad(INITIAL_DIFF_VIEW, key), key, { ok: true, value: fileDiff('a.ts', '@@') })
    expect(diffForKey(done, key)).toEqual({ diff: fileDiff('a.ts', '@@'), loading: false, error: null })
  })

  it('keeps the old text while the same file reloads', () => {
    const key = diffKey('w1', 'a.ts')
    const loaded: DiffViewState = { key, diff: fileDiff('a.ts', 'old'), loading: false, error: null }
    expect(diffForKey(beginDiffLoad(loaded, key), key).diff).toEqual(fileDiff('a.ts', 'old'))
  })

  it('reads as loading, not as the previous file, for a different key', () => {
    const loaded: DiffViewState = { key: diffKey('w1', 'a.ts'), diff: fileDiff('a.ts', 'x'), loading: false, error: null }
    expect(diffForKey(loaded, diffKey('w1', 'b.ts'))).toEqual({ diff: null, loading: true, error: null })
  })

  it('shows the short message when a load failed', () => {
    const key = diffKey('w1', 'gone.ts')
    const failed = finishDiffLoad(beginDiffLoad(INITIAL_DIFF_VIEW, key), key, { ok: false, error: DIFF_LOAD_FAILED })
    expect(diffForKey(failed, key)).toEqual({ diff: null, loading: false, error: DIFF_LOAD_FAILED })
  })

  it('drops a reply for a file that was selected after it was requested', () => {
    const oldKey = diffKey('w1', 'a.ts')
    const newKey = diffKey('w1', 'b.ts')
    const begun = beginDiffLoad(INITIAL_DIFF_VIEW, newKey)
    expect(finishDiffLoad(begun, oldKey, { ok: true, value: fileDiff('a.ts', 'late') })).toBe(begun)
  })
})
