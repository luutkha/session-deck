// Pure multi-select rules for the sidebar and the Hub board (W4). No React, no DOM: the click
// modifiers, Shift ranges over `flatSessionIds` order, Esc clearing and pruning on removal are
// unit-tested here; the views only own the React state.
import type { Id } from '../../shared/types'

export interface SelectClickModifiers {
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly shiftKey?: boolean
}

export type SelectClickMode = 'plain' | 'toggle' | 'range'

export interface SelectionState {
  /** Selected session ids; may contain ids the current filter hides until the next prune. */
  readonly ids: ReadonlySet<Id>
  /** Last plain/Ctrl-clicked id, the start of a Shift range. */
  readonly anchor: Id | null
}

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), anchor: null }

/**
 * Ctrl (or Cmd on macOS) toggles one card; Shift range-selects. Shift wins when both are held,
 * like Windows Explorer.
 */
export function selectionClickMode(modifiers: SelectClickModifiers): SelectClickMode {
  if (modifiers.shiftKey === true) {
    return 'range'
  }
  if (modifiers.ctrlKey === true || modifiers.metaKey === true) {
    return 'toggle'
  }
  return 'plain'
}

function sameIds(a: ReadonlySet<Id>, b: ReadonlySet<Id>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/** A plain click still opens the session and clears the bulk selection; it only sets the range anchor. */
export function selectOnly(id: Id): SelectionState {
  return { ids: new Set(), anchor: id }
}

/** Ctrl/Cmd+click: add or remove one card without opening it. The clicked card becomes the anchor. */
export function toggleSelection(state: SelectionState, id: Id): SelectionState {
  const ids = new Set(state.ids)
  if (ids.has(id)) {
    ids.delete(id)
    return { ids, anchor: state.anchor === id ? null : state.anchor }
  }
  // A plain click before this one opened a session and left it as the anchor without making it a
  // bulk selection; Ctrl+clicking a second card must produce the usual two-item selection (Explorer).
  if (ids.size === 0 && state.anchor !== null && state.anchor !== id) {
    ids.add(state.anchor)
  }
  ids.add(id)
  return { ids, anchor: id }
}

/**
 * Shift+click: select every visible id between the anchor and `id` (inclusive), replacing the
 * previous selection. Without a usable anchor it behaves like selecting only `id`.
 */
export function selectRange(state: SelectionState, id: Id, order: readonly Id[]): SelectionState {
  const target = order.indexOf(id)
  const start = state.anchor === null ? -1 : order.indexOf(state.anchor)
  if (target === -1 || start === -1) {
    return selectOnly(id)
  }
  const from = Math.min(start, target)
  const to = Math.max(start, target)
  const ids = new Set(order.slice(from, to + 1))
  const anchor = state.anchor
  if (sameIds(ids, state.ids) && anchor === state.anchor) {
    return state
  }
  return { ids, anchor }
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION
}

/**
 * Drops ids that vanished (closed/removed) or are hidden by the current filter/collapse state.
 * Returns the same state when nothing changed so React bails out of the re-render.
 */
export function pruneSelection(state: SelectionState, available: ReadonlySet<Id>): SelectionState {
  if (state.ids.size === 0 && (state.anchor === null || available.has(state.anchor))) {
    return state
  }
  const ids = new Set([...state.ids].filter((id): boolean => available.has(id)))
  const anchor = state.anchor !== null && available.has(state.anchor) ? state.anchor : null
  if (ids.size === state.ids.size && sameIds(ids, state.ids) && anchor === state.anchor) {
    return state
  }
  return { ids, anchor }
}

/** Ids in view order: actions apply in `flatSessionIds` order, never in click order. */
export function orderedSelection(state: SelectionState, order: readonly Id[]): readonly Id[] {
  return order.filter((id): boolean => state.ids.has(id))
}
