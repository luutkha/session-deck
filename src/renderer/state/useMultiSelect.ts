// Shared React state for multi-select in the sidebar and the Hub (W4). The pure rules live in
// multiSelect.ts; this hook wires them to clicks, prunes ids that leave the visible order, and
// lets Esc clear the selection without stealing Esc from a terminal, a text field or a dialog.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Id } from '../../shared/types'
import {
  clearSelection,
  EMPTY_SELECTION,
  orderedSelection,
  pruneSelection,
  selectOnly,
  selectRange,
  selectionClickMode,
  toggleSelection,
  type SelectClickModifiers,
  type SelectionState
} from './multiSelect'

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'
const MENU_SELECTOR = '[role="menu"][data-state="open"]'
const TERMINAL_SELECTOR = '.xterm'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest(TERMINAL_SELECTOR) !== null) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export interface MultiSelectApi {
  readonly selection: SelectionState
  /** Selected ids in view order (the order bulk actions must use). */
  readonly selectedIds: readonly Id[]
  isSelected(id: Id): boolean
  /** Card click: plain opens via `onPlainClick` and clears; Ctrl/Cmd toggles; Shift ranges. */
  handleClick(id: Id, modifiers?: SelectClickModifiers): void
  clear(): void
}

/**
 * `order` is the visible order (`flatSessionIds` in the sidebar, column order in the Hub).
 * Selection is pruned when an id leaves that order (removed, filtered out, collapsed away).
 */
export function useMultiSelect(order: readonly Id[], onPlainClick: (id: Id) => void): MultiSelectApi {
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION)
  const available = useMemo((): ReadonlySet<Id> => new Set(order), [order])
  const selectedIds = useMemo(
    (): readonly Id[] => orderedSelection(selection, order),
    [selection, order]
  )

  useEffect((): void => {
    setSelection((previous): SelectionState => pruneSelection(previous, available))
  }, [available])

  const handleClick = useCallback(
    (id: Id, modifiers: SelectClickModifiers = {}): void => {
      const mode = selectionClickMode(modifiers)
      if (mode === 'plain') {
        setSelection(selectOnly(id))
        onPlainClick(id)
        return
      }
      setSelection((previous): SelectionState =>
        mode === 'toggle' ? toggleSelection(previous, id) : selectRange(previous, id, order)
      )
    },
    [onPlainClick, order]
  )

  const clear = useCallback((): void => {
    setSelection(clearSelection())
  }, [])

  const isSelected = useCallback((id: Id): boolean => selection.ids.has(id), [selection.ids])

  useEffect((): (() => void) | undefined => {
    if (selection.ids.size === 0) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector(DIALOG_SELECTOR) !== null) return
      if (document.querySelector(MENU_SELECTOR) !== null) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      setSelection(clearSelection())
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [selection.ids.size])

  return { selection, selectedIds, isSelected, handleClick, clear }
}
