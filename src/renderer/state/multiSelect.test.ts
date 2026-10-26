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
  type SelectionState
} from './multiSelect'

const ORDER: readonly Id[] = ['a', 'b', 'c', 'd', 'e']

function selection(ids: readonly Id[], anchor: Id | null): SelectionState {
  return { ids: new Set(ids), anchor }
}

function idsOf(state: SelectionState): readonly string[] {
  return [...state.ids].sort()
}

describe('selectionClickMode', () => {
  it('is plain without modifiers', () => {
    expect(selectionClickMode({})).toBe('plain')
  })

  it('toggles on Ctrl or Cmd', () => {
    expect(selectionClickMode({ ctrlKey: true })).toBe('toggle')
    expect(selectionClickMode({ metaKey: true })).toBe('toggle')
  })

  it('ranges on Shift, which wins over Ctrl/Cmd', () => {
    expect(selectionClickMode({ shiftKey: true })).toBe('range')
    expect(selectionClickMode({ shiftKey: true, ctrlKey: true })).toBe('range')
    expect(selectionClickMode({ shiftKey: true, metaKey: true })).toBe('range')
  })
})

describe('selectOnly', () => {
  it('clears the ids and anchors the clicked session', () => {
    const next = selectOnly('c')
    expect(next.ids.size).toBe(0)
    expect(next.anchor).toBe('c')
  })
})

describe('toggleSelection', () => {
  it('adds an id and makes it the anchor', () => {
    const next = toggleSelection(selection(['a'], 'a'), 'c')
    expect(idsOf(next)).toEqual(['a', 'c'])
    expect(next.anchor).toBe('c')
  })

  it('adds the plain-clicked anchor when the bulk selection is still empty', () => {
    const next = toggleSelection(selection([], 'a'), 'c')
    expect(idsOf(next)).toEqual(['a', 'c'])
    expect(next.anchor).toBe('c')
  })

  it('selects the anchor itself when it is Ctrl+clicked after a plain click', () => {
    const next = toggleSelection(selection([], 'a'), 'a')
    expect(idsOf(next)).toEqual(['a'])
    expect(next.anchor).toBe('a')
  })

  it('removes an id, and drops the anchor when it was the removed one', () => {
    const next = toggleSelection(selection(['a', 'c'], 'c'), 'c')
    expect(idsOf(next)).toEqual(['a'])
    expect(next.anchor).toBeNull()
  })

  it('keeps another anchor when a different id is removed', () => {
    const next = toggleSelection(selection(['a', 'c'], 'a'), 'c')
    expect(idsOf(next)).toEqual(['a'])
    expect(next.anchor).toBe('a')
  })

  it('never mutates the previous state', () => {
    const previous = selection(['a'], 'a')
    toggleSelection(previous, 'b')
    expect(idsOf(previous)).toEqual(['a'])
  })
})

describe('selectRange', () => {
  it('selects the visible range forward from the anchor', () => {
    const next = selectRange(selection([], 'b'), 'd', ORDER)
    expect(idsOf(next)).toEqual(['b', 'c', 'd'])
    expect(next.anchor).toBe('b')
  })

  it('selects the range backwards too', () => {
    const next = selectRange(selection(['d'], 'd'), 'b', ORDER)
    expect(idsOf(next)).toEqual(['b', 'c', 'd'])
    expect(next.anchor).toBe('d')
  })

  it('replaces the previous selection instead of adding to it', () => {
    const next = selectRange(selection(['a', 'e'], 'a'), 'c', ORDER)
    expect(idsOf(next)).toEqual(['a', 'b', 'c'])
  })

  it('selects only the clicked id when there is no anchor', () => {
    const next = selectRange(EMPTY_SELECTION, 'c', ORDER)
    expect(next.ids.size).toBe(0)
    expect(next.anchor).toBe('c')
  })

  it('selects only the clicked id when the anchor is no longer visible', () => {
    const next = selectRange(selection([], 'gone'), 'c', ORDER)
    expect(next.ids.size).toBe(0)
    expect(next.anchor).toBe('c')
  })

  it('selects only the clicked id when it is not in the visible order', () => {
    const next = selectRange(selection([], 'a'), 'gone', ORDER)
    expect(next.ids.size).toBe(0)
    expect(next.anchor).toBe('gone')
  })

  it('follows the order, so a filtered list ranges over what is on screen', () => {
    const next = selectRange(selection([], 'a'), 'e', ['a', 'c', 'e'])
    expect(idsOf(next)).toEqual(['a', 'c', 'e'])
  })

  it('returns the same state when the range did not change', () => {
    const previous = selection(['b', 'c'], 'b')
    expect(selectRange(previous, 'c', ORDER)).toBe(previous)
  })
})

describe('clearSelection', () => {
  it('drops ids and the anchor', () => {
    expect(clearSelection().ids.size).toBe(0)
    expect(clearSelection().anchor).toBeNull()
  })
})

describe('pruneSelection', () => {
  it('drops ids that left the visible order', () => {
    const next = pruneSelection(selection(['a', 'c', 'gone'], 'c'), new Set(['a', 'b', 'c']))
    expect(idsOf(next)).toEqual(['a', 'c'])
    expect(next.anchor).toBe('c')
  })

  it('clears an anchor that left the visible order', () => {
    const next = pruneSelection(selection(['a'], 'gone'), new Set(['a']))
    expect(idsOf(next)).toEqual(['a'])
    expect(next.anchor).toBeNull()
  })

  it('returns the same state when nothing changed', () => {
    const previous = selection(['a', 'c'], 'c')
    expect(pruneSelection(previous, new Set(['a', 'b', 'c']))).toBe(previous)
  })

  it('keeps an empty selection with a visible anchor untouched', () => {
    const previous = selection([], 'b')
    expect(pruneSelection(previous, new Set(['a', 'b']))).toBe(previous)
  })
})

describe('orderedSelection', () => {
  it('returns selected ids in view order, not click order', () => {
    expect(orderedSelection(selection(['d', 'a'], 'd'), ORDER)).toEqual(['a', 'd'])
  })

  it('skips selected ids hidden from the current order', () => {
    expect(orderedSelection(selection(['a', 'hidden'], 'a'), ['a', 'b'])).toEqual(['a'])
  })
})
