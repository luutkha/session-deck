// D61: the session sort of one mode (persisted per mode) and the hover freeze for live sorts.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Id, RuntimeState, Session } from '../../shared/types'
import type { UiMode } from '../../shared/types'
import { storageKeyFor } from '../mode/modeLogic'
import { DEFAULT_SESSION_SORT, isLiveSort, parseSessionSort, sortPositions, type SessionSort } from './sessionSort'

export const SESSION_SORT_STORAGE_KEY = 'sessiondeck.sort.v1'

function readSort(mode: UiMode): SessionSort {
  try {
    return parseSessionSort(window.localStorage.getItem(storageKeyFor(SESSION_SORT_STORAGE_KEY, mode)))
  } catch {
    return DEFAULT_SESSION_SORT
  }
}

/** The sort of one mode; Ops and Code each remember their own (D61). */
export function useSessionSort(mode: UiMode): readonly [SessionSort, (sort: SessionSort) => void] {
  const [sort, setSort] = useState<SessionSort>((): SessionSort => readSort(mode))
  useEffect((): void => {
    try {
      window.localStorage.setItem(storageKeyFor(SESSION_SORT_STORAGE_KEY, mode), sort)
    } catch {
      // localStorage may be unavailable; the sort then lasts for this run only.
    }
  }, [mode, sort])
  return [sort, setSort] as const
}

export interface SortFreeze {
  /** Pass to `sortSessions`; undefined while the order may change. */
  readonly frozen: ReadonlyMap<Id, number> | undefined
  readonly onPointerEnter: () => void
  readonly onPointerLeave: () => void
}

/**
 * While the pointer is over a list with a live sort ("Needs attention", "Last active"), the order is pinned to what
 * it was when the pointer came in, so a card never jumps under a click; it re-sorts when the pointer leaves.
 */
export function useSortFreeze(
  sessions: readonly Session[],
  sort: SessionSort,
  runtime: ReadonlyMap<Id, RuntimeState>
): SortFreeze {
  const latest = useRef({ sessions, sort, runtime })
  latest.current = { sessions, sort, runtime }
  const [frozen, setFrozen] = useState<ReadonlyMap<Id, number> | undefined>(undefined)
  const onPointerEnter = useCallback((): void => {
    const { sessions: all, sort: current, runtime: states } = latest.current
    setFrozen(isLiveSort(current) ? sortPositions(all, current, states) : undefined)
  }, [])
  const onPointerLeave = useCallback((): void => setFrozen(undefined), [])
  // A new sort choice (made from the header menu, under the pointer) applies at once.
  useEffect((): void => setFrozen(undefined), [sort])
  return { frozen: isLiveSort(sort) ? frozen : undefined, onPointerEnter, onPointerLeave }
}
