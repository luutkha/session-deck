import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHANGES_MAX_FILES } from '../../shared/types'
import { GitError, type GitRun } from './gitRunner'
import { addWorktree, cleanupTempDirs, makeRepo, makeTempDir, writeText } from './testRepo'
import { readWorktreeChanges, type WorktreeRef } from './worktreeChanges'

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

beforeAll(() => {
  ;({ repo, mainSha } = makeRepo('changes'))
})

afterAll(() => {
  cleanupTempDirs()
})

describe('readWorktreeChanges', () => {
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
    // 60s: ~100 real git operations; the default 5s once timed out under the parallel full suite.
  }, 60_000)
})
