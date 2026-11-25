// React hook over the one-file diff IPC. Replies for an overtaken request or another file are dropped.
import { useEffect, useRef, useState } from 'react'
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
const FOCUS_REFRESH_GAP_MS = 250

/** focus and visibilitychange often both fire on a window regain; one diff reload is enough. */
export function shouldRefreshOnFocus(now: number, lastRefreshAt: number): boolean {
  return now - lastRefreshAt >= FOCUS_REFRESH_GAP_MS
}

/**
 * The diff of the selected file. `stamp` is the CONTENT key of the changes list it was picked from: a list with the
 * same files but a newer computedAt does not re-read the diff. A manual refresh (`refreshKey`) and regaining focus
 * do re-read it, since an edit that leaves the +/- counts unchanged is invisible to the content key.
 */
export function useWorktreeFileDiff(
  worktreeId: Id,
  path: string | null,
  stamp: string | null,
  refreshKey = 0
): WorktreeFileDiffResult {
  const [state, setState] = useState<DiffViewState>(INITIAL_DIFF_VIEW)
  const [gate] = useState<RequestGate>(createRequestGate)
  const [focusTick, setFocusTick] = useState(0)
  const lastFocusRefresh = useRef(0)

  useEffect((): (() => void) | undefined => {
    if (path === null) return undefined
    const refreshOnFocus = (): void => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (!shouldRefreshOnFocus(now, lastFocusRefresh.current)) return
      lastFocusRefresh.current = now
      setFocusTick((count: number): number => count + 1)
    }
    document.addEventListener('visibilitychange', refreshOnFocus)
    window.addEventListener('focus', refreshOnFocus)
    return (): void => {
      document.removeEventListener('visibilitychange', refreshOnFocus)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [path])

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
  }, [worktreeId, path, stamp, refreshKey, focusTick, gate])

  if (path === null) return NO_FILE
  return diffForKey(state, diffKey(worktreeId, path))
}
