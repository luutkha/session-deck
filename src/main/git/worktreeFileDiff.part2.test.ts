import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DIFF_MAX_BYTES } from '../../shared/types'
import { addWorktree, cleanupTempDirs, makeRepo, writeText } from './testRepo'
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
