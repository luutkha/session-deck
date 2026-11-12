import { appendFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ChangedFile } from '../../shared/types'
import { addWorktree, cleanupTempDirs, git, makeRepo } from './testRepo'
import { diffBase, readWorktreeChanges, type WorktreeRef } from './worktreeChanges'

const NOW = 1_700_000_000_000
const now = (): number => NOW

let repo = ''
let mainSha = ''
let counter = 0

/** A fresh linked worktree forked from main; every test gets its own so scenarios never interfere. */
function newWorktree(label: string, base = 'main'): WorktreeRef {
  counter++
  const branch = `${label}-${counter}`
  const { dir, baseCommit } = addWorktree(repo, branch, base)
  return { id: `wt-${counter}`, path: dir, baseBranch: base, baseCommit }
}

function findFile(files: readonly ChangedFile[], filePath: string): ChangedFile | undefined {
  return files.find((file) => file.path === filePath)
}

function commitAll(worktreePath: string, message: string): void {
  git(worktreePath, 'add', '-A')
  git(worktreePath, 'commit', '-m', message)
}

beforeAll(() => {
  ;({ repo, mainSha } = makeRepo('changes'))
})

afterAll(() => {
  cleanupTempDirs()
})

describe('diffBase', () => {
  it('returns the merge-base of the base branch and HEAD', async () => {
    const wt = newWorktree('base-merge')
    expect(await diffBase(wt)).toBe(mainSha)
  })

  it('falls back to the stored base commit when the base branch is gone', async () => {
    git(repo, 'branch', 'short-lived', 'main')
    const wt = newWorktree('base-gone', 'short-lived')
    git(repo, 'branch', '-D', 'short-lived')
    expect(await diffBase(wt)).toBe(wt.baseCommit)
  })
})

describe('readWorktreeChanges', () => {
  it('reports no files and zero totals for a clean worktree', async () => {
    const changes = await readWorktreeChanges(newWorktree('clean'), now)
    expect(changes).toEqual({
      worktreeId: expect.any(String),
      files: [],
      truncated: false,
      additions: 0,
      deletions: 0,
      computedAt: NOW
    })
    expect(changes.error).toBeUndefined()
  })

  it('reports a committed change on the branch', async () => {
    const wt = newWorktree('committed')
    appendFileSync(path.join(wt.path, 'a.txt'), 'line 4\n')
    commitAll(wt.path, 'edit a')
    const changes = await readWorktreeChanges(wt, now)
    expect(changes.files).toEqual([{ path: 'a.txt', kind: 'modified', additions: 1, deletions: 0 }])
  })

  it('reports a staged change', async () => {
    const wt = newWorktree('staged')
    appendFileSync(path.join(wt.path, 'b.txt'), 'line 4\nline 5\n')
    git(wt.path, 'add', 'b.txt')
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'b.txt')).toEqual({ path: 'b.txt', kind: 'modified', additions: 2, deletions: 0, uncommitted: true })
  })

  it('reports an unstaged change', async () => {
    const wt = newWorktree('unstaged')
    appendFileSync(path.join(wt.path, 'c.txt'), 'line 4\n')
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'c.txt')).toEqual({ path: 'c.txt', kind: 'modified', additions: 1, deletions: 0, uncommitted: true })
  })

  it('reports a deleted file with its removed line count', async () => {
    const wt = newWorktree('deleted')
    unlinkSync(path.join(wt.path, 'gone.txt'))
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'gone.txt')).toEqual({ path: 'gone.txt', kind: 'deleted', additions: 0, deletions: 3, uncommitted: true })
  })

  it('reports a renamed file with its old path', async () => {
    const wt = newWorktree('renamed')
    git(wt.path, 'mv', 'a.txt', 'renamed.txt')
    const changes = await readWorktreeChanges(wt, now)
    expect(changes.files).toEqual([
      { path: 'renamed.txt', oldPath: 'a.txt', kind: 'renamed', additions: 0, deletions: 0, uncommitted: true }
    ])
  })
})
