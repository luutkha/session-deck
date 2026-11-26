// Pure decisions for the terminal search bar (W3). No React, no DOM, so the shortcut, the
// Enter / Shift+Enter cycling and the match-count label are unit-tested without xterm.

/** Minimal view of a keyboard event, like keymap.ts's KeyInfo. */
export interface SearchKeyInfo {
  readonly key: string
  readonly ctrlKey?: boolean
  readonly shiftKey?: boolean
  readonly altKey?: boolean
  readonly metaKey?: boolean
}

export type SearchKeyAction = 'close' | 'next' | 'previous' | 'none'

const SEARCH_KEY = 'f'

/**
 * The addon only tracks this many decorated matches per pane (SEARCH_HIGHLIGHT_LIMIT in
 * paneFactory.ts; deliberately kept low because a full highlight pass re-runs on every write).
 * Mirrored here instead of imported: paneFactory pulls in the xterm GPU addons, which cannot be
 * loaded in the node-only unit tests. When the count reaches it, the label says "200+" rather
 * than pretending the truncated count is the total.
 */
export const MATCH_COUNT_CAP = 200

/** Ctrl+Shift+F opens search everywhere (the Ctrl+Shift+K palette precedent); plain Ctrl+F stays with the program. */
export function isSearchShortcut(event: SearchKeyInfo): boolean {
  if (event.altKey === true || event.metaKey === true || event.ctrlKey !== true) {
    return false
  }
  return event.shiftKey === true && event.key.toLowerCase() === SEARCH_KEY
}

/** Keys inside the search input: Esc closes, Enter finds the next match, Shift+Enter the previous one. */
export function decideSearchKey(event: SearchKeyInfo): SearchKeyAction {
  if (event.key === 'Escape') {
    return 'close'
  }
  if (event.key === 'Enter') {
    return event.shiftKey === true ? 'previous' : 'next'
  }
  return 'none'
}

/**
 * The small counter next to the input. Empty query = no label; no matches = an explicit message;
 * an active index is 1-based. xterm reports -1 when the active match falls outside the tracked
 * results, so the count alone is shown. A count at the highlight cap is a lower bound, hence "+".
 */
export function matchLabel(
  query: string,
  resultIndex: number,
  resultCount: number,
  cap: number = MATCH_COUNT_CAP
): string {
  if (query.length === 0) {
    return ''
  }
  if (resultCount === 0) {
    return 'No matches'
  }
  const total = resultCount >= cap ? `${String(cap)}+` : String(resultCount)
  if (resultIndex < 0) {
    return `${total} matches`
  }
  return `${String(resultIndex + 1)}/${total}`
}
