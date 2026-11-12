import { appendFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addWorktree, cleanupTempDirs, git, makeRepo, writeText } from './testRepo'
import { readFileDiff } from './worktreeFileDiff'
import { readWorktreeChanges, type WorktreeRef } from './worktreeChanges'

const NOW = 1_700_000_000_000
const now = (): number => NOW

let repo = ''
let counter = 0

/** A fresh worktree forked from main, so each scenario starts clean. */
function setUp(label: string): WorktreeRef {
  counter++
  const { dir, baseCommit } = addWorktree(repo, `${label}-${counter}`)
  return { id: `wt-${counter}`, path: dir, baseBranch: 'main', baseCommit }
}

beforeAll(() => {
  ;({ repo } = makeRepo('filediff'))
})

afterAll(() => {
  cleanupTempDirs()
})

describe('readFileDiff', () => {
  it('returns the unified diff of a modified file', async () => {
    const wt = setUp('modified')
    appendFileSync(path.join(wt.path, 'a.txt'), 'line 4\n')
    const changes = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, 'a.txt', changes)
    expect(diff).toEqual({
      worktreeId: wt.id,
      path: 'a.txt',
      diff: expect.stringContaining('@@'),
      binary: false,
      truncated: false
    })
    expect(diff.diff).toContain('+line 4')
  })

  it('shows every line of an untracked text file as added', async () => {
    const wt = setUp('untracked')
    writeText(path.join(wt.path, 'notes.md'), 'one\ntwo\n')
    const changes = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, 'notes.md', changes)
    expect(diff.diff).toContain('+one')
    expect(diff.diff).toContain('+two')
    expect(diff.diff).toContain('/dev/null')
    expect(diff.binary).toBe(false)
  })

  it('shows the removed lines of a deleted file', async () => {
    const wt = setUp('deleted')
    unlinkSync(path.join(wt.path, 'gone.txt'))
    const changes = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, 'gone.txt', changes)
    expect(diff.diff).toContain('-gone.txt line 1')
  })

  it('diffs a rename between the old and the new path', async () => {
    const wt = setUp('renamed')
    git(wt.path, 'mv', 'b.txt', 'b-renamed.txt')
    const changes = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, 'b-renamed.txt', changes)
    expect(diff.diff).toContain('rename from b.txt')
    expect(diff.diff).toContain('rename to b-renamed.txt')
  })
})
