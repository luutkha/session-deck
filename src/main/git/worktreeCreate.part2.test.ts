import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WORKTREE_NAME_MAX } from '../../shared/types'
import { cleanupTempDirs, makeRepo, makeTempDir } from './testRepo'
import { createGitWorktree, nameCandidate } from './worktreeCreate'

describe('createGitWorktree', () => {
  let repo = ''

  beforeAll(() => {
    ;({ repo } = makeRepo('create'))
  })

  afterAll(() => {
    cleanupTempDirs()
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
})
