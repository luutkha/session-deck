import { useEffect, useRef } from 'react'
import type { ShortcutContext, ShortcutKeyEvent } from '../shell/openTabsLogic'
import { decidePaletteShortcut } from './paletteShortcut'

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

/** Ctrl+Shift+K (anywhere) and Ctrl+K (outside the terminal and text inputs) open the command palette. */
export function usePaletteShortcut(onOpen: () => void): void {
  const onOpenRef = useRef<() => void>(onOpen)

  useEffect((): void => {
    onOpenRef.current = onOpen
  })

  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (decidePaletteShortcut(toKeyEvent(event), readContext()) === null) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      onOpenRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
