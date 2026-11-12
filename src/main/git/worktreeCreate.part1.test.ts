import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTempDirs, git, makeRepo, makeTempDir } from './testRepo'
import { createGitWorktree, defaultWorktreesRoot } from './worktreeCreate'
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
})
