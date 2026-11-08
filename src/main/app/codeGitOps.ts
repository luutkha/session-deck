// D60: Code mode commit / push / pull request / merge / delete from disk. One implementation for the Changes panel
// (IPC) and Jarvis's tools; codeWiring owns the changes cache and hands in refresh/forget. All git work is in main/git.
import type {
  BranchStatus, CommitInput, CommitResult, Id, MergeResult, PullRequestInput, PullRequestResult, PushResult, Repo, Worktree,
  WorktreeChanges, WorktreeRemovalInfo, WorktreeRemoveOptions, WorktreeRemoveResult
} from '../../shared/types'
import type { SessionStore } from '../store'
import {
  commitPaths, createPullRequest, deleteWorktreeFromDisk, GitError, mergeIntoBase, pullRequestDefaults, pushBranch, readBranchStatus,
  readRemovalFacts, type GitRun, type GhRun
} from '../git'

export interface CodeGitOpsDeps {
  readonly store: SessionStore
  /** Stops and removes the worktree's sessions and forgets it (the same path as Remove in the sidebar). */
  readonly removeFromSessionDeck: (worktreeId: Id) => void
  /** Recomputes the worktree's changes now (and tells the windows); returns them. */
  readonly refreshChanges: (worktree: Worktree) => Promise<WorktreeChanges>
  /** The last computed changes, if any. */
  readonly latestChanges: (worktreeId: Id) => WorktreeChanges | undefined
  /** Opens a web page in the user's browser. */
  readonly openExternal: (url: string) => Promise<void>
  /** GitHub CLI installed and signed in (cached). */
  readonly ghReady: () => Promise<boolean>
  readonly run?: GitRun
  readonly gh?: GhRun
  readonly sleep?: (ms: number) => Promise<void>
}

export interface CodeGitOps {
  branchStatus(worktreeId: Id): Promise<BranchStatus>
  commit(input: CommitInput): Promise<CommitResult>
  push(worktreeId: Id): Promise<PushResult>
  createPr(worktreeId: Id, input: PullRequestInput): Promise<PullRequestResult>
  merge(worktreeId: Id): Promise<MergeResult>
  removalInfo(worktreeId: Id): Promise<WorktreeRemovalInfo>
  remove(worktreeId: Id, options: WorktreeRemoveOptions): Promise<WorktreeRemoveResult>
}

