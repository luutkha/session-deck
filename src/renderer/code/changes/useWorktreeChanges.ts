// React hooks over the worktree changes IPC. The logic lives in changesLoad.ts / changesState.ts.
import { useCallback, useEffect, useState } from 'react'
import type { Id, WorktreeChanges } from '../../../shared/types'
import {
  createRequestGate,
  isVisibleState,
  loadChanges,
  subscribeSafely,
  type RequestGate
} from './changesLoad'
import {
  INITIAL_CHANGES_VIEW,
  applyPushedChanges,
  beginChangesLoad,
  finishChangesLoad,
  idSetKey,
  idsFromKey,
  pruneCounts,
  putCount,
  viewFor,
  type ChangesViewState
} from './changesState'

const SECOND_MS = 1000
export const DEFAULT_POLL_MS = 10 * SECOND_MS

export interface UseWorktreeChangesOptions {
  /** Interval between refetches while the window is visible. */
  readonly pollMs?: number
}

export interface WorktreeChangesResult {
  readonly changes: WorktreeChanges | null
  readonly loading: boolean
  /** Short message when the IPC call itself failed; git problems come in changes.error instead. */
  readonly error: string | null
  readonly refresh: () => void
}

/**
 * The changes of one worktree. Fetches on mount and when the id changes, follows main's pushed
 * updates, and refetches every pollMs while the window is visible.
 */
export function useWorktreeChanges(
  worktreeId: Id | null,
  options?: UseWorktreeChangesOptions
): WorktreeChangesResult {
  const pollMs = options?.pollMs ?? DEFAULT_POLL_MS
  const [state, setState] = useState<ChangesViewState>(INITIAL_CHANGES_VIEW)
  const [gate] = useState<RequestGate>(createRequestGate)
  const [tick, setTick] = useState(0)
  const refresh = useCallback((): void => {
    setTick((count: number): number => count + 1)
  }, [])

  useEffect((): (() => void) | undefined => {
    if (worktreeId === null) return undefined
    const id: Id = worktreeId
    const ticket = gate.begin()
    setState((previous: ChangesViewState): ChangesViewState => beginChangesLoad(previous, id))
    void loadChanges(id, (target: Id) => window.api.getWorktreeChanges(target)).then((result): void => {
      if (!gate.isCurrent(ticket)) return
      setState((previous: ChangesViewState): ChangesViewState => finishChangesLoad(previous, id, result))
    })
    return (): void => gate.cancel()
  }, [worktreeId, tick, gate])

  useEffect((): (() => void) | undefined => {
    if (worktreeId === null) return undefined
    const id: Id = worktreeId
    return subscribeSafely((): (() => void) =>
      window.api.onWorktreeChanges((changes: WorktreeChanges): void => {
        if (changes.worktreeId !== id) return
        // A pushed snapshot is newer than any reply still in flight.
        gate.cancel()
        setState((previous: ChangesViewState): ChangesViewState => applyPushedChanges(previous, changes))
      })
    )
  }, [worktreeId, gate])

  useEffect((): (() => void) | undefined => {
    if (worktreeId === null) return undefined
    const refreshIfVisible = (): void => {
      if (isVisibleState(document.visibilityState)) refresh()
    }
    const timer = window.setInterval(refreshIfVisible, pollMs)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return (): void => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [worktreeId, pollMs, refresh])

  const shown = viewFor(state, worktreeId)
  return { changes: shown.changes, loading: shown.loading, error: shown.error, refresh }
}

/**
 * The changes of several worktrees, keyed by worktree id (for the sidebar counts). Fetches each id
 * once on mount and again when the set of ids changes; follows pushed updates; never polls.
 */
/** How often the sidebar counts are refreshed while the window is visible. */
export const COUNTS_POLL_MS = 30 * SECOND_MS

export function useWorktreeChangeCounts(worktreeIds: readonly Id[]): ReadonlyMap<Id, WorktreeChanges> {
  const key = idSetKey(worktreeIds)
  const [counts, setCounts] = useState<ReadonlyMap<Id, WorktreeChanges>>(() => new Map())

  useEffect((): (() => void) => {
    const ids: readonly Id[] = idsFromKey(key)
    const wanted = new Set(ids)
    let live = true
    setCounts((previous: ReadonlyMap<Id, WorktreeChanges>) => pruneCounts(previous, wanted))
    const stop = subscribeSafely((): (() => void) =>
      window.api.onWorktreeChanges((changes: WorktreeChanges): void => {
        if (!live || !wanted.has(changes.worktreeId)) return
        setCounts((previous: ReadonlyMap<Id, WorktreeChanges>) => putCount(previous, changes))
      })
    )
    const loadAll = (): void => {
      for (const id of ids) {
        void loadChanges(id, (target: Id) => window.api.getWorktreeChanges(target)).then((result): void => {
          if (!live || !result.ok) return
          setCounts((previous: ReadonlyMap<Id, WorktreeChanges>) => putCount(previous, result.value))
        })
      }
    }
    loadAll()
    // Shell sessions and edits made outside SessionDeck send no "turn ended" push: refresh now and then while visible.
    const timer = window.setInterval((): void => {
      if (document.visibilityState === 'visible') loadAll()
    }, COUNTS_POLL_MS)
    return (): void => {
      live = false
      window.clearInterval(timer)
      stop()
    }
  }, [key])

  return counts
}
