// Load plumbing behind the Changes hooks: IPC calls that never reject, a request gate that drops
// overtaken replies, and the "keep the newest snapshot" rule. No React here.
import type { FileDiff, Id, WorktreeChanges } from '../../../shared/types'

export const CHANGES_LOAD_FAILED = 'Could not load changes.'
export const DIFF_LOAD_FAILED = 'Could not load this diff.'

const VISIBLE = 'visible'

export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

export type GetChanges = (worktreeId: Id) => Promise<WorktreeChanges>
export type GetFileDiff = (worktreeId: Id, path: string) => Promise<FileDiff>

/** Calls the IPC and never rejects: a failure is logged and returned as a short message. */
export async function loadChanges(worktreeId: Id, getChanges: GetChanges): Promise<LoadResult<WorktreeChanges>> {
  try {
    return { ok: true, value: await getChanges(worktreeId) }
  } catch (error: unknown) {
    console.error(`Could not load changes for worktree ${worktreeId}`, error)
    return { ok: false, error: CHANGES_LOAD_FAILED }
  }
}

/** Calls the IPC and never rejects: a rejected path (no longer changed) is logged and reported. */
export async function loadFileDiff(
  worktreeId: Id,
  path: string,
  getFileDiff: GetFileDiff
): Promise<LoadResult<FileDiff>> {
  try {
    return { ok: true, value: await getFileDiff(worktreeId, path) }
  } catch (error: unknown) {
    console.error(`Could not load the diff of ${path} in worktree ${worktreeId}`, error)
    return { ok: false, error: DIFF_LOAD_FAILED }
  }
}

export interface RequestGate {
  /** Starts a request and returns its ticket. */
  readonly begin: () => number
  /** True only for the newest ticket; replies from overtaken requests must be dropped. */
  readonly isCurrent: (ticket: number) => boolean
  /** Makes every outstanding request stale (unmount, id change, or a pushed update). */
  readonly cancel: () => void
}

export function createRequestGate(): RequestGate {
  let latest = 0
  return {
    begin: (): number => {
      latest += 1
      return latest
    },
    isCurrent: (ticket: number): boolean => ticket === latest,
    cancel: (): void => {
      latest += 1
    }
  }
}

/**
 * Of two snapshots of one worktree, the one computed later wins. A reply computed before a pushed
 * update therefore never overwrites the pushed one. With no current snapshot the incoming one wins.
 */
export function keepNewest(current: WorktreeChanges | null | undefined, incoming: WorktreeChanges): WorktreeChanges {
  if (current === null || current === undefined) {
    return incoming
  }
  return current.computedAt > incoming.computedAt ? current : incoming
}

/** Runs a subscribe call; if it throws, logs it and returns a no-op unsubscribe. */
export function subscribeSafely(subscribe: () => () => void): () => void {
  try {
    return subscribe()
  } catch (error: unknown) {
    console.error('Could not subscribe to worktree change updates', error)
    return (): void => undefined
  }
}

/** Polling only runs while the window is on screen. */
export function isVisibleState(visibilityState: string): boolean {
  return visibilityState === VISIBLE
}
