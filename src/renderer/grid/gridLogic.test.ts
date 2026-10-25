import { describe, expect, it } from 'vitest'
import {
  GRID_MAX_CELLS,
  GRID_PRESETS,
  assignOverflow,
  cellIndexFor,
  collectOverflow,
  isGridPreset,
  normalizeGrid,
  parseGrid,
  presetLayout,
  presetShape,
  serializeGrid,
  setCell
} from './gridLogic'

describe('presetShape (names are COLUMNS x ROWS)', () => {
  it('gives every preset its shape', () => {
    expect(presetShape('1x1')).toEqual({ cols: 1, rows: 1 })
    expect(presetShape('2x1')).toEqual({ cols: 2, rows: 1 })
    expect(presetShape('1x2')).toEqual({ cols: 1, rows: 2 })
    expect(presetShape('2x2')).toEqual({ cols: 2, rows: 2 })
    expect(presetShape('2x3')).toEqual({ cols: 2, rows: 3 })
    expect(presetShape('3x2')).toEqual({ cols: 3, rows: 2 })
  })
  it('never exceeds GRID_MAX_CELLS', () => {
    for (const preset of GRID_PRESETS) {
      const { cols, rows } = presetShape(preset)
      expect(cols * rows).toBeLessThanOrEqual(GRID_MAX_CELLS)
    }
  })
  it('isGridPreset accepts only the six presets', () => {
    for (const preset of GRID_PRESETS) expect(isGridPreset(preset)).toBe(true)
    expect(isGridPreset('4x2')).toBe(false)
    expect(isGridPreset('')).toBe(false)
    expect(isGridPreset(null)).toBe(false)
  })
})

describe('presetLayout', () => {
  it('is all-empty with the right cell count', () => {
    expect(presetLayout('1x1')).toEqual({ preset: '1x1', cells: [null] })
    expect(presetLayout('2x1')).toEqual({ preset: '2x1', cells: [null, null] })
    expect(presetLayout('2x3')).toEqual({ preset: '2x3', cells: [null, null, null, null, null, null] })
  })
})

describe('normalizeGrid', () => {
  it('drops closed/unknown ids and keeps open ones', () => {
    const layout = { preset: '1x2' as const, cells: ['a', 'ghost'] }
    expect(normalizeGrid(layout, ['a'])).toEqual({ preset: '1x2', cells: ['a', null] })
  })
  it('a duplicate id keeps its FIRST cell', () => {
    const layout = { preset: '2x2' as const, cells: ['a', 'a', 'b', null] }
    const normalized = normalizeGrid(layout, ['a', 'b'])
    expect(normalized.cells[0]).toBe('a')
    expect(normalized.cells[2]).toBe('b')
    expect(normalized.cells.filter((c) => c === 'a')).toHaveLength(1)
  })
  it('pads or trims cells to the preset shape', () => {
    const layout = { preset: '2x2' as const, cells: ['a', 'b'] }
    expect(normalizeGrid(layout, ['a', 'b']).cells).toEqual(['a', 'b', null, null])
  })
  it('never auto-fills empty cells (D32)', () => {
    expect(normalizeGrid(presetLayout('2x2'), ['a', 'b', 'c']).cells.filter((c) => c !== null)).toHaveLength(0)
  })
})

describe('setCell', () => {
  const twoByTwo = { preset: '2x2' as const, cells: ['a', 'b', null, null] }
  it('assigns the cell', () => {
    expect(setCell(twoByTwo, 2, 'c').cells).toEqual(['a', 'b', 'c', null])
  })
  it('a session already in another cell MOVES there and the occupants swap', () => {
    expect(setCell(twoByTwo, 2, 'a').cells).toEqual([null, 'b', 'a', null])
    expect(setCell(twoByTwo, 1, 'a').cells).toEqual(['b', 'a', null, null])
  })
  it('re-assigning the same cell changes nothing', () => {
    expect(setCell(twoByTwo, 0, 'a')).toBe(twoByTwo)
  })
  it('null clears the cell', () => {
    expect(setCell(twoByTwo, 1, null).cells).toEqual(['a', null, null, null])
  })
  it('out-of-range indexes are ignored', () => {
    expect(setCell(twoByTwo, 4, 'c')).toBe(twoByTwo)
    expect(setCell(twoByTwo, -1, 'c')).toBe(twoByTwo)
  })
})

describe('cellIndexFor', () => {
  const layout = { preset: '2x1' as const, cells: ['a', 'b'] }
  it('finds the cell of a session', () => {
    expect(cellIndexFor(layout, 'b')).toBe(1)
    expect(cellIndexFor(layout, 'a')).toBe(0)
  })
  it('unknown or null session finds nothing', () => {
    expect(cellIndexFor(layout, 'ghost')).toBeNull()
    expect(cellIndexFor(layout, null)).toBeNull()
  })
})

describe('overflow (preset shrink/restore, memory only)', () => {
  it('collects the ids that do not fit the smaller preset', () => {
    const cells = ['a', 'b', 'c', 'd', null, null] // a 3x2 grid (6 cells)
    expect(collectOverflow(cells, '2x1')).toEqual(['c', 'd'])
    expect(collectOverflow(cells, '3x2')).toEqual([])
  })
  it('assignOverflow fills empty cells in order and keeps the rest', () => {
    const result = assignOverflow({ preset: '2x1', cells: ['a', null] }, ['b', 'c'])
    expect(result.layout.cells).toEqual(['a', 'b'])
    expect(result.overflow).toEqual(['c'])
  })
  it('an overflowing id can land in a cell later freed', () => {
    const first = assignOverflow({ preset: '2x1', cells: ['a', 'b'] }, ['c'])
    expect(first.overflow).toEqual(['c'])
    const freed = setCell(first.layout, 0, null)
    const second = assignOverflow(freed, first.overflow)
    // c goes to the FIRST free cell (index 0)
    expect(second.layout.cells).toEqual(['c', 'b'])
    expect(second.overflow).toEqual([])
  })
})

describe('parseGrid / serializeGrid', () => {
  it('roundtrips a grid', () => {
    const grid = setCell(presetLayout('2x2'), 1, 'a')
    expect(parseGrid(serializeGrid(grid))).toEqual(grid)
  })
  it('malformed shapes become null', () => {
    expect(parseGrid(null)).toBeNull()
    expect(parseGrid('')).toBeNull()
    expect(parseGrid('not json')).toBeNull()
    expect(parseGrid('[1]')).toBeNull()
    expect(parseGrid('{"preset":"4x2","cells":[]}')).toBeNull()
    expect(parseGrid('{"preset":"1x1","cells":[]}')).toBeNull()
    expect(parseGrid('{"preset":"1x1","cells":["a","b"]}')).toBeNull()
    expect(parseGrid('{"preset":"2x1","cells":["a","a"]}')).toBeNull()
    expect(parseGrid('{"preset":"2x1","cells":["a",42]}')).toBeNull()
  })
})
