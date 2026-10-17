// Pure split-pane layout maths. No React, no DOM, no IPC.
// Every function is immutable and returns a new SplitLayout.
import type { Id } from '../../shared/types'

/** 'row' = panes side by side (vertical divider); 'column' = panes stacked (horizontal divider). */
export type SplitDirection = 'row' | 'column'

export interface SplitLayout {
  readonly direction: SplitDirection
  /** Visible panes, left/top to right/bottom. Never contains duplicates. */
  readonly paneIds: readonly Id[]
  /** Fractions summing to 1, aligned with paneIds. Always the same length as paneIds. */
  readonly sizes: readonly number[]
}

export const MAX_PANES = 4
export const MIN_FRACTION = 0.15
export const SPLIT_STORAGE_KEY = 'sessiondeck.split.v1'

/** The neutral layout for zero or one visible session. */
export function singleLayout(id: Id | null): SplitLayout {
  return id === null
    ? { direction: 'row', paneIds: [], sizes: [] }
    : { direction: 'row', paneIds: [id], sizes: [1] }
}

export function isSplit(layout: SplitLayout): boolean {
  return layout.paneIds.length > 1
}

/** Equal fractions for `count` panes (empty for count <= 0). */
export function equalSizes(count: number): readonly number[] {
  if (count <= 0) {
    return []
  }
  return Array.from({ length: count }, (): number => 1 / count)
}

function isValidSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Returns fractions summing to 1; falls back to equal sizes when the array is malformed. */
export function normalizeSizes(sizes: readonly number[], count: number): readonly number[] {
  if (count <= 0) {
    return []
  }
  if (sizes.length !== count) {
    return equalSizes(count)
  }
  let sum = 0
  for (const size of sizes) {
    if (!isValidSize(size)) {
      return equalSizes(count)
    }
    sum += size
  }
  if (sum <= 0) {
    return equalSizes(count)
  }
  return sizes.map((size: number): number => size / sum)
}

function directionOf(value: SplitDirection): SplitDirection {
  return value === 'column' ? 'column' : 'row'
}

/**
 * Reconciles a stored layout with the sessions that are actually open:
 * drops unknown/duplicate ids, makes the active session visible, caps at
 * MAX_PANES and repairs the size fractions.
 */
export function normalizeLayout(
  layout: SplitLayout,
  openIds: readonly Id[],
  activeId: Id | null
): SplitLayout {
  const open = new Set<Id>(openIds)
  const ids: Id[] = []
  const raw: number[] = []
  for (let index = 0; index < layout.paneIds.length; index += 1) {
    const id = layout.paneIds[index]
    if (id === undefined || !open.has(id) || ids.includes(id)) {
      continue
    }
    if (ids.length >= MAX_PANES) {
      break
    }
    ids.push(id)
    raw.push(layout.sizes[index] ?? 0)
  }
  if (activeId !== null && !ids.includes(activeId)) {
    if (ids.length > 0) {
      ids[ids.length - 1] = activeId
      raw[raw.length - 1] = 0
    } else {
      ids.push(activeId)
      raw.push(0)
    }
  }
  return { direction: directionOf(layout.direction), paneIds: ids, sizes: normalizeSizes(raw, ids.length) }
}

/**
 * Adds `otherId` next to the active pane. An already-split layout keeps its
 * direction; a single layout uses `direction`. Sizes become equal.
 */
export function splitWith(
  layout: SplitLayout,
  activeId: Id | null,
  otherId: Id,
  direction: SplitDirection
): SplitLayout {
  if (activeId === null || activeId === otherId || layout.paneIds.includes(otherId)) {
    return layout
  }
  if (layout.paneIds.length >= MAX_PANES) {
    return layout
  }
  const ids = [...layout.paneIds]
  let anchor = ids.indexOf(activeId)
  if (anchor < 0) {
    ids.push(activeId)
    anchor = ids.length - 1
  }
  ids.splice(anchor + 1, 0, otherId)
  const nextDirection = isSplit(layout) ? layout.direction : direction
  return { direction: nextDirection, paneIds: ids, sizes: equalSizes(ids.length) }
}

