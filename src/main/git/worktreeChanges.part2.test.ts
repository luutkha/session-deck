import { appendFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ChangedFile } from '../../shared/types'
import { addWorktree, cleanupTempDirs, git, makeRepo, writeText } from './testRepo'
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

describe('readWorktreeChanges', () => {
  it('counts the lines of an untracked text file', async () => {
    const wt = newWorktree('untracked-text')
    writeText(path.join(wt.path, 'notes.md'), 'one\ntwo\nthree\n')
    const changes = await readWorktreeChanges(wt, now)
    expect(findFile(changes.files, 'notes.md')).toEqual({
      path: 'notes.md',
      kind: 'untracked',
      additions: 3,
      deletions: 0,
      uncommitted: true
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
      deletions: null,
      uncommitted: true
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
})
