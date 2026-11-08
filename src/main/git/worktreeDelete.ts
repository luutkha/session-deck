// D60: what deleting a worktree from disk would lose, and deleting it (git worktree remove + git branch -d/-D).
// Never for the repository's own folder. Windows keeps a folder locked until the processes that ran in it exit,
// so the folder removal is retried for a few seconds after the sessions were stopped.
import { readdir, rmdir } from 'node:fs/promises'
import type { WorktreeRemoveResult } from '../../shared/types'
import { readUncommittedPaths } from './commit'
import { isDirectory } from './fsCheck'
import { GIT_FATAL_EXIT_CODE, GitError, type GitRun, runGit } from './gitRunner'

export const DELETE_ATTEMPTS = 8
export const DELETE_RETRY_MS = 750

export interface WorktreeOnDisk {
  readonly repoPath: string
  readonly path: string
  readonly branch: string
  readonly baseBranch: string
}

export interface RemovalFacts {
  readonly uncommitted: number
  readonly branchMerged: boolean
  readonly folderExists: boolean
}

/** Uncommitted files (0 when the folder is gone) and whether the branch's commits are all in the base. */
export async function readRemovalFacts(wt: WorktreeOnDisk, run: GitRun = runGit): Promise<RemovalFacts> {
  const folderExists = await isDirectory(wt.path)
  const uncommitted = folderExists ? (await readUncommittedPaths(wt.path, run).catch(() => new Set<string>())).size : 0
  const ancestor = await run(['merge-base', '--is-ancestor', `refs/heads/${wt.branch}`, `refs/heads/${wt.baseBranch}`], {
    cwd: wt.repoPath,
    okCodes: [0, 1, GIT_FATAL_EXIT_CODE]
  })
  // 128 = a branch is gone: nothing left to lose on the worktree branch.
  return { uncommitted, branchMerged: ancestor.code !== 1, folderExists }
}

export interface DeleteOptions {
  readonly discardChanges: boolean
  readonly deleteUnmergedBranch: boolean
}

export interface DeleteDeps {
  readonly run?: GitRun
  readonly sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function removeFolder(wt: WorktreeOnDisk, force: boolean, run: GitRun, sleep: (ms: number) => Promise<void>): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt += 1) {
    try {
      await run(['worktree', 'remove', ...(force ? ['--force'] : []), wt.path], { cwd: wt.repoPath })
      return
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      // Refusals that waiting cannot fix: dirty tree without force, not a worktree.
      if (/contains modified or untracked files|is not a working tree|is a main working tree/i.test(message)) break
      await sleep(DELETE_RETRY_MS)
    }
  }
  // Windows: git removed the files and unregistered the worktree, but the folder itself was still held by a session
  // process that was exiting, so the retry says "is not a working tree". An EMPTY leftover folder is removed here
  // (never one with files in it).
  await removeEmptyFolder(wt.path, sleep)
  // A folder that is gone only needs git to forget it.
  if (!(await isDirectory(wt.path))) {
    await run(['worktree', 'prune'], { cwd: wt.repoPath, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
    return
  }
  throw lastError instanceof Error ? lastError : new GitError(String(lastError))
}

async function removeEmptyFolder(folder: string, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt += 1) {
    if (!(await isDirectory(folder))) return
    if ((await readdir(folder)).length > 0) return
    try {
      await rmdir(folder)
      return
    } catch {
      await sleep(DELETE_RETRY_MS)
    }
  }
}

/** Removes the folder, then the branch. Folder failures throw; a branch that stays is reported in `note`. */
export async function deleteWorktreeFromDisk(wt: WorktreeOnDisk, options: DeleteOptions, deps: DeleteDeps = {}): Promise<WorktreeRemoveResult> {
  const run = deps.run ?? runGit
  const facts = await readRemovalFacts(wt, run)
  if (facts.uncommitted > 0 && !options.discardChanges) {
    throw new GitError(`The worktree has ${facts.uncommitted} uncommitted file(s); they would be lost. Nothing was deleted.`)
  }
  await removeFolder(wt, options.discardChanges, run, deps.sleep ?? defaultSleep)
  const branchExists = await run(['show-ref', '--verify', '--quiet', `refs/heads/${wt.branch}`], { cwd: wt.repoPath, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
  if (branchExists.code !== 0) return { folderDeleted: true, branchDeleted: false }
  if (!facts.branchMerged && !options.deleteUnmergedBranch) {
    return { folderDeleted: true, branchDeleted: false, note: `The branch ${wt.branch} has commits ${wt.baseBranch} does not have, so it was kept.` }
  }
  const result = await run(['branch', facts.branchMerged ? '-d' : '-D', wt.branch], { cwd: wt.repoPath, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
  if (result.code !== 0) {
    const reason = result.stderr.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? 'git branch failed'
    return { folderDeleted: true, branchDeleted: false, note: `The branch ${wt.branch} was kept: ${reason}` }
  }
  return { folderDeleted: true, branchDeleted: true }
}
