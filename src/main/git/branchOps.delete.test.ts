// D60: commit, branch status, push, merge and delete-from-disk against real temp repositories.
// A bare repository in the temp folder is the "origin"; nothing reaches the network.
import { existsSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commitPaths } from './commit'
import { GitError, runGit, type GitRun } from './gitRunner'
import { addWorktree, cleanupTempDirs, git, makeRepo } from './testRepo'
import { deleteWorktreeFromDisk, readRemovalFacts } from './worktreeDelete'

afterAll(() => cleanupTempDirs())

/** runGit with a fixed identity/** runGit with a fixed identity, so commits work on a PC without user.name/user.email. */
const run: GitRun = (args, options) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], options)
const noSleep = async (): Promise<void> => undefined

describe('deleteWorktreeFromDisk', () => {
  it('removes the folder and a merged branch', async () => {
    const { repo } = makeRepo('del-merged')
    const wt = addWorktree(repo, 'done')
    const target = { repoPath: repo, path: wt.dir, branch: 'done', baseBranch: 'main' }
    expect(await readRemovalFacts(target, run)).toEqual({ uncommitted: 0, branchMerged: true, folderExists: true })
    const result = await deleteWorktreeFromDisk(target, { discardChanges: false, deleteUnmergedBranch: false }, { run, sleep: noSleep })
    expect(result).toEqual({ folderDeleted: true, branchDeleted: true })
    expect(existsSync(wt.dir)).toBe(false)
    expect(git(repo, 'branch', '--list', 'done')).toBe('')
  })

  it('keeps an unmerged branch unless told, and refuses uncommitted files unless told', async () => {
    const { repo } = makeRepo('del-unmerged')
    const wt = addWorktree(repo, 'wip')
    const target = { repoPath: repo, path: wt.dir, branch: 'wip', baseBranch: 'main' }
    appendFileSync(path.join(wt.dir, 'a.txt'), 'work\n')
    await commitPaths({ worktreePath: wt.dir, message: 'work', paths: ['a.txt'] }, run)
    appendFileSync(path.join(wt.dir, 'b.txt'), 'unsaved\n')
    expect(await readRemovalFacts(target, run)).toEqual({ uncommitted: 1, branchMerged: false, folderExists: true })
    await expect(deleteWorktreeFromDisk(target, { discardChanges: false, deleteUnmergedBranch: false }, { run, sleep: noSleep })).rejects.toThrow('1 uncommitted file')
    expect(existsSync(wt.dir)).toBe(true)
    const kept = await deleteWorktreeFromDisk(target, { discardChanges: true, deleteUnmergedBranch: false }, { run, sleep: noSleep })
    expect(kept.folderDeleted).toBe(true)
    expect(kept.branchDeleted).toBe(false)
    expect(kept.note).toContain('has commits main does not have')
    expect(git(repo, 'branch', '--list', 'wip')).toContain('wip')
  })

  it('removes the empty folder git left behind when a process still held it (Windows)', async () => {
    const { repo } = makeRepo('del-held')
    const wt = addWorktree(repo, 'held')
    let first = true
    // Real removal, but the folder "could not be deleted": git unregistered it and left it empty.
    const heldRun: GitRun = async (args, options) => {
      if (first && args[0] === 'worktree' && args[1] === 'remove') {
        first = false
        await run(args, options)
        mkdirSync(wt.dir)
        throw new GitError(`error: failed to delete '${wt.dir}': Permission denied`)
      }
      return run(args, options)
    }
    const result = await deleteWorktreeFromDisk({ repoPath: repo, path: wt.dir, branch: 'held', baseBranch: 'main' }, { discardChanges: false, deleteUnmergedBranch: false }, { run: heldRun, sleep: noSleep })
    expect(result).toEqual({ folderDeleted: true, branchDeleted: true })
    expect(existsSync(wt.dir)).toBe(false)
  })

  it('never removes a leftover folder that still has files', async () => {
    const { repo } = makeRepo('del-files')
    const wt = addWorktree(repo, 'files')
    const keepRun: GitRun = async (args, options) => {
      if (args[0] === 'worktree' && args[1] === 'remove') {
        await run(['worktree', 'remove', '--force', wt.dir], options).catch(() => undefined)
        mkdirSync(wt.dir, { recursive: true })
        writeFileSync(path.join(wt.dir, 'keep.txt'), 'mine\n')
        throw new GitError(`fatal: '${wt.dir}' is not a working tree`)
      }
      return run(args, options)
    }
    await expect(deleteWorktreeFromDisk({ repoPath: repo, path: wt.dir, branch: 'files', baseBranch: 'main' }, { discardChanges: false, deleteUnmergedBranch: false }, { run: keepRun, sleep: noSleep })).rejects.toThrow('not a working tree')
    expect(existsSync(path.join(wt.dir, 'keep.txt'))).toBe(true)
  })

  it('deletes an unmerged branch when told', async () => {
    const { repo } = makeRepo('del-force')
    const wt = addWorktree(repo, 'drop')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'work\n')
    await commitPaths({ worktreePath: wt.dir, message: 'work', paths: ['a.txt'] }, run)
    const result = await deleteWorktreeFromDisk({ repoPath: repo, path: wt.dir, branch: 'drop', baseBranch: 'main' }, { discardChanges: false, deleteUnmergedBranch: true }, { run, sleep: noSleep })
    expect(result).toEqual({ folderDeleted: true, branchDeleted: true })
  })
})

