import type { ChecklistItem } from '../../shared/types'

/** Hard limits mirrored from the IPC contract (src/shared/ipc.ts). */
export const MAX_ITEMS = 100
export const MAX_ITEM_TEXT = 300
export const MAX_NOTES = 20000

export type MoveDirection = 'up' | 'down'

export interface ChecklistProgress {
  readonly done: number
  readonly total: number
  readonly percent: number
}

/** A fresh, unique item id. `crypto.randomUUID` is available in the renderer and in Node (tests). */
export function makeItemId(): string {
  return crypto.randomUUID()
}

/** Clamps free text notes to the backend's 20000-char limit. */
export function normalizeNotes(raw: string): string {
  return raw.length > MAX_NOTES ? raw.slice(0, MAX_NOTES) : raw
}

/**
 * Builds a new item from raw text. Trims, returns null when nothing is left, and truncates to
 * the 300-char limit. Never mutates anything.
 */
export function newItem(text: string, id: string): ChecklistItem | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const clipped = trimmed.length > MAX_ITEM_TEXT ? trimmed.slice(0, MAX_ITEM_TEXT) : trimmed
  return { id, text: clipped, done: false }
}

/**
 * Appends a new item. Empty/whitespace text is ignored and the list caps at 100 items; in both
 * cases the original array is returned unchanged.
 */
export function addItem(
  items: readonly ChecklistItem[],
  text: string,
  makeId: () => string
): readonly ChecklistItem[] {
  if (items.length >= MAX_ITEMS) return items
  const item = newItem(text, makeId())
  if (item === null) return items
  return [...items, item]
}

function indexOfId(items: readonly ChecklistItem[], id: string): number {
  return items.findIndex((item) => item.id === id)
}

/** Flips an item's done flag. Unknown ids are a no-op (same array reference). */
export function toggleItem(items: readonly ChecklistItem[], id: string): readonly ChecklistItem[] {
  const index = indexOfId(items, id)
  if (index === -1) return items
  const next = items.slice()
  next[index] = { ...next[index], done: !next[index].done }
  return next
}

/**
 * Rewrites an item's text (trimmed, truncated to 300). Empty/whitespace text deletes the item.
 * Unknown ids are a no-op.
 */
export function editItem(
  items: readonly ChecklistItem[],
  id: string,
  text: string
): readonly ChecklistItem[] {
  const index = indexOfId(items, id)
  if (index === -1) return items
  const trimmed = text.trim()
  if (trimmed.length === 0) return items.filter((item) => item.id !== id)
  const clipped = trimmed.length > MAX_ITEM_TEXT ? trimmed.slice(0, MAX_ITEM_TEXT) : trimmed
  const next = items.slice()
  next[index] = { ...next[index], text: clipped }
  return next
}

/** Removes an item. Unknown ids are a no-op. */
export function deleteItem(items: readonly ChecklistItem[], id: string): readonly ChecklistItem[] {
  const index = indexOfId(items, id)
  if (index === -1) return items
  return items.filter((item) => item.id !== id)
}

/** Moves an item one slot. No-op (same reference) at the ends or for unknown ids. */
export function moveItem(
  items: readonly ChecklistItem[],
  id: string,
  direction: MoveDirection
): readonly ChecklistItem[] {
  const index = indexOfId(items, id)
  if (index === -1) return items
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) return items
  const next = items.slice()
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

/** Drops every done item. Returns the same reference when nothing was done. */
export function clearDone(items: readonly ChecklistItem[]): readonly ChecklistItem[] {
  const next = items.filter((item) => !item.done)
  return next.length === items.length ? items : next
}

/** Done/total counts plus a rounded 0..100 percent (0 for an empty list). */
export function progress(items: readonly ChecklistItem[]): ChecklistProgress {
  const total = items.length
  let done = 0
  for (const item of items) {
    if (item.done) done += 1
  }
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { done, total, percent }
}

/** True when there is at least one item and every item is done. An empty list is not complete. */
export function isComplete(items: readonly ChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.done)
}
