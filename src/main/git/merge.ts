// D60: merge a worktree's branch into its base branch, in the repository's own folder (git merge --no-ff).
// Guarded: the repository folder must have the base branch checked out and no uncommitted tracked changes, and the
// worktree must have committed everything. A conflict is undone at once (git merge --abort) and reported with its files.
import type { MergeResult } from '../../shared/types'
import { readUncommittedPaths } from './commit'
import { GIT_FATAL_EXIT_CODE, GitError, type GitRun, runGit } from './gitRunner'

export const MERGE_TIMEOUT_MS = 120_000

export interface MergeInput {
  readonly repoPath: string
  readonly worktreePath: string
  readonly branch: string
  readonly baseBranch: string
}

async function headBranch(run: GitRun, cwd: string): Promise<string | null> {
  const result = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
  return result.code === 0 ? result.stdout.trim() : null
}

export async function mergeIntoBase(input: MergeInput, run: GitRun = runGit): Promise<MergeResult> {
  const { repoPath, worktreePath, branch, baseBranch } = input
  if (branch === baseBranch) throw new GitError(`The worktree is on ${baseBranch} itself; there is nothing to merge.`)
  const pending = (await readUncommittedPaths(worktreePath, run)).size
  if (pending > 0) throw new GitError(`The worktree has ${pending} uncommitted file(s). Commit them (or discard them) first; a merge only takes commits.`)
  const repoBranch = await headBranch(run, repoPath)
  if (repoBranch !== baseBranch) {
    throw new GitError(`The repository folder is on ${repoBranch ?? 'a detached HEAD'}, not ${baseBranch}. Check out ${baseBranch} there first.`)
  }
  const dirty = await run(['status', '--porcelain', '--untracked-files=no'], { cwd: repoPath })
  if (dirty.stdout.trim().length > 0) {
    throw new GitError(`The repository folder has uncommitted changes on ${baseBranch}. Commit or stash them first.`)
  }
  const ahead = await run(['rev-list', '--count', `${baseBranch}..${branch}`], { cwd: repoPath })
  if (Number.parseInt(ahead.stdout.trim(), 10) === 0) {
    return { merged: false, message: `Already up to date: ${baseBranch} has every commit of ${branch}.` }
  }
  const result = await run(['merge', '--no-ff', '--no-edit', branch], { cwd: repoPath, timeoutMs: MERGE_TIMEOUT_MS, okCodes: [0, 1] })
  if (result.code === 0) return { merged: true, message: `Merged ${branch} into ${baseBranch}.` }
  const conflicted = await run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: repoPath, okCodes: [0, 1] })
  const conflicts = conflicted.stdout.split('\0').filter((p) => p.length > 0)
  await run(['merge', '--abort'], { cwd: repoPath, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
  if (conflicts.length === 0) {
    const reason = (result.stderr + '\n' + result.stdout).split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0)
    throw new GitError(`The merge stopped: ${reason ?? 'git merge failed'}. Nothing was changed.`)
  }
  return {
    merged: false,
    message: `${branch} conflicts with ${baseBranch} in ${conflicts.length} file(s). The merge was undone; nothing changed. Resolve it in the session (merge ${baseBranch} into the branch), then try again.`,
    conflicts
  }
}
