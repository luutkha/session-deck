// D60: the Code mode git operations as the Changes panel and Jarvis call them, on real temp repositories.
import { appendFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Repo, Worktree, WorktreeChanges } from '../../shared/types'
import type { SessionStore } from '../store'
import { runGit, type GitRun } from '../git'
import { addWorktree, cleanupTempDirs, git, makeRepo, makeTempDir } from '../git/testRepo'
import { createCodeGitOps, type CodeGitOpsDeps } from './codeGitOps'
import { asCommitInput, asPullRequestInput, asWorktreeRemoveOptions } from './codeGitValidation'

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
  it('commits the chosen files and refreshes the Changes list', async () => {
    const t = setup()
    appendFileSync(path.join(t.wt, 'a.txt'), 'x\n')
    appendFileSync(path.join(t.wt, 'b.txt'), 'y\n')
    const result = await t.ops.commit({ worktreeId: 'w1', message: 'fix: a', paths: ['a.txt'] })
    expect(result.subject).toBe('fix: a')
    expect(git(t.wt, 'status', '--porcelain')).toBe('M b.txt')
    expect(t.deps.refreshChanges).toHaveBeenCalled()
  })

  it('commits both sides of an unstaged rename when only the new path is chosen', async () => {
    const t = setup()
    git(t.wt, 'mv', 'a.txt', 'moved.txt')
    git(t.wt, 'reset', '-q') // unstaged: a deletion plus an untracked file
    t.setLatest({ worktreeId: 'w1', files: [{ path: 'moved.txt', oldPath: 'a.txt', kind: 'renamed', additions: 0, deletions: 0, uncommitted: true }], truncated: false, additions: 0, deletions: 0, computedAt: 1 })
    await t.ops.commit({ worktreeId: 'w1', message: 'move', paths: ['moved.txt'] })
    expect(git(t.wt, 'status', '--porcelain')).toBe('')
  })

  it('Create PR without gh pushes the branch and opens the GitHub page', async () => {
    const t = setup()
    const origin = makeTempDir('ops-origin')
    git(origin, 'init', '--bare', '-b', 'main')
    git(t.repo, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git')
    git(t.repo, 'config', `url.${origin}.pushInsteadOf`, 'https://github.com/acme/shop.git')
    appendFileSync(path.join(t.wt, 'a.txt'), 'x\n')
    await t.ops.commit({ worktreeId: 'w1', message: 'fix', paths: ['a.txt'] })
    const result = await t.ops.createPr('w1', {})
    expect(result).toEqual({ url: 'https://github.com/acme/shop/compare/main...fix-login?expand=1', created: false })
    expect(t.opened).toEqual([result.url])
    expect(git(origin, 'rev-parse', 'refs/heads/fix-login')).toBe(git(t.wt, 'rev-parse', 'HEAD'))
  })

  it('Create PR with gh passes the default title and body', async () => {
    const calls: string[][] = []
    const t = setup({ ghReady: async () => true, gh: async (args) => { calls.push([...args]); return { code: 0, stdout: 'https://github.com/acme/shop/pull/9\n', stderr: '' } } })
    const origin = makeTempDir('ops-origin-gh')
    git(origin, 'init', '--bare', '-b', 'main')
    git(t.repo, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git')
    git(t.repo, 'config', `url.${origin}.pushInsteadOf`, 'git@github.com:acme/shop.git')
    appendFileSync(path.join(t.wt, 'a.txt'), 'x\n')
    await t.ops.commit({ worktreeId: 'w1', message: 'first', paths: ['a.txt'] })
    appendFileSync(path.join(t.wt, 'b.txt'), 'y\n')
    await t.ops.commit({ worktreeId: 'w1', message: 'second', paths: ['b.txt'] })
    expect(await t.ops.createPr('w1', {})).toEqual({ url: 'https://github.com/acme/shop/pull/9', created: true })
    expect(calls[0]).toEqual(['pr', 'create', '--base', 'main', '--head', 'fix-login', '--title', 'second', '--body', '- second\n- first'])
    expect(t.opened).toEqual([])
  })

  it('Create PR refuses without a remote or on an unknown host', async () => {
    const t = setup()
    await expect(t.ops.createPr('w1', {})).rejects.toThrow('no remote')
    git(t.repo, 'remote', 'add', 'origin', 'https://example.com/a/b.git')
    await expect(t.ops.createPr('w1', {})).rejects.toThrow('GitHub, GitLab and Bitbucket')
  })

  it('merges into the base, and refuses for the repository folder', async () => {
    const t = setup()
    appendFileSync(path.join(t.wt, 'a.txt'), 'x\n')
    await t.ops.commit({ worktreeId: 'w1', message: 'x', paths: ['a.txt'] })
    expect((await t.ops.merge('w1')).merged).toBe(true)
    const main = setup({}, true)
    await expect(main.ops.merge('w1')).rejects.toThrow('repository folder itself')
  })

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

describe('codeGitValidation (D60)', () => {
  it('accepts a commit input and drops duplicate paths', () => {
    expect(asCommitInput({ worktreeId: 'w1', message: 'm', paths: ['a', 'a', 'b'] })).toEqual({ worktreeId: 'w1', message: 'm', paths: ['a', 'b'] })
  })

  it('refuses bad commit inputs', () => {
    expect(() => asCommitInput({ worktreeId: 'w1', message: 'm', paths: [] })).toThrow()
    expect(() => asCommitInput({ worktreeId: 'w1', message: 'm', paths: ['a\0b'] })).toThrow()
    expect(() => asCommitInput({ worktreeId: 'w1', message: 3, paths: ['a'] })).toThrow()
    expect(() => asCommitInput({ worktreeId: 'w1', message: 'm', paths: ['a'], amend: true })).toThrow('unknown key')
  })

  it('pull request input and remove options', () => {
    expect(asPullRequestInput(undefined)).toEqual({})
    expect(asPullRequestInput({ title: 't' })).toEqual({ title: 't' })
    expect(() => asPullRequestInput({ draft: true })).toThrow('unknown key')
    expect(asWorktreeRemoveOptions(undefined)).toEqual({})
    expect(asWorktreeRemoveOptions({ deleteFromDisk: true, discardChanges: false })).toEqual({ deleteFromDisk: true, discardChanges: false })
    expect(() => asWorktreeRemoveOptions({ deleteFromDisk: 'yes' })).toThrow()
  })
})
