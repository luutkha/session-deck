// Grid-view state hook (D32). The reducer is pure (exported for tests); the hook persists the grid
// per mode (storageKey) and keeps the overflow of a shrunken preset in MEMORY only.
import { useCallback, useEffect, useReducer } from 'react'
import type { Id } from '../../shared/types'
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'
import {
  GRID_STORAGE_KEY,
  assignOverflow,
  collectOverflow,
  normalizeGrid,
  parseGrid,
  presetLayout,
  serializeGrid,
  setCell,
  type GridPreset
} from './gridLogic'

export interface GridState {
  readonly layout: ReturnType<typeof presetLayout>
  readonly openIds: readonly Id[]
  readonly activeId: Id | null
  /** Ids that no longer fit after a preset shrink; in memory only, restored when a bigger preset fits them. */
  readonly overflow: readonly Id[]
}

export type GridAction =
  | { readonly type: 'sync'; readonly openIds: readonly Id[]; readonly activeId: Id | null }
  | { readonly type: 'setPreset'; readonly preset: GridPreset }
  | { readonly type: 'setCell'; readonly index: number; readonly id: Id | null }
  | { readonly type: 'focusCell'; readonly index: number }

export function initGridState(
  openIds: readonly Id[],
  activeId: Id | null,
  layout: ReturnType<typeof presetLayout>
): GridState {
  return {
    layout: normalizeGrid(layout, openIds),
    openIds,
    activeId,
    overflow: []
  }
}

export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case 'sync': {
      const layout = normalizeGrid(state.layout, action.openIds)
      // normalizeGrid returns the SAME object when no cell changed: skip the state churn (and the
      // localStorage write effect that watches state.layout).
      if (layout === state.layout && action.openIds === state.openIds && action.activeId === state.activeId) {
        return state
      }
      return {
        ...state,
        layout,
        openIds: action.openIds,
        activeId: action.activeId
      }
    }
    case 'setPreset': {
      if (action.preset === state.layout.preset) return state
      // Shrinking keeps the ids that no longer fit in the overflow; growing restores them first.
      // Only sessions that are still open may wait there — a closed one must never come back (D-c).
      const open = new Set<Id>(state.openIds)
      const overflow = [...state.overflow, ...collectOverflow(state.layout.cells, action.preset)].filter(
        (id): boolean => open.has(id)
      )
      const restored = assignOverflow({ preset: action.preset, cells: state.layout.cells }, overflow)
      return { ...state, layout: restored.layout, overflow: restored.overflow }
    }
    case 'setCell': {
      const next = setCell(state.layout, action.index, action.id)
      if (next === state.layout) return state
      return { ...state, layout: next, activeId: action.id ?? state.activeId }
    }
    case 'focusCell': {
      const id = state.layout.cells[action.index] ?? null
      if (id === state.activeId) return state
      return { ...state, activeId: id }
    }
  }
}

function loadGrid(storageKey: string): GridState['layout'] {
  return parseGrid(readStorageItem(storageKey)) ?? presetLayout('1x1')
}

export interface GridLayoutApi {
  readonly layout: GridState['layout']
  readonly activeId: Id | null
  readonly openIds: readonly Id[]
  readonly setPreset: (preset: GridPreset) => void
  readonly setCell: (index: number, id: Id | null) => void
  readonly clearCell: (index: number) => void
  readonly focusCell: (index: number) => void
}

/** storageKey: where the grid is remembered (Code mode uses its own key, D31/D-f). */
export function useGridLayout(
  openIds: readonly Id[],
  activeId: Id | null,
  storageKey: string = GRID_STORAGE_KEY
): GridLayoutApi {
  const [state, dispatch] = useReducer(
    gridReducer,
    undefined,
    (): GridState => initGridState(openIds, activeId, loadGrid(storageKey))
  )

  useEffect((): void => {
    writeStorageItem(storageKey, serializeGrid(state.layout))
  }, [state.layout, storageKey])

  useEffect((): void => {
    dispatch({ type: 'sync', openIds, activeId })
  }, [openIds, activeId])

  const setPreset = useCallback((preset: GridPreset): void => {
    dispatch({ type: 'setPreset', preset })
  }, [])
  const setCellAction = useCallback((index: number, id: Id | null): void => {
    dispatch({ type: 'setCell', index, id })
  }, [])
  const clearCell = useCallback((index: number): void => {
    dispatch({ type: 'setCell', index, id: null })
  }, [])
  const focusCell = useCallback((index: number): void => {
    dispatch({ type: 'focusCell', index })
  }, [])

  return {
    layout: state.layout,
    activeId: state.activeId,
    openIds: state.openIds,
    setPreset,
    setCell: setCellAction,
    clearCell,
    focusCell
  }
}
