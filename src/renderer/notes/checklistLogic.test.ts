import { describe, expect, it } from 'vitest'
import type { ChecklistItem } from '../../shared/types'
import {
  MAX_ITEM_TEXT,
  MAX_ITEMS,
  MAX_NOTES,
  addItem,
  clearDone,
  deleteItem,
  editItem,
  isComplete,
  makeItemId,
  moveItem,
  newItem,
  normalizeNotes,
  progress,
  toggleItem
} from './checklistLogic'

const makeItem = (id: string, text: string, done = false): ChecklistItem => ({ id, text, done })

describe('makeItemId', () => {
  it('returns a UUID-shaped id and unique values', () => {
    const a = makeItemId()
    const b = makeItemId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })
})

describe('normalizeNotes', () => {
  it('leaves short text untouched', () => {
    expect(normalizeNotes('hello')).toBe('hello')
  })

  it('caps text at 20000 chars without throwing on unicode', () => {
    const long = 'x'.repeat(25000)
    const result = normalizeNotes(long)
    expect(result.length).toBe(MAX_NOTES)
    expect(result).toBe(long.slice(0, MAX_NOTES))
  })

  it('returns a new string even when within the limit', () => {
    const raw = ' a '
    const result = normalizeNotes(raw)
    expect(result).toBe(raw)
  })
})

