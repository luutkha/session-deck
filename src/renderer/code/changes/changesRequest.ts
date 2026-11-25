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

// G9: stepping through the changed files and switching the panel's layout use the same wait-until-mounted pattern as
// the file request above. Each request has its own slot, so a step and a layout change do not overwrite each other.

/** G9: move the selection in the Changes panel of one worktree. */
export interface ChangesStepRequest {
  readonly worktreeId: Id
  /** 1 = next file, -1 = previous file. */
  readonly delta: 1 | -1
}

let pendingStep: ChangesStepRequest | null = null
const stepListeners = new Set<() => void>()

export function requestChangesStep(worktreeId: Id, delta: 1 | -1): void {
  pendingStep = { worktreeId, delta }
  for (const listener of [...stepListeners]) listener()
}

/** The pending step of this worktree, removed from the queue; null when there is none. */
export function takeChangesStepRequest(worktreeId: Id): 1 | -1 | null {
  if (pendingStep === null || pendingStep.worktreeId !== worktreeId) return null
  const delta = pendingStep.delta
  pendingStep = null
  return delta
}

export function subscribeChangesStepRequest(listener: () => void): () => void {
  stepListeners.add(listener)
  return (): void => {
    stepListeners.delete(listener)
  }
}

/** G9: which parts of the Changes panel Jarvis wants switched (only the given fields change). */
export interface ChangesLayoutRequest {
  readonly worktreeId: Id
  readonly tree?: boolean
  readonly sideBySide?: boolean
}

let pendingLayout: ChangesLayoutRequest | null = null
const layoutListeners = new Set<() => void>()

export function requestChangesLayout(worktreeId: Id, options: { readonly tree?: boolean; readonly sideBySide?: boolean }): void {
  pendingLayout = {
    worktreeId,
    ...(options.tree !== undefined ? { tree: options.tree } : {}),
    ...(options.sideBySide !== undefined ? { sideBySide: options.sideBySide } : {})
  }
  for (const listener of [...layoutListeners]) listener()
}

/** The pending layout change of this worktree, removed from the queue; null when there is none. */
export function takeChangesLayoutRequest(worktreeId: Id): ChangesLayoutRequest | null {
  if (pendingLayout === null || pendingLayout.worktreeId !== worktreeId) return null
  const taken = pendingLayout
  pendingLayout = null
  return taken
}

export function subscribeChangesLayoutRequest(listener: () => void): () => void {
  layoutListeners.add(listener)
  return (): void => {
    layoutListeners.delete(listener)
  }
}
