// D60: the Code mode git operations as the Changes panel and Jarvis call them, on real temp repositories.
import { appendFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Repo, Worktree, WorktreeChanges } from '../../shared/types'
import type { SessionStore } from '../store'
import { runGit, type GitRun } from '../git'
import { addWorktree, cleanupTempDirs, git, makeRepo } from '../git/testRepo'
import { createCodeGitOps, type CodeGitOpsDeps } from './codeGitOps'

afterAll(() => cleanupTempDirs())

const run: GitRun = (args, options) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], options)

function setup(extra: Partial<CodeGitOpsDeps> = {}, main = false) {
  const { repo } = makeRepo('ops')
  const wt = main ? { dir: repo } : addWorktree(repo, 'fix-login')
  const repoRow: Repo = { id: 'r1', name: 'shop', path: repo, createdAt: 1, collapsed: false }
  const worktree: Worktree = {
    id: 'w1', repoId: 'r1', name: 'fix login', branch: main ? 'main' : 'fix-login', path: wt.dir, baseBranch: 'main',
    baseCommit: git(repo, 'rev-parse', 'main'), createdAt: 1, collapsed: false, ...(main ? { main: true } : {})
  }
  let present = true
  const store = {
    getWorktree: (id: string) => (present && id === 'w1' ? worktree : undefined),
    getRepo: (id: string) => (id === 'r1' ? repoRow : undefined)
  } as unknown as SessionStore
  const removed: string[] = []
  const opened: string[] = []
  let latest: WorktreeChanges | undefined
  const deps: CodeGitOpsDeps = {
    store,
    removeFromSessionDeck: (id) => { removed.push(id); present = false },
    refreshChanges: vi.fn(async () => ({ worktreeId: 'w1', files: [], truncated: false, additions: 0, deletions: 0, computedAt: 1 })),
    latestChanges: () => latest,
    openExternal: async (url) => { opened.push(url) },
    ghReady: async () => false,
    run,
    sleep: async () => undefined,
    ...extra
  }
  return { ops: createCodeGitOps(deps), repo, wt: wt.dir, removed, opened, deps, setLatest: (c: WorktreeChanges) => { latest = c } }
}

describe('createCodeGitOps (D60)', () => {
  it('remove without deleteFromDisk only forgets; with it removes folder and merged branch', async () => {
    const keep = setup()
    expect(await keep.ops.remove('w1', {})).toEqual({ folderDeleted: false, branchDeleted: false })
    expect(keep.removed).toEqual(['w1'])
    expect(existsSync(keep.wt)).toBe(true)
    const t = setup()
    expect(await t.ops.removalInfo('w1')).toMatchObject({ uncommitted: 0, branchMerged: true, folderExists: true, repoFolder: false })
    expect(await t.ops.remove('w1', { deleteFromDisk: true })).toEqual({ folderDeleted: true, branchDeleted: true })
    expect(t.removed).toEqual(['w1'])
    expect(existsSync(t.wt)).toBe(false)
  })

  it('remove refuses uncommitted work before touching anything, and never deletes the repository folder', async () => {
    const t = setup()
    appendFileSync(path.join(t.wt, 'a.txt'), 'x\n')
    await expect(t.ops.remove('w1', { deleteFromDisk: true })).rejects.toThrow('1 uncommitted file')
    expect(t.removed).toEqual([])
    const main = setup({}, true)
    await expect(main.ops.remove('w1', { deleteFromDisk: true })).rejects.toThrow('never deleted')
    expect(main.removed).toEqual([])
  })
})
