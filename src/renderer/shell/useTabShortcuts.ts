import { useEffect, useRef } from 'react'
import { decideTabShortcut, type ShortcutContext, type ShortcutKeyEvent } from './openTabsLogic'

export interface TabShortcutHandlers {
  readonly closeActive: () => void
  readonly cycle: (delta: 1 | -1) => void
}

const TEXT_ENTRY_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'
// xterm keeps a hidden textarea for keyboard input; typing in the terminal must not count as text entry.
const TERMINAL_SELECTOR = '.xterm'

function isTextEntry(element: Element | null): boolean {
  if (element === null || element.closest(TERMINAL_SELECTOR) !== null) {
    return false
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true
  }
  return TEXT_ENTRY_TAGS.has(element.tagName)
}

function readContext(): ShortcutContext {
  return {
    dialogOpen: document.querySelector(DIALOG_SELECTOR) !== null,
    inputFocused: isTextEntry(document.activeElement),
    terminalFocused: document.activeElement?.closest(TERMINAL_SELECTOR) != null
  }
}

function toKeyEvent(event: KeyboardEvent): ShortcutKeyEvent {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  }
}

/** Ctrl+W (outside the terminal) / Ctrl+Shift+W (anywhere) close the active tab; Ctrl+Tab / Ctrl+Shift+Tab cycle. */
export function useTabShortcuts(handlers: TabShortcutHandlers): void {
  const handlersRef = useRef<TabShortcutHandlers>(handlers)

  useEffect((): void => {
    handlersRef.current = handlers
  })

  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = decideTabShortcut(toKeyEvent(event), readContext())
      if (action === null) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (action === 'close-active') {
        handlersRef.current.closeActive()
      } else {
        handlersRef.current.cycle(action === 'next-tab' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
