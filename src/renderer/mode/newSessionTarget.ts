// Which "new" dialog a mode opens. Ops: the New session dialog. Code: a new session in the active worktree,
// or a new worktree when there is none. Pure: no React, no IPC.
import type { Id, Session, Worktree } from '../../shared/types'

export type NewDialog =
  | { readonly kind: 'ops'; readonly groupId: Id | null; readonly statusId: Id | null; readonly folder?: string }
  | { readonly kind: 'worktree'; readonly repoId?: Id }
  | { readonly kind: 'worktree-session'; readonly worktree: Worktree }

export function opsNewDialog(groupId: Id | null = null, statusId: Id | null = null, folder?: string): NewDialog {
  return folder === undefined ? { kind: 'ops', groupId, statusId } : { kind: 'ops', groupId, statusId, folder }
}

/** "New session" in Code mode: the active session's worktree, or a new worktree when there is none. */
export function codeNewDialog(activeSession: Session | null, worktrees: readonly Worktree[]): NewDialog {
  const worktreeId = activeSession?.worktreeId
  const worktree = worktreeId === undefined ? undefined : worktrees.find((item: Worktree): boolean => item.id === worktreeId)
  return worktree === undefined ? { kind: 'worktree' } : { kind: 'worktree-session', worktree }
}

/** A worktree's "New session" button. Null when the worktree is not in the store (it was removed). */
export function worktreeSessionDialog(worktreeId: Id, worktrees: readonly Worktree[]): NewDialog | null {
  const worktree = worktrees.find((item: Worktree): boolean => item.id === worktreeId)
  return worktree === undefined ? null : { kind: 'worktree-session', worktree }
}
