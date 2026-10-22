import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  branchExists,
  listBranches,
  resolveCommit,
  resolveRepoRoot
} from './repoInfo'
import { addWorktree, cleanupTempDirs, git, makeRepo, makeTempDir } from './testRepo'

const SHA_PATTERN = /^[0-9a-f]{40}$/

describe('resolveRepoRoot', () => {
  let repo = ''
  let subfolder = ''

  beforeAll(() => {
    ;({ repo } = makeRepo('root'))
    subfolder = path.join(repo, 'deep', 'inner')
    mkdirSync(subfolder, { recursive: true })
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  it('returns the top-level folder when given the repository root', async () => {
    expect(await resolveRepoRoot(repo)).toBe(repo)
  })

  it('returns the top-level folder when given a subfolder', async () => {
    expect(await resolveRepoRoot(subfolder)).toBe(repo)
  })

  it('rejects a linked worktree folder and asks for the main repository', async () => {
    const { dir } = addWorktree(repo, 'root-check')
    await expect(resolveRepoRoot(dir)).rejects.toThrow(
      'This folder is a git worktree. Add its main repository instead.'
    )
  })

  it('rejects a folder that is not inside a git repository', async () => {
    const plain = makeTempDir('plain')
    await expect(resolveRepoRoot(plain)).rejects.toThrow(`Not a git repository: ${plain}`)
  })

  it('rejects a folder that does not exist', async () => {
    const missing = path.join(makeTempDir('gone'), 'missing')
    await expect(resolveRepoRoot(missing)).rejects.toThrow(`Folder not found: ${missing}`)
  })

  it('rejects a path that is a file, not a folder', async () => {
    const filePath = path.join(repo, 'README.md')
    await expect(resolveRepoRoot(filePath)).rejects.toThrow(`Folder not found: ${filePath}`)
  })

  it('rejects a bare repository', async () => {
    const bare = makeTempDir('bare')
    git(bare, 'init', '--bare', '-b', 'main')
    await expect(resolveRepoRoot(bare)).rejects.toThrow('Bare repositories are not supported.')
  })
})

describe('listBranches', () => {
  let repo = ''

  beforeAll(() => {
    ;({ repo } = makeRepo('branches'))
    git(repo, 'branch', 'feature/a')
    git(repo, 'branch', 'b-branch')
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  it('lists local branches sorted and names the checked-out branch', async () => {
    const result = await listBranches(repo)
    expect(result.branches).toEqual(['b-branch', 'feature/a', 'main'])
    expect(result.current).toBe('main')
  })

  it('reports current as null when HEAD is detached', async () => {
    git(repo, 'checkout', '--detach')
    try {
      const result = await listBranches(repo)
      expect(result.current).toBeNull()
      expect(result.branches).toContain('main')
    } finally {
      git(repo, 'checkout', 'main')
    }
  })
})

describe('branchExists', () => {
  let repo = ''

  beforeAll(() => {
    ;({ repo } = makeRepo('exists'))
    git(repo, 'branch', 'topic')
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  it('returns true for an existing local branch', async () => {
    expect(await branchExists(repo, 'topic')).toBe(true)
  })

  it('returns false for a missing branch', async () => {
    expect(await branchExists(repo, 'nope')).toBe(false)
  })

  it('does not treat a tag with the same name as a branch', async () => {
    git(repo, 'tag', 'only-tag')
    expect(await branchExists(repo, 'only-tag')).toBe(false)
  })
})

describe('resolveCommit', () => {
  let repo = ''
  let mainSha = ''

  beforeAll(() => {
    ;({ repo, mainSha } = makeRepo('commit'))
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  it('returns the full 40-character sha of a branch', async () => {
    const sha = await resolveCommit(repo, 'main')
    expect(sha).toMatch(SHA_PATTERN)
    expect(sha).toBe(mainSha)
  })

  it('resolves HEAD', async () => {
    expect(await resolveCommit(repo, 'HEAD')).toBe(mainSha)
  })

  it('rejects an unknown revision', async () => {
    await expect(resolveCommit(repo, 'no-such-ref')).rejects.toThrow('Unknown revision: no-such-ref')
  })

  it('rejects a revision that looks like a git option', async () => {
    await expect(resolveCommit(repo, '--all')).rejects.toThrow('Unknown revision: --all')
  })
})
