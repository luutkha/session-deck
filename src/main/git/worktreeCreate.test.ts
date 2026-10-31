import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WORKTREE_NAME_MAX } from '../../shared/types'
import { cleanupTempDirs, git, makeRepo, makeTempDir } from './testRepo'
import { createGitWorktree, defaultWorktreesRoot } from './worktreeCreate'

const SHA_PATTERN = /^[0-9a-f]{40}$/

describe('defaultWorktreesRoot', () => {
  it('puts worktrees under <home>/SessionDeck/worktrees', () => {
    expect(defaultWorktreesRoot(path.join('C:', 'Users', 'me'))).toBe(
      path.join('C:', 'Users', 'me', 'SessionDeck', 'worktrees')
    )
  })
})

describe('createGitWorktree', () => {
  let repo = ''
  let mainSha = ''

  beforeAll(() => {
    ;({ repo, mainSha } = makeRepo('create'))
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  it('creates the folder and the branch, and reports the base commit', async () => {
    const root = makeTempDir('roots')
    const created = await createGitWorktree({
      repoPath: repo,
      repoName: 'My Repo',
      root,
      name: 'Fix Login',
      baseBranch: 'main'
    })

    expect(created.branch).toBe('fix-login')
    expect(created.path).toBe(path.join(root, 'my-repo', 'fix-login'))
    expect(existsSync(path.join(created.path, 'README.md'))).toBe(true)
    expect(git(repo, 'branch', '--list', 'fix-login')).toContain('fix-login')
    expect(created.baseCommit).toMatch(SHA_PATTERN)
    expect(created.baseCommit).toBe(mainSha)
  })

  it('points the new branch at the commit of the base branch', async () => {
    git(repo, 'branch', 'release-1')
    const root = makeTempDir('pointer')
    const created = await createGitWorktree({
      repoPath: repo,
      repoName: 'repo',
      root,
      name: 'Pointer',
      baseBranch: 'release-1'
    })
    expect(git(repo, 'rev-parse', created.branch)).toBe(git(repo, 'rev-parse', 'release-1'))
  })

  it('rejects a second worktree whose name maps to an existing branch', async () => {
    const root = makeTempDir('dup')
    await createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'Dup Name', baseBranch: 'main' })
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'dup name', baseBranch: 'main' })
    ).rejects.toThrow('A branch named "dup-name" already exists in this repository.')
  })

  it('adds a -2 suffix when the folder is already taken', async () => {
    const root = makeTempDir('taken')
    mkdirSync(path.join(root, 'repo', 'taken-folder'), { recursive: true })
    const created = await createGitWorktree({
      repoPath: repo,
      repoName: 'repo',
      root,
      name: 'Taken Folder',
      baseBranch: 'main'
    })
    expect(created.path).toBe(path.join(root, 'repo', 'taken-folder-2'))
    expect(existsSync(path.join(created.path, 'README.md'))).toBe(true)
  })

  it('rejects when every suffix up to -99 is taken', async () => {
    const root = makeTempDir('full')
    const base = path.join(root, 'repo', 'full-folder')
    mkdirSync(base, { recursive: true })
    for (let suffix = 2; suffix <= 99; suffix++) {
      mkdirSync(`${base}-${suffix}`)
    }
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'Full Folder', baseBranch: 'main' })
    ).rejects.toThrow('No free folder name for this worktree.')
  })

  it('rejects when the base branch does not exist', async () => {
    const root = makeTempDir('nobase')
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'Orphan', baseBranch: 'nope' })
    ).rejects.toThrow('Base branch not found: nope')
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