describe('newItem', () => {
  it('returns null for empty and whitespace-only text', () => {
    expect(newItem('', '1')).toBeNull()
    expect(newItem('   ', '1')).toBeNull()
    expect(newItem('\t\n', '1')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(newItem('  wire up the api  ', '1')).toEqual({ id: '1', text: 'wire up the api', done: false })
  })

  it('truncates text at 300 chars', () => {
    const item = newItem('a'.repeat(400), '1')
    expect(item).not.toBeNull()
    expect((item as ChecklistItem).text.length).toBe(MAX_ITEM_TEXT)
  })

  it('handles unicode text', () => {
    const item = newItem('😀'.repeat(200), '1')
    expect(item).not.toBeNull()
    expect((item as ChecklistItem).text.length).toBeLessThanOrEqual(MAX_ITEM_TEXT)
    expect((item as ChecklistItem).text).toContain('😀')
  })
})

describe('addItem', () => {
  let counter: number
  const makeId = (): string => `id-${++counter}`

  beforeEach(() => {
    counter = 0
  })

  it('appends a new item using the supplied id maker', () => {
    const result = addItem([makeItem('1', 'first')], '  second  ', makeId)
    expect(result).toEqual([
      makeItem('1', 'first'),
      { id: 'id-1', text: 'second', done: false }
    ])
  })

  it('ignores empty text and returns the same array', () => {
    const items = [makeItem('1', 'first')]
    expect(addItem(items, '   ', makeId)).toBe(items)
  })

  it('does not add beyond 100 items', () => {
    const items = Array.from({ length: MAX_ITEMS }, (_, i) => makeItem(`id-${i}`, `step ${i}`))
    const result = addItem(items, 'overflow', makeId)
    expect(result).toBe(items)
    expect(result).toHaveLength(MAX_ITEMS)
  })
})

describe('toggleItem', () => {
  it('flips done', () => {
    const items = [makeItem('1', 'a'), makeItem('2', 'b', true)]
    expect(toggleItem(items, '1')).toEqual([{ ...items[0], done: true }, items[1]])
    expect(toggleItem(items, '2')).toEqual([items[0], { ...items[1], done: false }])
  })

  it('is a no-op (same reference) for unknown ids', () => {
    const items = [makeItem('1', 'a')]
    expect(toggleItem(items, 'nope')).toBe(items)
  })
})

describe('editItem', () => {
  it('trims and truncates the new text', () => {
    const items = [makeItem('1', 'old')]
    expect(editItem(items, '1', '  new text  ')).toEqual([{ id: '1', text: 'new text', done: false }])
  })

  it('truncates to 300 chars', () => {
    const items = [makeItem('1', 'old')]
    const result = editItem(items, '1', 'b'.repeat(500))
    expect(result[0].text.length).toBe(MAX_ITEM_TEXT)
  })

  it('deletes the item when text is empty', () => {
    const items = [makeItem('1', 'old'), makeItem('2', 'keep')]
    expect(editItem(items, '1', '   ')).toEqual([makeItem('2', 'keep')])
  })

  it('keeps the done flag unchanged while editing text', () => {
    const items = [makeItem('1', 'old', true)]
    expect(editItem(items, '1', 'new')).toEqual([{ id: '1', text: 'new', done: true }])
  })

  it('is a no-op for unknown ids', () => {
    const items = [makeItem('1', 'a')]
    expect(editItem(items, 'nope', 'text')).toBe(items)
  })
})

describe('deleteItem', () => {
  it('removes the item', () => {
    const items = [makeItem('1', 'a'), makeItem('2', 'b')]
    expect(deleteItem(items, '1')).toEqual([makeItem('2', 'b')])
  })

  it('is a no-op for unknown ids', () => {
    const items = [makeItem('1', 'a')]
    expect(deleteItem(items, 'nope')).toBe(items)
  })
})

describe('moveItem', () => {
  const items = [makeItem('1', 'a'), makeItem('2', 'b'), makeItem('3', 'c')]

  it('moves an item up', () => {
    expect(moveItem(items, '3', 'up').map((i) => i.id)).toEqual(['1', '3', '2'])
  })

  it('moves an item down', () => {
    expect(moveItem(items, '1', 'down').map((i) => i.id)).toEqual(['2', '1', '3'])
  })

  it('is a no-op at the top edge and bottom edge', () => {
    expect(moveItem(items, '1', 'up')).toBe(items)
    expect(moveItem(items, '3', 'down')).toBe(items)
  })

  it('is a no-op for unknown ids', () => {
    expect(moveItem(items, 'nope', 'up')).toBe(items)
  })
})

describe('clearDone', () => {
  it('removes only done items', () => {
    const items = [makeItem('1', 'a', true), makeItem('2', 'b'), makeItem('3', 'c', true)]
    expect(clearDone(items)).toEqual([makeItem('2', 'b')])
  })

  it('returns the same reference when nothing is done', () => {
    const items = [makeItem('1', 'a'), makeItem('2', 'b')]
    expect(clearDone(items)).toBe(items)
  })
})

describe('progress', () => {
  it('reports zeroes for an empty list', () => {
    expect(progress([])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it('computes done, total and a rounded percent', () => {
    const items = [makeItem('1', 'a', true), makeItem('2', 'b'), makeItem('3', 'c', true)]
    expect(progress(items)).toEqual({ done: 2, total: 3, percent: 67 })
  })

  it('reports 100 percent only when all items are done', () => {
    expect(progress([makeItem('1', 'a', true)])).toEqual({ done: 1, total: 1, percent: 100 })
  })
})

describe('isComplete', () => {
  it('is true only for a non-empty all-done list', () => {
    expect(isComplete([])).toBe(false)
    expect(isComplete([makeItem('1', 'a'), makeItem('2', 'b', true)])).toBe(false)
    expect(isComplete([makeItem('1', 'a', true), makeItem('2', 'b', true)])).toBe(true)
  })
})

describe('immutability', () => {
  it('never mutates the input arrays or items', () => {
    const items: readonly ChecklistItem[] = [
      makeItem('1', 'a'),
      makeItem('2', 'b', true),
      makeItem('3', 'c')
    ]
    const snapshot = JSON.stringify(items)
    addItem(items, 'd', makeItemId)
    toggleItem(items, '1')
    editItem(items, '3', 'zzz')
    deleteItem(items, '2')
    moveItem(items, '3', 'up')
    clearDone(items)
    expect(JSON.stringify(items)).toBe(snapshot)
  })
})