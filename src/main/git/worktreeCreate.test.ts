import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WORKTREE_NAME_MAX } from '../../shared/types'
import { cleanupTempDirs, git, makeRepo, makeTempDir } from './testRepo'
import { createGitWorktree, defaultWorktreesRoot, nameCandidate } from './worktreeCreate'
import { listBranches } from './repoInfo'

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

  it('gives a second worktree with the same name the next free name, branch and folder (D57, like Orca)', async () => {
    const root = makeTempDir('dup')
    const first = await createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'Dup Name', baseBranch: 'main' })
    const second = await createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'dup name', baseBranch: 'main' })
    const third = await createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'Dup Name', baseBranch: 'main' })
    expect(first.branch).toBe('dup-name')
    expect([second.name, second.branch, path.basename(second.path)]).toEqual(['dup name-2', 'dup-name-2', 'dup-name-2'])
    expect(third.branch).toBe('dup-name-3')
    expect(existsSync(path.join(third.path, 'README.md'))).toBe(true)
  })

  it('skips a name whose branch exists even when its folder is free', async () => {
    git(repo, 'branch', 'only-branch')
    const root = makeTempDir('branchonly')
    const created = await createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'only branch', baseBranch: 'main' })
    expect(created.branch).toBe('only-branch-2')
  })

  it('checks out an existing branch in a new worktree, with changes against the base (D57)', async () => {
    git(repo, 'branch', 'feature-x')
    const root = makeTempDir('existing')
    const created = await createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'Feature X', baseBranch: 'main', existingBranch: 'feature-x' })
    expect(created.branch).toBe('feature-x')
    expect(git(created.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature-x')
    expect(created.baseCommit).toBe(mainSha)
    expect((await listBranches(repo)).checkedOut?.some((c) => c.branch === 'feature-x' && c.path === created.path)).toBe(true)
  })

  it('refuses a branch that is already open in another worktree, naming where', async () => {
    const root = makeTempDir('busy')
    const open = await createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'busy one', baseBranch: 'main' })
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'again', baseBranch: 'main', existingBranch: 'busy-one' })
    ).rejects.toThrow(`Branch "busy-one" is already open in ${open.path}`)
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'main again', baseBranch: 'main', existingBranch: 'main' })
    ).rejects.toThrow('Branch "main" is already open in')
    await expect(
      createGitWorktree({ repoPath: repo, repoName: 'repo', root, name: 'ghost', baseBranch: 'main', existingBranch: 'no-such' })
    ).rejects.toThrow('Branch not found: no-such')
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
    ).rejects.toThrow('No free name for this worktree: "Full Folder" up to "Full Folder-99" are taken.')
  })

  it('keeps a suffixed name within the name limit', () => {
    expect(nameCandidate('abc', 1)).toBe('abc')
    expect(nameCandidate('abc', 2)).toBe('abc-2')
    const long = 'x'.repeat(WORKTREE_NAME_MAX)
    expect(nameCandidate(long, 12)).toHaveLength(WORKTREE_NAME_MAX)
    expect(nameCandidate(long, 12).endsWith('-12')).toBe(true)
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
