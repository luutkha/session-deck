// D86: the latest changes of each worktree, shared by everything that shows a badge (sidebar row, session tab).
// The hooks that already fetch changes publish here; readers never fetch on their own, so a badge costs no git call.
import { useSyncExternalStore } from 'react'
import type { Id, WorktreeChanges } from '../../../shared/types'
import { readViewed, subscribeViewed, unviewedCount } from './viewedMarks'

const latest = new Map<Id, WorktreeChanges>()
const listeners = new Set<() => void>()

/** Remembers the newest snapshot of a worktree (older computedAt values are ignored) and wakes the badges. */
export function publishChanges(changes: WorktreeChanges): void {
  const known = latest.get(changes.worktreeId)
  if (known !== undefined && known.computedAt > changes.computedAt) return
  latest.set(changes.worktreeId, changes)
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const stopViewed = subscribeViewed(listener)
  return (): void => {
    listeners.delete(listener)
    stopViewed()
  }
}

export interface ChangeSummary {
  readonly total: number
  readonly unviewed: number
}

const NONE = ''

/** Snapshot as a string so useSyncExternalStore sees a stable value until something really changed. */
function summaryKey(worktreeId: Id | undefined): string {
  if (worktreeId === undefined) return NONE
  const changes = latest.get(worktreeId)
  if (changes === undefined || changes.error !== undefined) return NONE
  return `${String(changes.files.length)}/${String(unviewedCount(changes.files, readViewed(worktreeId)))}`
}

/** Files changed in a worktree and how many of them the user has not marked as viewed; null = unknown or none. */
export function useChangeSummary(worktreeId: Id | undefined): ChangeSummary | null {
  const key = useSyncExternalStore(
    subscribe,
    (): string => summaryKey(worktreeId),
    (): string => NONE
  )
  if (key === NONE) return null
  const [total, unviewed] = key.split('/').map(Number)
  return total === 0 ? null : { total: total ?? 0, unviewed: unviewed ?? 0 }
}
