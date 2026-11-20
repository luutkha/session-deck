import { describe, expect, it } from 'vitest'
import type { FileViewSheet } from '../../shared/types'
import { FILE_VIEW_MAX_COLS, FILE_VIEW_MAX_ROWS } from '../../shared/types'
import {
  DEFAULT_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  TABLE_PAGE_SIZE,
  clampPage,
  columnWidth,
  compareCellText,
  pageCount,
  pageForRow,
  pageRangeLabel,
  parseNumeric,
  sortRows,
  toggleSort,
  truncationNote,
  withColumnWidth
} from './tableLogic'

function sheet(rows: readonly (readonly string[])[], truncated = false): FileViewSheet {
  return { name: 'Sheet1', rows, truncated }
}

function blankRows(count: number, width = 1): readonly string[][] {
  return Array.from({ length: count }, (): string[] => Array.from({ length: width }, (): string => ''))
}

describe('parseNumeric / compareCellText', () => {
  it('recognises plain decimals only', () => {
    expect(parseNumeric('10')).toBe(10)
    expect(parseNumeric(' -2.5 ')).toBe(-2.5)
    expect(parseNumeric('.5')).toBe(0.5)
    expect(parseNumeric('1,000')).toBeNull()
    expect(parseNumeric('ten')).toBeNull()
    expect(parseNumeric('')).toBeNull()
  })

  it('compares numbers numerically, not as strings', () => {
    expect(compareCellText('10', '9')).toBeGreaterThan(0)
    expect(compareCellText('9', '10')).toBeLessThan(0)
    expect(compareCellText('2', '2.0')).toBe(0)
  })

  it('puts numbers before text and text case-insensitively', () => {
    expect(compareCellText('10', 'apple')).toBeLessThan(0)
    expect(compareCellText('apple', '10')).toBeGreaterThan(0)
    expect(compareCellText('Apple', 'banana')).toBeLessThan(0)
  })

  it('puts empty cells last in both directions', () => {
    expect(compareCellText('', 'a')).toBeGreaterThan(0)
    expect(compareCellText('a', '  ')).toBeLessThan(0)
    expect(compareCellText('', ' ')).toBe(0)
  })
})

describe('sortRows / toggleSort', () => {
  const rows = [
    ['b', '2'],
    ['10', '1'],
    ['a', '3'],
    ['9', '4'],
    ['', '5']
  ]

  it('sorts ascending with numbers before text and empty last', () => {
    const sorted = sortRows(rows, { column: 0, direction: 'asc' })
    expect(sorted.map((row) => row.cells[0])).toEqual(['9', '10', 'a', 'b', ''])
    expect(sorted.map((row) => row.source)).toEqual([3, 1, 2, 0, 4])
  })

  it('sorts descending but keeps empty cells last', () => {
    const sorted = sortRows(rows, { column: 0, direction: 'desc' })
    expect(sorted.map((row) => row.cells[0])).toEqual(['b', 'a', '10', '9', ''])
  })

  it('is stable for equal values', () => {
    const tied = [
      ['x', 'first'],
      ['x', 'second'],
      ['x', 'third']
    ]
    expect(sortRows(tied, { column: 0, direction: 'asc' }).map((row) => row.cells[1])).toEqual([
      'first',
      'second',
      'third'
    ])
    expect(sortRows(tied, { column: 0, direction: 'desc' }).map((row) => row.cells[1])).toEqual([
      'first',
      'second',
      'third'
    ])
  })

  it('returns the rows in source order with no sort', () => {
    const rowsOut = sortRows(rows, null)
    expect(rowsOut.map((row) => row.source)).toEqual([0, 1, 2, 3, 4])
  })

  it('cycles ascending, descending, none', () => {
    const asc = toggleSort(null, 2)
    expect(asc).toEqual({ column: 2, direction: 'asc' })
    const desc = toggleSort(asc, 2)
    expect(desc).toEqual({ column: 2, direction: 'desc' })
    expect(toggleSort(desc, 2)).toBeNull()
    expect(toggleSort(desc, 1)).toEqual({ column: 1, direction: 'asc' })
  })
})

describe('paging', () => {
  it('uses 200 rows per page', () => {
    expect(TABLE_PAGE_SIZE).toBe(200)
    expect(pageCount(0)).toBe(1)
    expect(pageCount(200)).toBe(1)
    expect(pageCount(201)).toBe(2)
    expect(pageCount(2000)).toBe(10)
  })

  it('clamps a page to the existing range', () => {
    expect(clampPage(3, 2000)).toBe(3)
    expect(clampPage(99, 2000)).toBe(9)
    expect(clampPage(-2, 2000)).toBe(0)
    expect(clampPage(Number.NaN, 2000)).toBe(0)
  })

  it('maps a match row to its page', () => {
    expect(pageForRow(0)).toBe(0)
    expect(pageForRow(199)).toBe(0)
    expect(pageForRow(200)).toBe(1)
    expect(pageForRow(1999)).toBe(9)
  })

  it('labels the visible range', () => {
    expect(pageRangeLabel(0, 2000)).toBe('rows 1-200 of 2000')
    expect(pageRangeLabel(1, 2000)).toBe('rows 201-400 of 2000')
    expect(pageRangeLabel(9, 2000)).toBe('rows 1801-2000 of 2000')
    expect(pageRangeLabel(4, 250)).toBe('rows 201-250 of 250')
  })
})

describe('column widths', () => {
  it('defaults a column and clamps a drag to 48 px', () => {
    expect(columnWidth({}, 3)).toBe(DEFAULT_COLUMN_WIDTH)
    expect(withColumnWidth({}, 3, 12)).toEqual({ 3: MIN_COLUMN_WIDTH })
    expect(withColumnWidth({}, 3, 180.4)).toEqual({ 3: 180 })
  })

  it('keeps the other widths untouched', () => {
    expect(withColumnWidth({ 1: 90 }, 2, 150)).toEqual({ 1: 90, 2: 150 })
  })
})

describe('truncationNote', () => {
  it('says nothing for a complete table', () => {
    expect(truncationNote(sheet([['a']]))).toBeNull()
  })

  it('names the row cut alone', () => {
    const note = truncationNote(sheet(blankRows(FILE_VIEW_MAX_ROWS), true))
    expect(note).toContain('2000 rows')
    expect(note).not.toContain('columns')
  })

  it('names the column cut alone', () => {
    const note = truncationNote(sheet([Array.from({ length: FILE_VIEW_MAX_COLS }, (): string => 'x')], true))
    expect(note).toContain('50 columns')
    expect(note).not.toContain('2000 rows')
  })

  it('names both cuts', () => {
    const note = truncationNote(sheet(blankRows(FILE_VIEW_MAX_ROWS, FILE_VIEW_MAX_COLS), true))
    expect(note).toContain('2000 rows')
    expect(note).toContain('50 columns')
  })

  it('still explains a cut that hit neither axis', () => {
    expect(truncationNote(sheet([['a']], true))).toBe('The table was cut at the size cap.')
  })
})
