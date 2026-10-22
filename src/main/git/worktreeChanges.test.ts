import { appendFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHANGES_MAX_FILES, type ChangedFile } from '../../shared/types'
import { GitError, type GitRun } from './gitRunner'
import { addWorktree, cleanupTempDirs, git, makeRepo, makeTempDir, writeText } from './testRepo'
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
    expect(findFile(changes.files, 'b.txt')).toEqual({ path: 'b.txt', kind: 'modified', additions: 2, deletions: 0 })
  })

  it('reports an unstaged change', async () => {
    const wt = newWorktree('unstaged')
    appendFileSync(path.join(wt.path, 'c.txt'), 'line 4\n')
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'c.txt')).toEqual({ path: 'c.txt', kind: 'modified', additions: 1, deletions: 0 })
  })

  it('reports a deleted file with its removed line count', async () => {
    const wt = newWorktree('deleted')
    unlinkSync(path.join(wt.path, 'gone.txt'))
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'gone.txt')).toEqual({ path: 'gone.txt', kind: 'deleted', additions: 0, deletions: 3 })
  })

  it('reports a renamed file with its old path', async () => {
    const wt = newWorktree('renamed')
    git(wt.path, 'mv', 'a.txt', 'renamed.txt')
    const changes = await readWorktreeChanges(wt, now)
    expect(changes.files).toEqual([
      { path: 'renamed.txt', oldPath: 'a.txt', kind: 'renamed', additions: 0, deletions: 0 }
    ])
  })

  it('counts the lines of an untracked text file', async () => {
    const wt = newWorktree('untracked-text')
    writeText(path.join(wt.path, 'notes.md'), 'one\ntwo\nthree\n')
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'notes.md')).toEqual({
      path: 'notes.md',
      kind: 'untracked',
      additions: 3,
      deletions: 0
    })
  })

  it('reports null counts for an untracked binary file', async () => {
    const wt = newWorktree('untracked-bin')
    writeFileSync(path.join(wt.path, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0a]))
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'image.bin')).toEqual({
      path: 'image.bin',
      kind: 'untracked',
      additions: null,
      deletions: null
    })
  })

  it('keeps spaces in file names and uses forward slashes in nested paths', async () => {
    const wt = newWorktree('names')
    writeText(path.join(wt.path, 'my notes.txt'), 'x\n')
    writeText(path.join(wt.path, 'sub', 'dir', 'x.txt'), 'y\n')
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'my notes.txt')?.additions).toBe(1)
    expect(findFile(changes.files, 'sub/dir/x.txt')?.kind).toBe('untracked')
  })

  it('sums known counts over all files and leaves binary counts out of the sum', async () => {
    const wt = newWorktree('totals')
    appendFileSync(path.join(wt.path, 'a.txt'), 'line 4\n')
    unlinkSync(path.join(wt.path, 'gone.txt'))
    writeText(path.join(wt.path, 'notes.md'), 'one\ntwo\n')
    const changes = await readWorktreeChanges(wt, now)
    expect(changes.additions).toBe(3)
    expect(changes.deletions).toBe(3)
  })

  it('keeps comparing with the fork point after the base branch moves on', async () => {
    const wt = newWorktree('base-moved')
    writeText(path.join(repo, 'moved-on-main.txt'), 'later\n')
    commitAll(repo, 'advance main')
    const changes = await readWorktreeChanges(wt, now)
    expect(changes.files).toEqual([])
    expect(await diffBase(wt)).toBe(mainSha)
  })

  it('still shows committed work when the base branch was deleted', async () => {
    git(repo, 'branch', 'release-x', 'main')
    const wt = newWorktree('from-release', 'release-x')
    appendFileSync(path.join(wt.path, 'a.txt'), 'line 4\n')
    commitAll(wt.path, 'edit on release base')
    git(repo, 'branch', '-D', 'release-x')
    const changes = await readWorktreeChanges(wt, now)
    expect(changes.error).toBeUndefined()
    expect(findFile(changes.files, 'a.txt')?.additions).toBe(1)
  })

  it('returns an error message and no files when the folder is missing', async () => {
    const missing = path.join(makeTempDir('gone-wt'), 'missing')
    const changes = await readWorktreeChanges({ id: 'gone', path: missing, baseBranch: 'main', baseCommit: mainSha }, now)
    expect(changes).toEqual({
      worktreeId: 'gone',
      files: [],
      truncated: false,
      additions: 0,
      deletions: 0,
      computedAt: NOW,
      error: `Worktree folder not found: ${missing}`
    })
  })

  it('returns the git error message instead of throwing', async () => {
    const failingRun: GitRun = () => Promise.reject(new GitError('boom'))
    const wt = newWorktree('failing')
    const changes = await readWorktreeChanges(wt, now, failingRun)
    expect(changes.files).toEqual([])
    expect(changes.error).toBe('boom')
  })

  it('reports a non-Error failure as its string form', async () => {
    const rejectingRun: GitRun = () => Promise.reject('plain text failure')
    const changes = await readWorktreeChanges(newWorktree('plain-failure'), now, rejectingRun)
    expect(changes.error).toBe('plain text failure')
  })

  it('caps the list at CHANGES_MAX_FILES but still totals every file', async () => {
    const wt = newWorktree('many')
    const count = CHANGES_MAX_FILES + 1
    for (let index = 0; index < count; index++) {
      writeText(path.join(wt.path, 'many', `f${String(index).padStart(3, '0')}.txt`), 'x\n')
    }
    const changes = await readWorktreeChanges(wt, now)
    expect(changes.files).toHaveLength(CHANGES_MAX_FILES)
    expect(changes.truncated).toBe(true)
    expect(changes.files[0]?.path).toBe('many/f000.txt')
    expect(changes.additions).toBe(count)
  })
})