/** Appends a pane. Duplicates and layouts already at MAX_PANES are left untouched. */
export function addPane(layout: SplitLayout, id: Id): SplitLayout {
  if (layout.paneIds.includes(id) || layout.paneIds.length >= MAX_PANES) {
    return layout
  }
  if (layout.paneIds.length === 0) {
    return { direction: layout.direction, paneIds: [id], sizes: [1] }
  }
  const ids = [...layout.paneIds, id]
  return { direction: layout.direction, paneIds: ids, sizes: equalSizes(ids.length) }
}

/** Removes a pane; removing down to one pane collapses to a single layout. */
export function removePane(layout: SplitLayout, id: Id): SplitLayout {
  const index = layout.paneIds.indexOf(id)
  if (index < 0) {
    return layout
  }
  const ids = layout.paneIds.filter((paneId: Id): boolean => paneId !== id)
  if (ids.length <= 1) {
    return singleLayout(ids[0] ?? null)
  }
  const sizes = layout.sizes.filter((_: number, i: number): boolean => i !== index)
  return { direction: layout.direction, paneIds: ids, sizes: normalizeSizes(sizes, ids.length) }
}

/** Shows `newId` in the pane that currently shows `paneId`. If `newId` is already visible, the two swap positions. */
export function replacePane(layout: SplitLayout, paneId: Id, newId: Id): SplitLayout {
  const index = layout.paneIds.indexOf(paneId)
  if (index < 0) {
    return layout
  }
  const existing = layout.paneIds.indexOf(newId)
  if (existing === index) {
    return layout
  }
  const ids = [...layout.paneIds]
  ids[index] = newId
  if (existing >= 0) {
    ids[existing] = paneId
  }
  return { ...layout, paneIds: ids }
}

/**
 * Moves the divider between pane `dividerIndex` and `dividerIndex + 1` by
 * `deltaFraction`. Both sides are clamped to MIN_FRACTION; the total stays 1.
 */
export function resizeBetween(
  layout: SplitLayout,
  dividerIndex: number,
  deltaFraction: number
): SplitLayout {
  const count = layout.paneIds.length
  if (dividerIndex < 0 || dividerIndex >= count - 1 || !Number.isFinite(deltaFraction)) {
    return layout
  }
  const sizes = [...layout.sizes]
  const left = sizes[dividerIndex] ?? 0
  const right = sizes[dividerIndex + 1] ?? 0
  const delta = Math.max(MIN_FRACTION - left, Math.min(right - MIN_FRACTION, deltaFraction))
  if (delta === 0) {
    return layout
  }
  sizes[dividerIndex] = left + delta
  sizes[dividerIndex + 1] = right - delta
  return { ...layout, sizes }
}

/** Gives every pane the same fraction. */
export function equalize(layout: SplitLayout): SplitLayout {
  return { ...layout, sizes: equalSizes(layout.paneIds.length) }
}

/** Most recently used other open session, else the first other open one, else null. */
export function pickPartner(
  openIds: readonly Id[],
  activeId: Id | null,
  recentIds: readonly Id[]
): Id | null {
  const open = new Set<Id>(openIds)
  for (const id of recentIds) {
    if (id !== activeId && open.has(id)) {
      return id
    }
  }
  for (const id of openIds) {
    if (id !== activeId) {
      return id
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Restores a persisted layout. Any malformed shape becomes null (caller falls back to a single layout). */
export function parseLayout(raw: string | null): SplitLayout | null {
  if (raw === null) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isRecord(parsed)) {
    return null
  }
  const direction = parsed['direction']
  if (direction !== 'row' && direction !== 'column') {
    return null
  }
  const paneIds = parsed['paneIds']
  const sizes = parsed['sizes']
  if (!Array.isArray(paneIds) || !Array.isArray(sizes) || paneIds.length !== sizes.length) {
    return null
  }
  if (paneIds.length > MAX_PANES) {
    return null
  }
  const ids: Id[] = []
  for (const value of paneIds) {
    if (typeof value !== 'string' || value.length === 0 || ids.includes(value)) {
      return null
    }
    ids.push(value)
  }
  const fractions: number[] = []
  for (const value of sizes) {
    if (!isValidSize(value)) {
      return null
    }
    fractions.push(value)
  }
  return { direction, paneIds: ids, sizes: fractions }
}

export function serializeLayout(layout: SplitLayout): string {
  return JSON.stringify({ direction: layout.direction, paneIds: layout.paneIds, sizes: layout.sizes })
}
