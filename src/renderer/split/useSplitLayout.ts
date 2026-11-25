// Split-pane state hook. The reducer is pure (exported for tests); the hook
// only persists the layout and translates prop changes into actions.
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { Id } from '../../shared/types'
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'
import {
  MAX_PANES,
  SPLIT_STORAGE_KEY,
  equalize,
  isSplit,
  normalizeLayout,
  normalizeSizes,
  parseLayout,
  pickPartner,
  removePane,
  replacePane,
  resizeBetween,
  serializeLayout,
  singleLayout,
  splitWith,
  type SplitDirection,
  type SplitLayout
} from './splitLogic'

const RECENT_LIMIT = 20

/**
 * Write policy for the layout. A divider drag fires ~60 pointermoves a second: the live layout stays in
 * React state, but storage gets one write when the drag ends (same idea as useSidebarWidth's commit).
 * Dedupe on the last written value so a layout effect flushed after commit cannot write the value twice.
 */
export interface LayoutPersistence {
  /** Layout effect: writes immediately unless a drag is in progress. */
  readonly changed: (storageKey: string, value: string) => void
  /** Defer writes until commit (pointer drag). */
  readonly defer: () => void
  /** A non-drag resize (arrow key): writes flow again from the next change. */
  readonly resume: () => void
  /** End the drag with one write of the final layout; a no-op when no drag is pending. */
  readonly commit: (storageKey: string, value: string) => void
}

export function createLayoutPersistence(
  write: (storageKey: string, value: string) => void
): LayoutPersistence {
  let dragging = false
  let last: { readonly storageKey: string; readonly value: string } | null = null
  return {
    defer: (): void => {
      dragging = true
    },
    resume: (): void => {
      dragging = false
    },
    changed: (storageKey: string, value: string): void => {
      if (dragging || (last !== null && last.storageKey === storageKey && last.value === value)) return
      last = { storageKey, value }
      write(storageKey, value)
    },
    commit: (storageKey: string, value: string): void => {
      if (!dragging) return
      dragging = false
      last = { storageKey, value }
      write(storageKey, value)
    }
  }
}

/** Extra argument used by the divider; callers that omit it keep the old "write immediately" behaviour. */
export interface ResizeOptions {
  readonly commit?: boolean
}

export interface SplitState {
  readonly layout: SplitLayout
  readonly openIds: readonly Id[]
  readonly activeId: Id | null
  /** Most recently activated first. Used by pickPartner for "split with the other tab". */
  readonly recentIds: readonly Id[]
}

export type SplitAction =
  | { readonly type: 'sync'; readonly openIds: readonly Id[]; readonly activeId: Id | null }
  | { readonly type: 'split'; readonly direction: SplitDirection }
  | { readonly type: 'unsplit' }
  | { readonly type: 'openToSide'; readonly id: Id; readonly direction?: SplitDirection }
  | { readonly type: 'removePane'; readonly id: Id }
  | { readonly type: 'showInPane'; readonly id: Id }
  | { readonly type: 'setSizes'; readonly sizes: readonly number[] }
  | { readonly type: 'resize'; readonly dividerIndex: number; readonly delta: number }
  | { readonly type: 'equalize' }

function touchRecent(recentIds: readonly Id[], id: Id | null): readonly Id[] {
  if (id === null) {
    return recentIds
  }
  return [id, ...recentIds.filter((known: Id): boolean => known !== id)].slice(0, RECENT_LIMIT)
}

function withLayout(state: SplitState, layout: SplitLayout): SplitState {
  return layout === state.layout ? state : { ...state, layout }
}

function applySizes(layout: SplitLayout, sizes: readonly number[]): SplitLayout {
  if (sizes.length !== layout.paneIds.length) {
    return layout
  }
  return { ...layout, sizes: normalizeSizes(sizes, sizes.length) }
}

export function initSplitState(
  openIds: readonly Id[],
  activeId: Id | null,
  layout: SplitLayout
): SplitState {
  return {
    layout: normalizeLayout(layout, openIds, activeId),
    openIds,
    activeId,
    recentIds: activeId === null ? [] : [activeId]
  }
}

export function splitReducer(state: SplitState, action: SplitAction): SplitState {
  switch (action.type) {
    case 'sync': {
      const changed = action.activeId !== state.activeId
      const open = new Set<Id>(action.openIds)
      return {
        layout: normalizeLayout(state.layout, action.openIds, action.activeId),
        openIds: action.openIds,
        activeId: action.activeId,
        recentIds: (changed ? touchRecent(state.recentIds, action.activeId) : state.recentIds).filter(
          (id: Id): boolean => open.has(id)
        )
      }
    }
    case 'split': {
      const partner = pickPartner(state.openIds, state.activeId, state.recentIds)
      if (partner === null) {
        return state
      }
      return withLayout(state, splitWith(state.layout, state.activeId, partner, action.direction))
    }
    case 'unsplit':
      return withLayout(state, singleLayout(state.activeId))
    case 'openToSide': {
      if (!state.openIds.includes(action.id) || state.layout.paneIds.includes(action.id)) {
        return state
      }
      const fallback: SplitDirection = isSplit(state.layout) ? state.layout.direction : 'row'
      const direction = action.direction ?? fallback
      return withLayout(state, splitWith(state.layout, state.activeId, action.id, direction))
    }
    case 'removePane':
      return withLayout(
        state,
        normalizeLayout(removePane(state.layout, action.id), state.openIds, state.activeId)
      )
    case 'showInPane': {
      if (!state.openIds.includes(action.id)) {
        return state
      }
      if (state.layout.paneIds.includes(action.id)) {
        if (state.activeId === action.id) {
          return state
        }
        return { ...state, activeId: action.id, recentIds: touchRecent(state.recentIds, action.id) }
      }
      const base = state.activeId
      const next = isSplit(state.layout)
        ? replacePane(
            state.layout,
            base !== null && state.layout.paneIds.includes(base)
              ? base
              : (state.layout.paneIds[state.layout.paneIds.length - 1] ?? action.id),
            action.id
          )
        : singleLayout(action.id)
      return { ...state, layout: next, activeId: action.id, recentIds: touchRecent(state.recentIds, action.id) }
    }
    case 'setSizes':
      return withLayout(state, applySizes(state.layout, action.sizes))
    case 'resize':
      return withLayout(state, resizeBetween(state.layout, action.dividerIndex, action.delta))
    case 'equalize':
      return withLayout(state, equalize(state.layout))
  }
}

