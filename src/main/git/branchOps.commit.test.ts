// D60: commit, branch status, push, merge and delete-from-disk against real temp repositories.
// A bare repository in the temp folder is the "origin"; nothing reaches the network.
import { appendFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commitPaths, parseStatusZ, readUncommittedPaths, withIndexLock } from './commit'
import { GitError, runGit, type GitRun } from './gitRunner'
import { addWorktree, cleanupTempDirs, git, makeRepo, writeText } from './testRepo'

afterAll(() => cleanupTempDirs())

/** runGit with a fixed identity/** runGit with a fixed identity, so commits work on a PC without user.name/user.email. */
const run: GitRun = (args, options) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], options)

describe('parseStatusZ', () => {
  it('reads staged, unstaged, untracked and both sides of a rename', () => {
    const out = ['M  a.txt', ' M b.txt', '?? new file.txt', 'R  moved.txt', 'old.txt', ' D gone.txt', ''].join('\0')
    expect([...parseStatusZ(out)].sort()).toEqual(['a.txt', 'b.txt', 'gone.txt', 'moved.txt', 'new file.txt', 'old.txt'])
  })

  it('is empty for a clean tree', () => {
    expect(parseStatusZ('').size).toBe(0)
  })
})

describe('commitPaths', () => {
  it('commits only the chosen files and leaves the others uncommitted', async () => {
    const { repo } = makeRepo('commit-some')
    const wt = addWorktree(repo, 'feat-a')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    appendFileSync(path.join(wt.dir, 'b.txt'), 'more\n')
    writeText(path.join(wt.dir, 'docs', 'new [1].md'), 'hello\n')
    unlinkSync(path.join(wt.dir, 'gone.txt'))
    const result = await commitPaths({ worktreePath: wt.dir, message: 'feat: a and docs\n\nbody', paths: ['a.txt', 'docs/new [1].md', 'gone.txt'] }, run)
    expect(result.subject).toBe('feat: a and docs')
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(result.files).toBe(3)
    expect([...(await readUncommittedPaths(wt.dir))]).toEqual(['b.txt'])
    expect(git(wt.dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['a.txt', 'docs/new [1].md', 'gone.txt'])
  })

  it('refuses an empty message, no files and a path that has nothing to commit', async () => {
    const { repo } = makeRepo('commit-refuse')
    const wt = addWorktree(repo, 'feat-b')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    await expect(commitPaths({ worktreePath: wt.dir, message: '   ', paths: ['a.txt'] }, run)).rejects.toThrow('Write a commit message')
    await expect(commitPaths({ worktreePath: wt.dir, message: 'x', paths: [] }, run)).rejects.toThrow('at least one file')
    await expect(commitPaths({ worktreePath: wt.dir, message: 'x', paths: ['c.txt'] }, run)).rejects.toThrow('Nothing to commit for c.txt')
  })

  it('waits for an index.lock another git holds for a moment (D60 race with background status)', async () => {
    const { repo } = makeRepo('commit-lock')
    const wt = addWorktree(repo, 'feat-lock')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    const lock = path.resolve(wt.dir, git(wt.dir, 'rev-parse', '--git-path', 'index.lock'))
    writeFileSync(lock, '')
    setTimeout(() => rmSync(lock, { force: true }), 900)
    const result = await commitPaths({ worktreePath: wt.dir, message: 'after the lock', paths: ['a.txt'] }, run)
    expect(result.subject).toBe('after the lock')
  })

  it('gives up on a lock that stays', async () => {
    let calls = 0
    const busy = async (): Promise<never> => { calls += 1; throw new GitError("fatal: Unable to create 'C:/r/.git/index.lock': File exists.") }
    await expect(withIndexLock(busy, async () => undefined)).rejects.toThrow('index.lock')
    expect(calls).toBe(6)
    await expect(withIndexLock(async () => { throw new GitError('fatal: other') }, async () => undefined)).rejects.toThrow('other')
  })

  it('explains a missing git identity in plain words', async () => {
    const { repo } = makeRepo('commit-ident')
    const wt = addWorktree(repo, 'feat-c')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    const noIdentity: GitRun = async (args, options) => {
      if (args.includes('commit')) throw new GitError('fatal: unable to auto-detect email address (got \'t@PC.(none)\')')
      return run(args, options)
    }
    await expect(commitPaths({ worktreePath: wt.dir, message: 'x', paths: ['a.txt'] }, noIdentity)).rejects.toThrow('Git does not know who you are')
  })
})

