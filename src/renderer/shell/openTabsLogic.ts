// Pure state for the tab bar: which sessions have an open tab, and which one is active.
// No React, no DOM, no IPC. Every function returns new objects and never mutates its input.
import type { Id, Session } from '../../shared/types'

export const OPEN_TABS_STORAGE_KEY = 'sessiondeck-open-tabs'

export interface OpenTabsState {
  readonly ids: readonly Id[]
  readonly activeId: Id | null
}

export interface RemoveResult {
  readonly state: OpenTabsState
  readonly nextActiveId: Id | null
}

export const EMPTY_OPEN_TABS: OpenTabsState = { ids: [], activeId: null }

export function openTab(state: OpenTabsState, id: Id): OpenTabsState {
  const ids = state.ids.includes(id) ? state.ids : [...state.ids, id]
  return { ids, activeId: id }
}

export function activateTab(state: OpenTabsState, id: Id): OpenTabsState {
  if (!state.ids.includes(id) || state.activeId === id) {
    return state
  }
  return { ids: state.ids, activeId: id }
}

/** Right neighbour of the removed active tab, else the left one, else none. Removed tabs are skipped. */
function neighbourAfterRemoval(
  ids: readonly Id[],
  index: number,
  removed: ReadonlySet<Id>
): Id | null {
  const right = ids.slice(index + 1).find((id: Id): boolean => !removed.has(id))
  if (right !== undefined) {
    return right
  }
  const left = ids
    .slice(0, index)
    .reverse()
    .find((id: Id): boolean => !removed.has(id))
  return left ?? null
}

/** Removes several tabs at once. If the active tab is removed, it moves to a neighbour. */
export function removeTabs(state: OpenTabsState, removedIds: readonly Id[]): RemoveResult {
  const removed = new Set(removedIds)
  const remaining = state.ids.filter((id: Id): boolean => !removed.has(id))
  if (remaining.length === state.ids.length) {
    return { state, nextActiveId: state.activeId }
  }
  const activeId = state.activeId
  if (activeId === null || !removed.has(activeId)) {
    return { state: { ids: remaining, activeId }, nextActiveId: activeId }
  }
  const index = state.ids.indexOf(activeId)
  const nextActiveId = neighbourAfterRemoval(state.ids, index, removed)
  return { state: { ids: remaining, activeId: nextActiveId }, nextActiveId }
}

export function cycleTab(state: OpenTabsState, delta: 1 | -1): OpenTabsState {
  const count = state.ids.length
  if (count === 0) {
    return state
  }
  const index = state.activeId === null ? -1 : state.ids.indexOf(state.activeId)
  if (index < 0) {
    const first = delta > 0 ? state.ids[0] : state.ids[count - 1]
    return { ids: state.ids, activeId: first }
  }
  const next = (index + delta + count) % count
  return { ids: state.ids, activeId: state.ids[next] }
}

/** Drops tabs whose session is gone or closed. Runs against the loaded store only. */
export function pruneOpenTabs(state: OpenTabsState, sessions: readonly Session[]): OpenTabsState {
  const live = new Set(
    sessions
      .filter((session: Session): boolean => session.closedAt === undefined)
      .map((session: Session): Id => session.id)
  )
  const stale = state.ids.filter((id: Id): boolean => !live.has(id))
  return removeTabs(state, stale).state
}

type JsonParseResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

function safeJsonParse(raw: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    // Corrupt storage is an expected input: the caller falls back to no open tabs.
    return { ok: false }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueIds(values: readonly unknown[]): readonly Id[] {
  const seen = new Set<Id>()
  const result: Id[] = []
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0 && !seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

/** Restores the persisted tabs. Anything malformed becomes "no open tabs". */
export function parseOpenTabs(raw: string | null): OpenTabsState {
  if (raw === null) {
    return EMPTY_OPEN_TABS
  }
  const parsed = safeJsonParse(raw)
  if (!parsed.ok || !isRecord(parsed.value) || !Array.isArray(parsed.value['ids'])) {
    return EMPTY_OPEN_TABS
  }
  const ids = uniqueIds(parsed.value['ids'])
  const storedActive = parsed.value['activeId']
  const activeId =
    typeof storedActive === 'string' && ids.includes(storedActive) ? storedActive : (ids[0] ?? null)
  return { ids, activeId }
}

export function serializeOpenTabs(state: OpenTabsState): string {
  return JSON.stringify({ ids: state.ids, activeId: state.activeId })
}

export type TabShortcutAction = 'close-active' | 'next-tab' | 'previous-tab'

export interface ShortcutKeyEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

export interface ShortcutContext {
  readonly dialogOpen: boolean
  readonly inputFocused: boolean
  /** Focus is inside the xterm terminal: plain Ctrl+W must reach the program (readline "delete word"). */
  readonly terminalFocused?: boolean
}

/**
 * Decides which tab action (if any) a key press triggers. Typing and open dialogs always win.
 * Ctrl+W closes the tab only outside the terminal; Ctrl+Shift+W closes it everywhere; Ctrl+Tab cycles everywhere.
 */
export function decideTabShortcut(
  event: ShortcutKeyEvent,
  context: ShortcutContext
): TabShortcutAction | null {
  if (context.dialogOpen || context.inputFocused) {
    return null
  }
  if (!event.ctrlKey || event.altKey || event.metaKey) {
    return null
  }
  if (event.key === 'Tab') {
    return event.shiftKey ? 'previous-tab' : 'next-tab'
  }
  if (event.key.toLowerCase() !== 'w') {
    return null
  }
  if (event.shiftKey) {
    return 'close-active'
  }
  return context.terminalFocused === true ? null : 'close-active'
}
