// D60: pure rules of the Changes panel's git actions: which files Commit can take, and when Commit, Push, Create PR
// and Merge are available (with the reason shown when they are not). No React, no IPC.
import type { BranchStatus, ChangedFile, WorktreeChanges } from '../../../shared/types'

export interface ActionState {
  readonly enabled: boolean
  /** Why it is off (tooltip), or what it will do when on. */
  readonly hint: string
}

/** Files Commit can take: the listed files that still differ from HEAD. */
export function commitCandidates(changes: WorktreeChanges | null): readonly ChangedFile[] {
  return changes?.files.filter((file): boolean => file.uncommitted === true) ?? []
}

/**
 * The chosen files: every candidate except the ones the user unticked. Keeping the unticked set (not the ticked one)
 * means a file that appears after a turn is ticked by default, like the rest.
 */
export function chosenPaths(changes: WorktreeChanges | null, unticked: ReadonlySet<string>): readonly string[] {
  return commitCandidates(changes).map((file): string => file.path).filter((path): boolean => !unticked.has(path))
}

/** Drops unticked paths that are no longer candidates (committed or gone), so the set never grows without end. */
export function pruneUnticked(changes: WorktreeChanges | null, unticked: ReadonlySet<string>): ReadonlySet<string> {
  const live = new Set(commitCandidates(changes).map((file): string => file.path))
  const next = new Set([...unticked].filter((path): boolean => live.has(path)))
  return next.size === unticked.size ? unticked : next
}

export function commitState(message: string, chosen: number, busy: boolean): ActionState {
  if (busy) return { enabled: false, hint: 'Working…' }
  if (chosen === 0) return { enabled: false, hint: 'Tick the files to commit.' }
  if (message.trim().length === 0) return { enabled: false, hint: 'Write a commit message.' }
  return { enabled: true, hint: `Commit ${chosen} file${chosen === 1 ? '' : 's'} (Ctrl+Enter)` }
}

export function pushState(status: BranchStatus | null, busy: boolean): ActionState {
  if (busy) return { enabled: false, hint: 'Working…' }
  if (status === null) return { enabled: false, hint: 'Reading the branch…' }
  if (status.error !== undefined) return { enabled: false, hint: status.error }
  if (status.branch === null) return { enabled: false, hint: 'Not on a branch (detached HEAD).' }
  if (status.remote === null) return { enabled: false, hint: 'This repository has no remote.' }
  if (status.ahead === 0) return { enabled: false, hint: status.upstream === null ? 'No commits to push yet.' : `Up to date with ${status.upstream}.` }
  return { enabled: true, hint: `Push ${status.ahead} commit${status.ahead === 1 ? '' : 's'} to ${status.remote}` }
}

/** Pull fetches first, so it is offered whenever there is a branch and a remote (the "behind" count may be stale). */
export function pullState(status: BranchStatus | null, busy: boolean): ActionState {
  if (busy) return { enabled: false, hint: 'Working…' }
  if (status === null) return { enabled: false, hint: 'Reading the branch…' }
  if (status.error !== undefined) return { enabled: false, hint: status.error }
  if (status.branch === null) return { enabled: false, hint: 'Not on a branch (detached HEAD).' }
  if (status.remote === null) return { enabled: false, hint: 'This repository has no remote.' }
  return { enabled: true, hint: `Fetch ${status.remote}, then fast-forward${status.behind > 0 ? ` (${status.behind} behind as of the last fetch)` : ''}` }
}

export function pullRequestState(status: BranchStatus | null, busy: boolean): ActionState {
  if (busy) return { enabled: false, hint: 'Working…' }
  if (status === null) return { enabled: false, hint: 'Reading the branch…' }
  if (status.error !== undefined) return { enabled: false, hint: status.error }
  if (status.branch === null || status.branch === status.baseBranch) return { enabled: false, hint: 'A pull request needs its own branch.' }
  if (status.remote === null) return { enabled: false, hint: 'This repository has no remote.' }
  if (status.compareUrl === null) return { enabled: false, hint: 'Only GitHub, GitLab and Bitbucket remotes are known.' }
  if (status.upstream === null && status.ahead === 0) return { enabled: false, hint: 'Commit something first.' }
  const pushes = status.upstream === null || status.ahead > 0
  const action = status.ghReady ? 'creates the pull request with the GitHub CLI.' : 'opens the pull request page in your browser.'
  return { enabled: true, hint: pushes ? `Pushes, then ${action}` : action.charAt(0).toUpperCase() + action.slice(1) }
}

/** Merge into base: never for the repository folder (null = hide the button). */
export function mergeState(status: BranchStatus | null, busy: boolean): ActionState | null {
  if (status === null) return { enabled: false, hint: 'Reading the branch…' }
  if (status.repoFolder) return null
  if (busy) return { enabled: false, hint: 'Working…' }
  if (status.error !== undefined) return { enabled: false, hint: status.error }
  if (status.branch === null) return { enabled: false, hint: 'Not on a branch (detached HEAD).' }
  if (status.uncommitted > 0) return { enabled: false, hint: 'Commit the changes first; a merge only takes commits.' }
  return { enabled: true, hint: `Merge ${status.branch} into ${status.baseBranch} in the repository folder.` }
}

/** "↑2 ↓1" style counts (empty when there is nothing to show). */
export function aheadBehindLabel(status: BranchStatus | null): string {
  if (status === null || status.error !== undefined) return ''
  const parts: string[] = []
  if (status.ahead > 0) parts.push(`↑${status.ahead}`)
  if (status.behind > 0) parts.push(`↓${status.behind}`)
  return parts.join(' ')
}
