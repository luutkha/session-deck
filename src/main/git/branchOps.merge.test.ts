// D60: commit, branch status, push, merge and delete-from-disk against real temp repositories.
// A bare repository in the temp folder is the "origin"; nothing reaches the network.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commitPaths } from './commit'
import { runGit, type GitRun } from './gitRunner'
import { mergeIntoBase } from './merge'
import { addWorktree, cleanupTempDirs, git, makeRepo, writeText } from './testRepo'

afterAll(() => cleanupTempDirs())

/** runGit with a fixed identity/** runGit with a fixed identity, so commits work on a PC without user.name/user.email. */
const run: GitRun = (args, options) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], options)

describe('mergeIntoBase', () => {
  it('merges committed work into the base in the repository folder', async () => {
    const { repo } = makeRepo('merge-ok')
    const wt = addWorktree(repo, 'feat-m')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'feature\n')
    await commitPaths({ worktreePath: wt.dir, message: 'feature', paths: ['a.txt'] }, run)
    const result = await mergeIntoBase({ repoPath: repo, worktreePath: wt.dir, branch: 'feat-m', baseBranch: 'main' }, run)
    expect(result).toEqual({ merged: true, message: 'Merged feat-m into main.' })
    expect(git(repo, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2) // a merge commit (--no-ff)
    const again = await mergeIntoBase({ repoPath: repo, worktreePath: wt.dir, branch: 'feat-m', baseBranch: 'main' }, run)
    expect(again.merged).toBe(false)
    expect(again.message).toContain('Already up to date')
  })

  it('refuses uncommitted work, a dirty repo folder and a repo folder on another branch', async () => {
    const { repo } = makeRepo('merge-guards')
    const wt = addWorktree(repo, 'feat-g')
    const input = { repoPath: repo, worktreePath: wt.dir, branch: 'feat-g', baseBranch: 'main' }
    appendFileSync(path.join(wt.dir, 'a.txt'), 'x\n')
    await expect(mergeIntoBase(input, run)).rejects.toThrow('1 uncommitted file')
    await commitPaths({ worktreePath: wt.dir, message: 'x', paths: ['a.txt'] }, run)
    appendFileSync(path.join(repo, 'b.txt'), 'dirty\n')
    await expect(mergeIntoBase(input, run)).rejects.toThrow('repository folder has uncommitted changes')
    git(repo, 'checkout', '-q', '--', 'b.txt')
    git(repo, 'checkout', '-q', '-b', 'other')
    await expect(mergeIntoBase(input, run)).rejects.toThrow('is on other, not main')
  })

  it('undoes a conflicting merge and lists the files', async () => {
    const { repo } = makeRepo('merge-conflict')
    const wt = addWorktree(repo, 'feat-c')
    writeText(path.join(wt.dir, 'a.txt'), 'theirs\n')
    await commitPaths({ worktreePath: wt.dir, message: 'theirs', paths: ['a.txt'] }, run)
    writeText(path.join(repo, 'a.txt'), 'ours\n')
    git(repo, 'commit', '-qam', 'ours')
    const before = git(repo, 'rev-parse', 'HEAD')
    const result = await mergeIntoBase({ repoPath: repo, worktreePath: wt.dir, branch: 'feat-c', baseBranch: 'main' }, run)
    expect(result.merged).toBe(false)
    expect(result.conflicts).toEqual(['a.txt'])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})