export function createCodeGitOps(deps: CodeGitOpsDeps): CodeGitOps {
  const { store } = deps

  function worktreeOrThrow(id: Id): Worktree {
    const worktree = store.getWorktree(id)
    if (worktree === undefined) throw new Error('Worktree not found')
    return worktree
  }

  function repoOf(worktree: Worktree): Repo {
    const repo = store.getRepo(worktree.repoId)
    if (repo === undefined) throw new Error('Repository not found')
    return repo
  }

  const refreshQuietly = (worktree: Worktree): void => {
    void deps.refreshChanges(worktree).catch(() => undefined)
  }

  function branchStatus(worktreeId: Id): Promise<BranchStatus> {
    return readBranchStatus(worktreeOrThrow(worktreeId), { ...(deps.run ? { run: deps.run } : {}), ghReady: deps.ghReady })
  }

  async function commit(input: CommitInput): Promise<CommitResult> {
    const worktree = worktreeOrThrow(input.worktreeId)
    // A rename commits both sides, so the old path is not left behind as an uncommitted deletion.
    const listed = deps.latestChanges(worktree.id)?.files ?? []
    const paths = new Set(input.paths)
    for (const file of listed) {
      if (paths.has(file.path) && file.oldPath !== undefined && file.uncommitted === true) paths.add(file.oldPath)
    }
    try {
      return await commitPaths({ worktreePath: worktree.path, message: input.message, paths: [...paths] }, deps.run)
    } catch (error) {
      // An expanded old path that git already has staged as part of the rename is fine to retry without.
      if (paths.size !== input.paths.length && error instanceof GitError && error.message.startsWith('Nothing to commit for')) {
        return await commitPaths({ worktreePath: worktree.path, message: input.message, paths: [...input.paths] }, deps.run)
      }
      throw error
    } finally {
      refreshQuietly(worktree)
    }
  }

  async function push(worktreeId: Id): Promise<PushResult> {
    return pushBranch(worktreeOrThrow(worktreeId), deps.run)
  }

  async function createPr(worktreeId: Id, input: PullRequestInput): Promise<PullRequestResult> {
    const worktree = worktreeOrThrow(worktreeId)
    const status = await branchStatus(worktreeId)
    if (status.error !== undefined) throw new Error(status.error)
    if (status.branch === null) throw new GitError('The worktree is not on a branch (detached HEAD).')
    if (status.branch === worktree.baseBranch) throw new GitError(`The worktree is on ${worktree.baseBranch} itself; a pull request needs its own branch.`)
    if (status.remote === null) throw new GitError('This repository has no remote, so there is nowhere to open a pull request.')
    if (status.compareUrl === null) throw new GitError('SessionDeck knows the pull request pages of GitHub, GitLab and Bitbucket only; open it on your host by hand.')
    // The PR page shows the branch as it is on the remote: push first when it was never pushed or has new commits.
    if (status.upstream === null || status.ahead > 0) await pushBranch(worktree, deps.run)
    if (status.ghReady) {
      const defaults = await pullRequestDefaults(worktree, deps.run)
      const title = (input.title ?? '').trim() || defaults.title || worktree.name
      const url = await createPullRequest({ cwd: worktree.path, base: worktree.baseBranch, branch: status.branch, title, body: input.body ?? defaults.body }, deps.gh)
      return { url, created: true }
    }
    await deps.openExternal(status.compareUrl)
    return { url: status.compareUrl, created: false }
  }

  async function merge(worktreeId: Id): Promise<MergeResult> {
    const worktree = worktreeOrThrow(worktreeId)
    if (worktree.main === true) throw new GitError('This is the repository folder itself; there is no branch to merge into it.')
    const status = await branchStatus(worktreeId)
    if (status.branch === null) throw new GitError('The worktree is not on a branch (detached HEAD).')
    const result = await mergeIntoBase({ repoPath: repoOf(worktree).path, worktreePath: worktree.path, branch: status.branch, baseBranch: worktree.baseBranch }, deps.run)
    refreshQuietly(worktree)
    return result
  }

  async function removalInfo(worktreeId: Id): Promise<WorktreeRemovalInfo> {
    const worktree = worktreeOrThrow(worktreeId)
    const base = { worktreeId, repoFolder: worktree.main === true, branch: worktree.branch, baseBranch: worktree.baseBranch, path: worktree.path }
    if (worktree.main === true) return { ...base, uncommitted: 0, branchMerged: true, folderExists: true }
    const facts = await readRemovalFacts({ repoPath: repoOf(worktree).path, path: worktree.path, branch: worktree.branch, baseBranch: worktree.baseBranch }, deps.run)
    return { ...base, ...facts }
  }

  async function remove(worktreeId: Id, options: WorktreeRemoveOptions): Promise<WorktreeRemoveResult> {
    const worktree = worktreeOrThrow(worktreeId)
    if (options.deleteFromDisk !== true) {
      deps.removeFromSessionDeck(worktreeId)
      return { folderDeleted: false, branchDeleted: false }
    }
    if (worktree.main === true) throw new GitError('The repository folder is never deleted from disk. Remove it from SessionDeck without deleting.')
    const target = { repoPath: repoOf(worktree).path, path: worktree.path, branch: worktree.branch, baseBranch: worktree.baseBranch }
    // Refuse before anything changes, so a refusal leaves the worktree and its sessions as they were.
    const facts = await readRemovalFacts(target, deps.run)
    if (facts.uncommitted > 0 && options.discardChanges !== true) {
      throw new GitError(`The worktree has ${facts.uncommitted} uncommitted file(s); they would be lost. Nothing was removed.`)
    }
    // Sessions first: their processes hold the folder open on Windows.
    deps.removeFromSessionDeck(worktreeId)
    try {
      return await deleteWorktreeFromDisk(target, { discardChanges: options.discardChanges === true, deleteUnmergedBranch: options.deleteUnmergedBranch === true }, {
        ...(deps.run ? { run: deps.run } : {}),
        ...(deps.sleep ? { sleep: deps.sleep } : {})
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { folderDeleted: false, branchDeleted: false, note: `The worktree was removed from SessionDeck, but its folder could not be deleted: ${reason}` }
    }
  }

  return { branchStatus, commit, push, createPr, merge, removalInfo, remove }
}