function loadLayout(activeId: Id | null, storageKey: string): SplitLayout {
  return parseLayout(readStorageItem(storageKey)) ?? singleLayout(activeId)
}

export interface SplitLayoutApi {
  readonly layout: SplitLayout
  readonly split: boolean
  readonly canSplit: boolean
  readonly splitRight: () => void
  readonly splitDown: () => void
  readonly unsplit: () => void
  readonly openToSide: (id: Id, direction?: SplitDirection) => void
  readonly removePane: (id: Id) => void
  readonly showInPane: (id: Id) => void
  readonly setSizes: (sizes: readonly number[]) => void
  readonly resize: (dividerIndex: number, delta: number, options?: ResizeOptions) => void
  /** Flush the deferred write when a pointer drag ends (also used on pagehide/beforeunload). */
  readonly commitLayout: () => void
  readonly equalize: () => void
}

/** storageKey: where the layout is remembered (Code mode uses its own key, D31). */
export function useSplitLayout(
  openIds: readonly Id[],
  activeId: Id | null,
  storageKey: string = SPLIT_STORAGE_KEY
): SplitLayoutApi {
  const [state, dispatch] = useReducer(
    splitReducer,
    undefined,
    (): SplitState => initSplitState(openIds, activeId, loadLayout(activeId, storageKey))
  )

  const writerRef = useRef<LayoutPersistence | null>(null)
  if (writerRef.current === null) writerRef.current = createLayoutPersistence(writeStorageItem)
  const writer = writerRef.current
  const liveRef = useRef<SplitLayout>(state.layout)
  liveRef.current = state.layout

  useEffect((): void => {
    writer.changed(storageKey, serializeLayout(state.layout))
  }, [writer, state.layout, storageKey])

  useEffect((): void => {
    dispatch({ type: 'sync', openIds, activeId })
  }, [openIds, activeId])

  const splitRight = useCallback((): void => {
    dispatch({ type: 'split', direction: 'row' })
  }, [])
  const splitDown = useCallback((): void => {
    dispatch({ type: 'split', direction: 'column' })
  }, [])
  const unsplit = useCallback((): void => {
    dispatch({ type: 'unsplit' })
  }, [])
  const openToSide = useCallback((id: Id, direction?: SplitDirection): void => {
    dispatch(direction === undefined ? { type: 'openToSide', id } : { type: 'openToSide', id, direction })
  }, [])
  const removePaneAction = useCallback((id: Id): void => {
    dispatch({ type: 'removePane', id })
  }, [])
  const showInPane = useCallback((id: Id): void => {
    dispatch({ type: 'showInPane', id })
  }, [])
  const setSizes = useCallback((sizes: readonly number[]): void => {
    dispatch({ type: 'setSizes', sizes })
  }, [])
  const resize = useCallback(
    (dividerIndex: number, delta: number, options?: ResizeOptions): void => {
      if (options?.commit === false) writer.defer()
      else writer.resume()
      // Keep the ref ahead of React: a pointerup can land before the last pointermove has rendered.
      const next = resizeBetween(liveRef.current, dividerIndex, delta)
      if (next !== liveRef.current) liveRef.current = next
      dispatch({ type: 'resize', dividerIndex, delta })
    },
    [writer]
  )
  const commitLayout = useCallback((): void => {
    writer.commit(storageKey, serializeLayout(liveRef.current))
  }, [writer, storageKey])
  // Quitting mid-drag must not lose the layout (Chromium flushes localStorage on graceful unload only).
  useEffect((): (() => void) | undefined => {
    if (typeof window === 'undefined') return undefined
    window.addEventListener('pagehide', commitLayout)
    window.addEventListener('beforeunload', commitLayout)
    return (): void => {
      window.removeEventListener('pagehide', commitLayout)
      window.removeEventListener('beforeunload', commitLayout)
    }
  }, [commitLayout])
  const equalizeLayout = useCallback((): void => {
    dispatch({ type: 'equalize' })
  }, [])

  const canSplit = openIds.length >= 2 && state.layout.paneIds.length < MAX_PANES

  return {
    layout: state.layout,
    split: isSplit(state.layout),
    canSplit,
    splitRight,
    splitDown,
    unsplit,
    openToSide,
    removePane: removePaneAction,
    showInPane,
    setSizes,
    resize,
    commitLayout,
    equalize: equalizeLayout
  }
}
