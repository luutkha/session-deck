// The terminal right-click menu's state and actions (D59). The workspace passes what it can do; this hook picks the
// rows that apply to the clicked pane and runs them on that pane, then gives the terminal its focus back.
import { useCallback, useState } from 'react'
import type { Id, Session } from '../../shared/types'
import type { TerminalPanesApi } from './useTerminalPanes'
import { copySelectionToClipboard, pasteClipboardInto } from './paneFactory'
import type { TerminalContextMenuProps, TerminalMenuTarget } from './TerminalContextMenu'
import { menuRows } from './terminalMenuLogic'

export interface TerminalMenuDeps {
  readonly panes: TerminalPanesApi
  readonly sessions: readonly Session[]
  /** The right-clicked pane becomes the active one (so Find and Split act on it). */
  readonly focusSession: (id: Id) => void
  readonly openSearch: () => void
  /** Null = no splitting here (grid view, or it cannot split now). */
  readonly split: { readonly splitRight: () => void; readonly splitDown: () => void } | null
  /** The panes on screen in the split view; empty in grid view. */
  readonly splitPaneIds: readonly Id[]
  readonly removePane: (id: Id) => void
  readonly forkSession: (id: Id) => void
}

export interface TerminalMenuApi {
  readonly open: (id: Id, point: { readonly x: number; readonly y: number }) => void
  readonly menu: TerminalContextMenuProps
}

export function useTerminalMenu(deps: TerminalMenuDeps): TerminalMenuApi {
  const [target, setTarget] = useState<TerminalMenuTarget | null>(null)
  const { panes, focusSession } = deps

  const open = useCallback((id: Id, point: { readonly x: number; readonly y: number }): void => {
    const pane = panes.panesRef.current.get(id)
    if (pane === undefined) return
    focusSession(id)
    setTarget({ id, x: point.x, y: point.y, hasSelection: pane.view.term.hasSelection(), openedAt: Date.now() })
  }, [panes, focusSession])

  const term = target === null ? null : panes.panesRef.current.get(target.id)?.view.term ?? null
  const session = target === null ? undefined : deps.sessions.find((s: Session): boolean => s.id === target.id)
  const rows = target === null ? null : menuRows(target.id, session, deps.split !== null, deps.splitPaneIds)
  // Every row closes the menu and, unless it opens something else, puts the cursor back in the terminal.
  const run = (action: () => void, refocus = true): (() => void) => (): void => {
    setTarget(null)
    action()
    if (refocus) term?.focus()
  }
  const close = (): void => {
    setTarget(null)
    term?.focus()
  }

  const menu: TerminalContextMenuProps = {
    target,
    onClose: close,
    onCopy: run((): void => { if (term !== null) void copySelectionToClipboard(term) }),
    onPaste: run((): void => { if (term !== null) void pasteClipboardInto(term) }),
    onSelectAll: run((): void => term?.selectAll()),
    onFind: run(deps.openSearch, false),
    onClear: run((): void => term?.clear()),
    onCopyPath: run((): void => {
      if (session !== undefined) void navigator.clipboard.writeText(session.cwd).catch((): void => undefined)
    }),
    onSplitRight: rows?.split === true && deps.split !== null ? run(deps.split.splitRight) : undefined,
    onSplitDown: rows?.split === true && deps.split !== null ? run(deps.split.splitDown) : undefined,
    onClosePane: rows?.closePane === true && target !== null ? run((): void => deps.removePane(target.id), false) : undefined,
    onFork: rows?.fork === true && target !== null ? run((): void => deps.forkSession(target.id), false) : undefined
  }
  return { open, menu }
}
