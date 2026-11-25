// React hooks over the worktree changes IPC. The logic lives in changesLoad.ts / changesState.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangedFile, Id, WorktreeChanges } from '../../../shared/types'
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
import { publishChanges } from './changeSummaryStore'

const SECOND_MS = 1000
export const DEFAULT_POLL_MS = 10 * SECOND_MS

/**
 * A key of the changing CONTENT of a list, not of when it was computed. Main recomputes on every poll and on many
 * unrelated events; effects that need git work must not run again when the same files come back with a new computedAt.
 * Order-insensitive: a file list is a set of rows, and main sorts it by path before sending it anyway.
 */
export function changesContentKey(changes: WorktreeChanges | null): string {
  if (changes === null) return ''
  const files = changes.files.map((file: ChangedFile): string => JSON.stringify([
    file.path,
    file.kind,
    file.oldPath ?? '',
    file.additions,
    file.deletions,
    file.uncommitted === true
  ])).sort()
  return JSON.stringify({ files, truncated: changes.truncated, error: changes.error ?? null })
}

/** True when a push for this worktree already refreshed the data during the last poll interval. */
export function shouldSkipPoll(now: number, lastPushAt: number | null, pollMs: number): boolean {
  if (lastPushAt === null) return false
  const age = now - lastPushAt
  return age >= 0 && age < pollMs
}

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
  const lastPushAt = useRef<number | null>(null)
  // D87: the next load may take the main-side cache only when the interval poll asked for it; mount, a worktree switch,
  // a manual refresh and a window becoming visible always read fresh.
  const allowCachedNext = useRef(false)
  const refresh = useCallback((): void => {
    allowCachedNext.current = false
    setTick((count: number): number => count + 1)
  }, [])
  const pollRefresh = useCallback((): void => {
    allowCachedNext.current = true
    setTick((count: number): number => count + 1)
  }, [])

  useEffect((): (() => void) | undefined => {
    if (worktreeId === null) return undefined
    const id: Id = worktreeId
    const ticket = gate.begin()
    setState((previous: ChangesViewState): ChangesViewState => beginChangesLoad(previous, id))
    const allowCached = allowCachedNext.current
    allowCachedNext.current = false
    void loadChanges(id, (target: Id) => window.api.getWorktreeChanges(target, allowCached ? { allowCached: true } : undefined).then((fresh: WorktreeChanges): WorktreeChanges => {
        publishChanges(fresh)
        return fresh
      })).then((result): void => {
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
        publishChanges(changes)
        if (changes.worktreeId !== id) return
        // A push already refreshed this worktree: the next poll tick would just repeat the same read.
        lastPushAt.current = Date.now()
        // A pushed snapshot is newer than any reply still in flight.
        gate.cancel()
        setState((previous: ChangesViewState): ChangesViewState => applyPushedChanges(previous, changes))
      })
    )
  }, [worktreeId, gate])

  useEffect((): (() => void) | undefined => {
    if (worktreeId === null) return undefined
    const pollIfVisible = (): void => {
      if (!isVisibleState(document.visibilityState)) return
      if (shouldSkipPoll(Date.now(), lastPushAt.current, pollMs)) {
        lastPushAt.current = null
        return
      }
      pollRefresh()
    }
    const refreshWhenShown = (): void => {
      if (isVisibleState(document.visibilityState)) refresh()
    }
    const timer = window.setInterval(pollIfVisible, pollMs)
    document.addEventListener('visibilitychange', refreshWhenShown)
    return (): void => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenShown)
    }
  }, [worktreeId, pollMs, refresh, pollRefresh])

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
        publishChanges(changes)
        if (!live || !wanted.has(changes.worktreeId)) return
        setCounts((previous: ReadonlyMap<Id, WorktreeChanges>) => putCount(previous, changes))
      })
    )
    const loadAll = (): void => {
      for (const id of ids) {
        void loadChanges(id, (target: Id) => window.api.getWorktreeChanges(target, { allowCached: true }).then((fresh: WorktreeChanges): WorktreeChanges => {
        publishChanges(fresh)
        return fresh
      })).then((result): void => {
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
