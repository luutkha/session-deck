import { appendFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DIFF_MAX_BYTES } from '../../shared/types'
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

  it('reports a binary untracked file without diff text', async () => {
    const wt = setUp('binary')
    writeFileSync(path.join(wt.path, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0a]))
    const changes = await readWorktreeChanges(wt, now)
    expect(await readFileDiff(wt, 'image.bin', changes)).toEqual({
      worktreeId: wt.id,
      path: 'image.bin',
      diff: '',
      binary: true,
      truncated: false
    })
  })

  it('rejects a path that is not in the changes list', async () => {
    const wt = setUp('not-listed')
    const changes = await readWorktreeChanges(wt, now)
    await expect(readFileDiff(wt, 'README.md', changes)).rejects.toThrow('File is not in the changes list')
  })

  it('rejects a path that escapes the worktree', async () => {
    const wt = setUp('traversal')
    writeText(path.join(wt.path, 'safe.txt'), 'x\n')
    const changes = await readWorktreeChanges(wt, now)
    await expect(readFileDiff(wt, '../../etc/passwd', changes)).rejects.toThrow(
      'File is not in the changes list'
    )
  })

  it('cuts a diff larger than DIFF_MAX_BYTES at a line break and marks it truncated', async () => {
    const wt = setUp('huge')
    const line = `${'x'.repeat(99)}\n`
    writeText(path.join(wt.path, 'huge.txt'), line.repeat(Math.ceil((DIFF_MAX_BYTES * 1.2) / line.length)))
    const changes = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, 'huge.txt', changes)
    expect(diff.truncated).toBe(true)
    expect(Buffer.byteLength(diff.diff, 'utf8')).toBeLessThanOrEqual(DIFF_MAX_BYTES)
    expect(diff.diff.endsWith('\n')).toBe(true)
    expect(diff.binary).toBe(false)
  })
})
