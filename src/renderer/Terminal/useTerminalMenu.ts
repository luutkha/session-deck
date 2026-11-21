// The terminal right-click menu's state and actions (D59, link rows D76). The workspace passes what it can do; this
// hook picks the rows that apply to the clicked pane (and to the link under the pointer) and runs them on that pane,
// then gives the terminal its focus back.
import { useCallback, useState } from 'react'
import type { Id, Session } from '../../shared/types'
import type { TerminalPanesApi } from './useTerminalPanes'
import { copySelectionToClipboard, pasteClipboardInto, type ContextMenuPoint } from './paneFactory'
import {
  type TerminalContextLinkRow,
  type TerminalContextMenuProps,
  type TerminalMenuTarget
} from './TerminalContextMenu'
import { menuRows } from './terminalMenuLogic'
import { RESET_TERMINAL_MODES } from './terminalModes'
import type { HoveredLink } from './links/hoveredLink'
import { linkMenuHeading, linkMenuRows } from './links/linkMenuRows'
import { requestFileView } from '../viewer/previewBus'

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
  readonly open: (id: Id, point: ContextMenuPoint) => void
  readonly menu: TerminalContextMenuProps
}

/** Opens the link text again in main, which re-resolves it against the session cwd (the renderer never trusts itself). */
function openLinkFromMenu(link: HoveredLink, reveal: boolean): void {
  void window.api
    .openLink(link.sessionId, link.text, reveal)
    .then((result) => {
      if (!result.ok) {
        console.error('SessionDeck: opening the link from the terminal menu failed', result.error)
      }
    })
    .catch((error: unknown) => {
      console.error('SessionDeck: opening the link from the terminal menu failed', error)
    })
}

function copyTextFromMenu(text: string): void {
  void navigator.clipboard.writeText(text).catch((error: unknown) => {
    console.error('SessionDeck: copying the link target from the terminal menu failed', error)
  })
}

export function useTerminalMenu(deps: TerminalMenuDeps): TerminalMenuApi {
  const [target, setTarget] = useState<TerminalMenuTarget | null>(null)
  const { panes, focusSession } = deps

  const open = useCallback((id: Id, point: ContextMenuPoint): void => {
    const pane = panes.panesRef.current.get(id)
    if (pane === undefined) return
    focusSession(id)
    setTarget({
      id,
      x: point.x,
      y: point.y,
      hasSelection: pane.view.term.hasSelection(),
      openedAt: Date.now(),
      link: point.link
    })
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

  // D76: the link under the pointer, if any. Built per open (the menu is remounted per openedAt), so a second
  // right-click on another link gets that link's rows.
  const link = target?.link ?? null
  const linkRows: readonly TerminalContextLinkRow[] | undefined = link === null
    ? undefined
    : linkMenuRows(link.link, link.text).map((row) => ({
        id: row.id,
        label: row.label,
        onSelect: run((): void => {
          switch (row.id) {
            case 'preview':
              // The side-panel listener may be absent (no workspace mounted); then keep the old click behaviour.
              if (!requestFileView({ sessionId: link.sessionId, text: link.text })) {
                openLinkFromMenu(link, false)
              }
              break
            case 'open':
            case 'openFolder':
            case 'openUrl':
              openLinkFromMenu(link, false)
              break
            case 'reveal':
              openLinkFromMenu(link, true)
              break
            case 'copyPath':
            case 'copyUrl':
              copyTextFromMenu(link.link.target)
              break
          }
        })
      }))
  const linkHeading = link === null ? undefined : linkMenuHeading(link.link, link.text)

  const close = (): void => {
    setTarget(null)
    term?.focus()
  }

  const menu: TerminalContextMenuProps = {
    target,
    onClose: close,
    linkRows,
    linkHeading,
    onCopy: run((): void => { if (term !== null) void copySelectionToClipboard(term) }),
    onPaste: run((): void => { if (term !== null) void pasteClipboardInto(term) }),
    onSelectAll: run((): void => term?.selectAll()),
    onFind: run(deps.openSearch, false),
    onClear: run((): void => term?.clear()),
    onResetModes: run((): void => term?.write(RESET_TERMINAL_MODES)),
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
