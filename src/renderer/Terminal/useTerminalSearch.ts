// Terminal search (W3): one search provider per pane, driven from a small Orca-style bar in the
// bottom-right corner. Only the visible pane is searched (v1). Pure decisions live in searchLogic.ts.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import type { ISearchOptions } from '@xterm/addon-search'
import type { Id } from '../../shared/types'
import type { TerminalPanesApi } from './useTerminalPanes'
import { decideSearchKey, isSearchShortcut, matchLabel } from './searchLogic'

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'

/** VS Code-like find colours (the addon only accepts #RRGGBB). */
const SEARCH_OPTIONS: ISearchOptions = {
  caseSensitive: false,
  decorations: {
    matchBackground: '#613214',
    matchOverviewRuler: '#613214',
    activeMatchBackground: '#9e6a03',
    activeMatchColorOverviewRuler: '#9e6a03'
  }
}

interface SearchResult {
  readonly index: number
  readonly count: number
}

const NO_RESULT: SearchResult = { index: -1, count: 0 }

/**
 * Pure guard for the query effect: only a NEW non-empty query starts a search pass. Terminal
 * output alone must not call findNext here — the addon already re-highlights onWriteParsed,
 * so a second call would repeat the whole highlight scan for the unchanged query.
 */
export function shouldRunSearch(previousQuery: string | null, query: string): boolean {
  return query.length > 0 && query !== previousQuery
}

export interface TerminalSearchApi {
  /** The bar is on screen (and its input owns the keyboard). */
  readonly active: boolean
  readonly query: string
  /** "3/12", "No matches", "3/200+" (highlight cap hit) or empty (no query yet). */
  readonly label: string
  readonly inputRef: RefObject<HTMLInputElement | null>
  open(): void
  close(): void
  setQuery(query: string): void
  /** Moves to the next / previous match (Enter / Shift+Enter in the bar). */
  step(direction: 'next' | 'previous'): void
  handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void
}

/**
 * Owns the search bar state and drives the search addon of the pane it was opened on.
 * Ctrl+Shift+F works anywhere in the terminal/grid view (window capture, like the palette);
 * Esc closes and gives the keyboard back to the terminal, Enter / Shift+Enter cycle matches.
 */
export function useTerminalSearch(
  panes: TerminalPanesApi,
  activeId: Id | null,
  enabled: boolean
): TerminalSearchApi {
  const [active, setActive] = useState(false)
  const [query, setQueryState] = useState('')
  const [result, setResult] = useState<SearchResult>(NO_RESULT)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // The pane the bar searches: captured on open so a later focus change cannot move the search elsewhere.
  const openedIdRef = useRef<Id | null>(null)
  const resultsSubRef = useRef<{ dispose(): void } | null>(null)
  const previousActiveIdRef = useRef<Id | null>(activeId)
  // The query the addon was last told to search for; clearing the bar forgets it.
  const searchedQueryRef = useRef<string | null>(null)

  const paneFor = useCallback(
    (id: Id | null) => (id === null ? undefined : panes.panesRef.current.get(id)),
    [panes.panesRef]
  )

  const close = useCallback((): void => {
    setActive(false)
    setQueryState('')
    setResult(NO_RESULT)
    searchedQueryRef.current = null
    resultsSubRef.current?.dispose()
    resultsSubRef.current = null
    const pane = paneFor(openedIdRef.current)
    openedIdRef.current = null
    if (pane === undefined) {
      return
    }
    pane.view.searchAddon.clearDecorations()
    if (pane.opened && !pane.disposed) {
      pane.view.term.focus()
    }
  }, [paneFor])

  const open = useCallback((): void => {
    const pane = paneFor(activeId)
    if (pane === undefined || !pane.opened || pane.disposed) {
      return
    }
    setActive(true)
    setQueryState('')
    setResult(NO_RESULT)
    searchedQueryRef.current = null
    openedIdRef.current = activeId
    // One subscription per opening; the addon reports the active index and the total for the label.
    resultsSubRef.current?.dispose()
    resultsSubRef.current = pane.view.searchAddon.onDidChangeResults(
      ({ resultIndex, resultCount }): void => {
        setResult({ index: resultIndex, count: resultCount })
      }
    )
    inputRef.current?.focus()
  }, [activeId, paneFor])

  // Typing (or opening) searches immediately; an empty query clears the highlights.
  useEffect((): void => {
    if (!active) {
      return
    }
    const pane = paneFor(openedIdRef.current)
    if (pane === undefined || pane.disposed) {
      close()
      return
    }
    if (query.length === 0) {
      searchedQueryRef.current = null
      pane.view.searchAddon.clearDecorations()
      setResult(NO_RESULT)
      return
    }
    if (!shouldRunSearch(searchedQueryRef.current, query)) {
      return
    }
    searchedQueryRef.current = query
    pane.view.searchAddon.findNext(query, SEARCH_OPTIONS)
  }, [active, query, paneFor, close])

  // Focus may only arrive now that the input is mounted.
  useEffect((): void => {
    if (!active) {
      return
    }
    const input = inputRef.current
    if (input !== null) {
      input.focus()
      input.select()
    }
  }, [active])

  // Leaving the terminal/grid view hides the bar.
  useEffect((): void => {
    if (!enabled && active) {
      close()
    }
  }, [enabled, active, close])

  // Switching tabs closes the bar (it belongs to the pane it was opened on).
  useEffect((): void => {
    if (previousActiveIdRef.current === activeId) {
      return
    }
    previousActiveIdRef.current = activeId
    if (active) {
      close()
    }
  }, [activeId, active, close])

  // Ctrl+Shift+F anywhere (capture phase, like the palette) — xterm never gets to send ^F.
  useEffect((): (() => void) => {
    if (!enabled) {
      return (): void => undefined
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.querySelector(DIALOG_SELECTOR) !== null || !isSearchShortcut(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      open()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [enabled, open])

  useEffect((): (() => void) => {
    return (): void => {
      resultsSubRef.current?.dispose()
      resultsSubRef.current = null
    }
  }, [])

  const cycle = useCallback(
    (direction: 'next' | 'previous'): void => {
      const pane = paneFor(openedIdRef.current)
      if (pane === undefined || pane.disposed || query.length === 0) {
        return
      }
      if (direction === 'next') {
        pane.view.searchAddon.findNext(query, SEARCH_OPTIONS)
      } else {
        pane.view.searchAddon.findPrevious(query, SEARCH_OPTIONS)
      }
    },
    [paneFor, query]
  )

  const setQuery = useCallback((next: string): void => {
    setQueryState(next)
  }, [])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      const action = decideSearchKey(event)
      if (action === 'none') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (action === 'close') {
        close()
      } else {
        cycle(action)
      }
    },
    [close, cycle]
  )

  return {
    active,
    query,
    // The addon's highlight limit lives in paneFactory.ts (200). matchLabel mirrors it: a count
    // that reaches the cap is a lower bound, so the bar shows "200+" instead of a false total.
    label: matchLabel(query, result.index, result.count),
    inputRef,
    open,
    close,
    setQuery,
    step: cycle,
    handleKeyDown
  }
}
