import type { AttentionReason, Id, StatusDef } from '../../shared/types'

export type DropPosition = 'before' | 'after'

export interface Point {
  readonly x: number
  readonly y: number
}

export const DEFAULT_GROUP_NAME = 'New group'

const MENU_MARGIN = 4

/**
 * Decides whether a pointer is above (before) or at/below (vertical) the
 * midpoint of a row. Used by the native HTML5 drag handlers to pick an insert
 * position without reading `dataTransfer` during dragover.
 */
export function resolveDropPosition(pointerY: number, top: number, height: number): DropPosition {
  const midpoint = top + height / 2
  return pointerY < midpoint ? 'before' : 'after'
}

/**
 * Keeps a fixed-position context menu fully inside the viewport, leaving a
 * small margin. When the menu is larger than the viewport it collapses to the
 * margin so its top-left corner stays reachable.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): Point {
  const maxX = Math.max(MENU_MARGIN, viewportWidth - width - MENU_MARGIN)
  const maxY = Math.max(MENU_MARGIN, viewportHeight - height - MENU_MARGIN)
  return {
    x: Math.min(Math.max(x, MENU_MARGIN), maxX),
    y: Math.min(Math.max(y, MENU_MARGIN), maxY)
  }
}

/** Returns a new set with `id` toggled. Never mutates the input. */
export function toggleStatusFilter(
  current: ReadonlySet<Id | null>,
  id: Id | null
): ReadonlySet<Id | null> {
  const next = new Set<Id | null>(current)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

export interface ShortcutTargetLike {
  readonly tagName?: string
  readonly isContentEditable?: boolean
}

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Decides whether a window-level shortcut (Ctrl+N) should run for the given
 * event target. Shortcuts are suppressed while a modal is open and while the
 * user is typing in a text control, so a half-typed value is not blurred and
 * committed behind a newly opened dialog.
 */
export function shouldHandleGlobalShortcut(
  target: ShortcutTargetLike | null,
  modalOpen: boolean
): boolean {
  if (modalOpen) return false
  if (target === null) return true
  if (target.isContentEditable === true) return false
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : ''
  return !EDITABLE_TAGS.has(tag)
}

/**
 * Roving keyboard selection. `delta` is +1 for down, -1 for up. When no item is
 * active (or the active id was filtered out) it enters from the corresponding
 * end of the list; otherwise it clamps at the ends.
 */
export function moveFocus(ids: readonly Id[], activeId: Id | null, delta: number): Id | null {
  if (ids.length === 0) {
    return null
  }
  const currentIndex = activeId === null ? -1 : ids.indexOf(activeId)
  if (currentIndex === -1) {
    return delta >= 0 ? ids[0] : ids[ids.length - 1]
  }
  const nextIndex = Math.min(Math.max(currentIndex + delta, 0), ids.length - 1)
  return ids[nextIndex]
}

/** The final segment of a path, tolerating both separators and trailing slashes. */
export function lastPathSegment(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed.length === 0) {
    return path
  }
  const parts = trimmed.split(/[\\/]/)
  const last = parts[parts.length - 1]
  return last.length > 0 ? last : path
}

export function attentionLabel(reason: AttentionReason): string {
  switch (reason) {
    case 'permission':
      return 'Needs attention: permission'
    case 'done':
      return 'Needs attention: finished'
    case 'idle':
      return 'Needs attention: idle'
    case 'bell':
      return 'Needs attention: bell'
    case 'unread':
      return 'Marked unread'
  }
}

export function attentionClass(reason: AttentionReason): string {
  switch (reason) {
    case 'permission':
      return 'bg-status-warning'
    case 'done':
      return 'bg-status-success'
    case 'idle':
      return 'bg-blue-500'
    case 'bell':
    case 'unread':
      return 'bg-blue-500'
  }
}

export function attentionAriaLabel(reason: AttentionReason): string {
  switch (reason) {
    case 'permission':
      return 'Needs attention: permission'
    case 'done':
      return 'Needs attention: finished'
    case 'idle':
      return 'Needs attention: idle'
    case 'bell':
      return 'Needs attention: bell'
    case 'unread':
      return 'Marked unread'
  }
}

export function runIndicatorClass(run: 'running' | 'exited'): string {
  return run === 'running' ? 'bg-status-success' : 'bg-destructive'
}

export function runDotAriaLabel(run: 'running' | 'exited'): string {
  return run === 'running' ? 'Running' : 'Exited'
}

/** Group colour (for the section header dot in Status grouping). */
export function statusSectionColor(statusId: Id | null, statuses: readonly StatusDef[]): string | null {
  if (statusId === null) return null
  const status = statuses.find((s) => s.id === statusId)
  return status?.color ?? null
}
export interface NewSessionShortcutEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

export interface NewSessionShortcutContext {
  /** Any modal dialog is open (ours or another one). */
  readonly dialogOpen: boolean
  /** Focus is in a text control that is NOT the terminal. */
  readonly inputFocused: boolean
  /** Focus is inside the xterm terminal, where plain Ctrl+N is readline's "next history". */
  readonly terminalFocused: boolean
}

/**
 * Ctrl+Shift+N starts a new session from anywhere, including the terminal (xterm would otherwise send ^N to the
 * program). Plain Ctrl+N works everywhere except while the terminal has focus, so Claude keeps its history key.
 * Dialogs and text inputs always win.
 */
export function decideNewSessionShortcut(
  event: NewSessionShortcutEvent,
  context: NewSessionShortcutContext
): boolean {
  if (context.dialogOpen || context.inputFocused) return false
  if (!event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'n') return false
  if (event.shiftKey) return true
  return !context.terminalFocused
}
