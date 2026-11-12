import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WORKTREE_NAME_MAX } from '../../shared/types'
import { cleanupTempDirs, git, makeRepo, makeTempDir } from './testRepo'
import { createGitWorktree } from './worktreeCreate'

describe('createGitWorktree', () => {
  let repo = ''

  beforeAll(() => {
    ;({ repo } = makeRepo('create'))
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  it('turns a name with slashes into a branch with slashes and a dash folder', async () => {
    const root = makeTempDir('slash')
    const created = await createGitWorktree({
      repoPath: repo,
      repoName: 'repo',
      root,
      name: 'feat/New  API',
      baseBranch: 'main'
    })
    expect(created.branch).toBe('feat/new-api')
    expect(path.basename(created.path)).toBe('feat-new-api')
    expect(realpathSync.native(created.path)).toBe(created.path)
  })

  // A real git on Windows cannot create the branch "con" ("cannot lock ref ... con.lock: Invalid argument").
  it('creates a worktree named after a Windows reserved device name', async () => {
    const root = makeTempDir('reserved')
    const created = await createGitWorktree({ repoPath: repo, repoName: 'nul', root, name: 'CON', baseBranch: 'main' })
    expect(created.branch).toBe('con-wt')
    expect(created.path).toBe(path.join(root, 'nul-wt', 'con-wt'))
    expect(existsSync(path.join(created.path, 'README.md'))).toBe(true)
    expect(git(repo, 'branch', '--list', 'con-wt')).toContain('con-wt')
  })

  it('rejects an empty name before touching git', async () => {
    const root = makeTempDir('empty')
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: '   ', baseBranch: 'main' })
    ).rejects.toThrow(`Worktree name must be 1 to ${WORKTREE_NAME_MAX} characters`)
  })

  it('rejects a name that has no letter or digit', async () => {
    const root = makeTempDir('symbols')
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: '!!!', baseBranch: 'main' })
    ).rejects.toThrow('Name must contain a letter or digit')
  })

  it('surfaces the git error when the branch cannot be created', async () => {
    // "conflict" exists as a branch, so "conflict/x" cannot be created (directory/file conflict in refs).
    git(repo, 'branch', 'conflict')
    const root = makeTempDir('conflict')
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'conflict/x', baseBranch: 'main' })
    ).rejects.toThrow(/^fatal: /)
  })
})
