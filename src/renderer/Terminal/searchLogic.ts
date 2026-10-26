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
 * an active index is 1-based. xterm reports -1 when the highlight cap was reached, so the count alone is shown.
 */
export function matchLabel(query: string, resultIndex: number, resultCount: number): string {
  if (query.length === 0) {
    return ''
  }
  if (resultCount === 0) {
    return 'No matches'
  }
  if (resultIndex < 0) {
    return `${String(resultCount)} matches`
  }
  return `${String(resultIndex + 1)}/${String(resultCount)}`
}
