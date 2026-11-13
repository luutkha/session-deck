// Which live terminal panes to dispose when a workspace has too many (performance step 5, D62).
//
// `useTerminalPanes` keeps one xterm instance + DOM + scrollback per session it has ever shown, so a user
// with 40 sessions ends up with 40 live xterms although only a few are on screen. An evicted pane is not
// lost: its session's output lives in main's replay buffer and the pane is rebuilt and hydrated the next
// time the session becomes visible, exactly like the StrictMode remount and restart paths do.
//
// Rules: a visible pane is never evicted (the user is looking at it), the cap counts every created pane
// (visible ones included), and the least recently shown hidden pane goes first. Pure: no React, no DOM.
import type { Id } from '../../shared/types'

/** Live panes a workspace may keep (visible ones included). Below this nothing changes. */
export const MAX_LIVE_PANES = 12

export interface PaneLruInput {
  /** Every id that currently has a live pane, in creation order. */
  readonly createdIds: readonly Id[]
  /** Ids on screen now: never evicted. */
  readonly visibleIds: readonly Id[]
  /**
   * When each id was last on screen, from a monotonically increasing counter owned by the hook.
   * A missing entry (never shown) is the oldest possible time.
   */
  readonly lastShownAt: ReadonlyMap<Id, number>
  /** The cap; must be a non-negative integer. */
  readonly max: number
}

function assertMax(max: number): void {
  if (!Number.isInteger(max) || max < 0) {
    throw new TypeError(`pickEvictions: max must be a non-negative integer, got ${String(max)}`)
  }
}

/**
 * Returns the ids whose panes must be disposed to bring the created set back to `max`:
 * never a visible id, least recently shown first, ties and ids without a `lastShownAt` entry in
 * `createdIds` order. Empty when created panes are within the cap (or only visible ones are).
 * Does not mutate its input.
 */
export function pickEvictions(input: PaneLruInput): Id[] {
  const { createdIds, visibleIds, lastShownAt, max } = input
  assertMax(max)
  if (createdIds.length <= max) {
    return []
  }
  const visible = new Set<Id>(visibleIds)
  // Keeping every visible pane can leave more than `max` created panes; that is expected, never evict one.
  const excess = createdIds.length - Math.max(max, visible.size)
  if (excess <= 0) {
    return []
  }
  const order = new Map<Id, number>()
  const candidates: Id[] = []
  createdIds.forEach((id: Id, index: number): void => {
    if (visible.has(id)) {
      return
    }
    if (order.has(id)) {
      // A duplicate id is one pane: keep its first position and never list it twice.
      return
    }
    order.set(id, index)
    candidates.push(id)
  })
  const shownAt = (id: Id): number => lastShownAt.get(id) ?? Number.NEGATIVE_INFINITY
  candidates.sort((a: Id, b: Id): number => {
    const rankA = shownAt(a)
    const rankB = shownAt(b)
    if (rankA !== rankB) {
      return rankA < rankB ? -1 : 1
    }
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
  return candidates.slice(0, excess)
}
