// React hook over the one-file diff IPC. Replies for an overtaken request or another file are dropped.
import { useEffect, useState } from 'react'
import type { FileDiff, Id } from '../../../shared/types'
import { createRequestGate, loadFileDiff, type RequestGate } from './changesLoad'
import {
  INITIAL_DIFF_VIEW,
  beginDiffLoad,
  diffForKey,
  diffKey,
  finishDiffLoad,
  type DiffViewState
} from './changesState'

export interface WorktreeFileDiffResult {
  readonly diff: FileDiff | null
  readonly loading: boolean
  readonly error: string | null
}

const NO_FILE: WorktreeFileDiffResult = { diff: null, loading: false, error: null }

/**
 * The diff of the selected file. `stamp` is the computedAt of the changes list it was picked from:
 * when a fresher list arrives, the same file is loaded again.
 */
export function useWorktreeFileDiff(
  worktreeId: Id,
  path: string | null,
  stamp: number | null
): WorktreeFileDiffResult {
  const [state, setState] = useState<DiffViewState>(INITIAL_DIFF_VIEW)
  const [gate] = useState<RequestGate>(createRequestGate)

  useEffect((): (() => void) | undefined => {
    if (path === null) return undefined
    const file: string = path
    const key = diffKey(worktreeId, file)
    const ticket = gate.begin()
    setState((previous: DiffViewState): DiffViewState => beginDiffLoad(previous, key))
    void loadFileDiff(worktreeId, file, (target: Id, filePath: string) =>
      window.api.getWorktreeFileDiff(target, filePath)
    ).then((result): void => {
      if (!gate.isCurrent(ticket)) return
      setState((previous: DiffViewState): DiffViewState => finishDiffLoad(previous, key, result))
    })
    return (): void => gate.cancel()
  }, [worktreeId, path, stamp, gate])

  if (path === null) return NO_FILE
  return diffForKey(state, diffKey(worktreeId, path))
}
