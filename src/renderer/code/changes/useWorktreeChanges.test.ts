import { describe, expect, it } from 'vitest'
import type { ChangedFile, WorktreeChanges } from '../../../shared/types'
import { changesContentKey, DEFAULT_POLL_MS, shouldSkipPoll } from './useWorktreeChanges'

function file(path: string, additions: number | null = 1, deletions: number | null = 0): ChangedFile {
  return { path, kind: 'modified', additions, deletions }
}

function snapshot(files: readonly ChangedFile[], computedAt = 1, extra: Partial<WorktreeChanges> = {}): WorktreeChanges {
  return { worktreeId: 'w1', files, truncated: false, additions: 1, deletions: 0, computedAt, ...extra }
}

describe('changesContentKey', () => {
  it('is the same for identical files with a newer computedAt (a poll changed nothing)', () => {
    const files = [file('a.ts'), file('src/b.ts', 3, 2)]
    expect(changesContentKey(snapshot(files, 1))).toBe(changesContentKey(snapshot(files, 999)))
  })

  it('changes when counts, paths, kinds, renames or uncommitted flags change', () => {
    const base = changesContentKey(snapshot([file('a.ts')]))
    expect(changesContentKey(snapshot([file('a.ts', 2, 0)]))).not.toBe(base)
    expect(changesContentKey(snapshot([file('a.ts', 1, 1)]))).not.toBe(base)
    expect(changesContentKey(snapshot([file('b.ts')]))).not.toBe(base)
    expect(changesContentKey(snapshot([{ ...file('a.ts'), kind: 'deleted' }]))).not.toBe(base)
    expect(changesContentKey(snapshot([{ ...file('a.ts'), oldPath: 'old.ts' }]))).not.toBe(base)
    expect(changesContentKey(snapshot([{ ...file('a.ts'), uncommitted: true }]))).not.toBe(base)
    expect(changesContentKey(snapshot([]))).not.toBe(base)
  })

  it('is order-insensitive: the same rows in another order give the same key', () => {
    const a = file('a.ts')
    const b = file('b.ts')
    expect(changesContentKey(snapshot([a, b]))).toBe(changesContentKey(snapshot([b, a])))
  })

  it('includes truncation, errors and the null list', () => {
    const base = changesContentKey(snapshot([]))
    expect(changesContentKey(snapshot([], 1, { truncated: true }))).not.toBe(base)
    expect(changesContentKey(snapshot([], 1, { error: 'git failed' }))).not.toBe(base)
    expect(changesContentKey(null)).toBe('')
    expect(changesContentKey(null)).not.toBe(base)
  })
})

describe('shouldSkipPoll', () => {
  it('skips a tick shortly after a push for this worktree', () => {
    expect(shouldSkipPoll(10_000, 9_950, DEFAULT_POLL_MS)).toBe(true)
    expect(shouldSkipPoll(10_000, 10_000, DEFAULT_POLL_MS)).toBe(true)
  })

  it('keeps the safety-net poll when no push arrived or the interval has passed', () => {
    expect(shouldSkipPoll(10_000, null, DEFAULT_POLL_MS)).toBe(false)
    expect(shouldSkipPoll(20_000, 10_000, DEFAULT_POLL_MS)).toBe(false)
    expect(shouldSkipPoll(20_000, 20_001, DEFAULT_POLL_MS)).toBe(false)
  })
})
