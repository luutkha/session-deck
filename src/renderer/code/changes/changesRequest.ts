// D58: Jarvis asks the Changes panel to show one file (its diff or its rendered preview), or the list again. The
// request waits here until the panel of that worktree is mounted (it may open in the same step), which takes it once.
import type { Id } from '../../../shared/types'

export interface ChangesFileRequest {
  readonly worktreeId: Id
  /** null = back to the list of changed files. */
  readonly path: string | null
  readonly view: 'diff' | 'preview'
}

let pending: ChangesFileRequest | null = null
const listeners = new Set<() => void>()

export function requestChangesFile(request: ChangesFileRequest): void {
  pending = request
  for (const listener of [...listeners]) listener()
}

/** The waiting request of this worktree, removed from the queue; null when there is none. */
export function takeChangesFileRequest(worktreeId: Id): ChangesFileRequest | null {
  if (pending === null || pending.worktreeId !== worktreeId) return null
  const taken = pending
  pending = null
  return taken
}

export function subscribeChangesFileRequest(listener: () => void): () => void {
  listeners.add(listener)
  return (): void => {
    listeners.delete(listener)
  }
}
