import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Id } from '../../shared/types'
import { decideNewSessionShortcut, moveFocus, shouldHandleGlobalShortcut, type ShortcutTargetLike } from './uiLogic'

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'
const TERMINAL_SELECTOR = '.xterm'

function closestOf(target: ShortcutTargetLike | null, selector: string): boolean {
  const el = target as unknown as { closest?: (s: string) => Element | null } | null
  return typeof el?.closest === 'function' && el.closest(selector) !== null
}

/**
 * New session shortcut: Ctrl+Shift+N anywhere, Ctrl+N outside the terminal (see decideNewSessionShortcut).
 * Ignored while any dialog is open (also dialogs this component does not own, such as the Statuses editor).
 */
export function useGlobalNewSessionShortcut(
  onNewSession: () => void,
  modalOpen: boolean
): void {
  const onNewSessionRef = useRef(onNewSession)
  onNewSessionRef.current = onNewSession
  const modalOpenRef = useRef(modalOpen)
  modalOpenRef.current = modalOpen

  useEffect((): (() => void) => {
    function handleWindowKeyDown(event: globalThis.KeyboardEvent): void {
      const target = event.target as ShortcutTargetLike | null
      const inTerminal = closestOf(target, TERMINAL_SELECTOR)
      const dialogOpen = modalOpenRef.current || document.querySelector(DIALOG_SELECTOR) !== null
      // A text control other than xterm's hidden textarea counts as typing.
      const inputFocused = !inTerminal && !shouldHandleGlobalShortcut(target, false)
      if (!decideNewSessionShortcut(event, { dialogOpen, inputFocused, terminalFocused: inTerminal })) {
        return
      }
      event.preventDefault()
      onNewSessionRef.current()
    }
    window.addEventListener('keydown', handleWindowKeyDown)
    return (): void => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [])
}

export interface SidebarListKeyboardOptions {
  readonly flatIds: readonly Id[]
  readonly activeId: Id | null
  readonly onSelect: (id: Id) => void
  readonly onStartRename: (id: Id) => void
  readonly onRequestRemove: (id: Id) => void
}

/** Arrow/Enter/F2/Delete handling for the session tree container. */
export function useSidebarListKeyDown(
  options: SidebarListKeyboardOptions
): (event: ReactKeyboardEvent<HTMLDivElement>) => void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  return useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const { flatIds, activeId, onSelect, onStartRename, onRequestRemove } = optionsRef.current
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = moveFocus(flatIds, activeId, event.key === 'ArrowDown' ? 1 : -1)
      if (next !== null) onSelect(next)
    } else if (event.key === 'Enter' && activeId !== null) {
      event.preventDefault()
      onSelect(activeId)
    } else if (event.key === 'F2' && activeId !== null) {
      event.preventDefault()
      onStartRename(activeId)
    } else if (event.key === 'Delete' && activeId !== null) {
      event.preventDefault()
      onRequestRemove(activeId)
    }
  }, [])
}