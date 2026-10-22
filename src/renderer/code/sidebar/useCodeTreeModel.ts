import { useEffect, useMemo, useState } from 'react'
import type { Id, RuntimeState, StoreData, WorktreeChanges } from '../../../shared/types'
import { useWorktreeChangeCounts } from '../changes'
import { RELATIVE_TIME_INTERVAL_MS } from '../../Sidebar/sidebarPrefs'
import { useLastRuntimeChange } from '../../Sidebar/useLastRuntimeChange'
import {
  buildCodeTree,
  filterCodeTree,
  isSearching,
  visibleSessionIds,
  visibleWorktreeIds,
  type CodeTree
} from './codeTree'

export interface CodeTreeModelInput {
  readonly data: StoreData
  readonly searchValue: string
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly runtimeLastChange?: ReadonlyMap<Id, number>
}

export interface CodeTreeModel {
  /** Every repo, worktree and closed session (no search applied). */
  readonly tree: CodeTree
  /** The tree after the search filter: what the sidebar shows. */
  readonly shown: CodeTree
  readonly searching: boolean
  /** Session ids in on-screen order, for keyboard navigation. */
  readonly flatIds: readonly Id[]
  readonly changeCounts: ReadonlyMap<Id, WorktreeChanges>
  readonly lastChange: ReadonlyMap<Id, number>
  /** Ticks every RELATIVE_TIME_INTERVAL_MS so "3m ago" labels stay current. */
  readonly now: number
}

function useRelativeNow(): number {
  const [now, setNow] = useState<number>(Date.now)
  useEffect((): (() => void) => {
    const interval = window.setInterval((): void => setNow(Date.now()), RELATIVE_TIME_INTERVAL_MS)
    return (): void => window.clearInterval(interval)
  }, [])
  return now
}

/** Derived sidebar data: the tree, its search result, keyboard order, change counts and time labels. */
export function useCodeTreeModel(input: CodeTreeModelInput): CodeTreeModel {
  const { data, searchValue, runtime } = input
  const internalLastChange = useLastRuntimeChange(runtime)
  const lastChange = input.runtimeLastChange ?? internalLastChange
  const now = useRelativeNow()
  const tree = useMemo((): CodeTree => buildCodeTree(data), [data])
  const searching = isSearching(searchValue)
  const shown = useMemo((): CodeTree => filterCodeTree(tree, searchValue), [tree, searchValue])
  const shownWorktreeIds = useMemo((): readonly Id[] => visibleWorktreeIds(shown), [shown])
  const changeCounts = useWorktreeChangeCounts(shownWorktreeIds)
  const flatIds = useMemo((): readonly Id[] => visibleSessionIds(shown, searching), [shown, searching])
  return { tree, shown, searching, flatIds, changeCounts, lastChange, now }
}
