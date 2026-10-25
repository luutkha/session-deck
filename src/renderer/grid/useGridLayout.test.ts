import { describe, expect, it } from 'vitest'
import { presetLayout, setCell } from './gridLogic'
import { gridReducer, initGridState, type GridState } from './useGridLayout'

const state = (layout: GridState['layout'], openIds: readonly string[] = ['a', 'b', 'c', 'd'], activeId: string | null = 'a'): GridState =>
  ({ layout, openIds, activeId, overflow: [] })

describe('gridReducer sync', () => {
  it('drops closed sessions from cells (their cells empty)', () => {
    const layout = setCell(setCell(presetLayout('2x1'), 0, 'a'), 1, 'b')
    const next = gridReducer(state(layout), { type: 'sync', openIds: ['a'], activeId: 'a' })
    expect(next.layout.cells).toEqual(['a', null])
  })
  it('activeId just follows (never forces a cell)', () => {
    const layout = presetLayout('1x1')
    const next = gridReducer(state(layout, ['a', 'b'], 'a'), { type: 'sync', openIds: ['a', 'b'], activeId: 'b' })
    expect(next.activeId).toBe('b')
    expect(next.layout.cells).toEqual([null])
  })
})

describe('gridReducer setPreset', () => {
  it('growing keeps the assignments and adds empty cells', () => {
    const layout = setCell(presetLayout('1x1'), 0, 'a')
    const next = gridReducer(state(layout), { type: 'setPreset', preset: '2x2' })
    expect(next.layout.preset).toBe('2x2')
    expect(next.layout.cells).toEqual(['a', null, null, null])
  })
  it('shrinking keeps the lost ids in the overflow', () => {
    const layout = setCell(setCell(presetLayout('2x2'), 0, 'a'), 3, 'b')
    const next = gridReducer(state(layout), { type: 'setPreset', preset: '1x1' })
    expect(next.layout.cells).toEqual(['a'])
    expect(next.overflow).toEqual(['b'])
  })
  it('growing again restores the overflow ids into empty cells', () => {
    const layout = setCell(setCell(presetLayout('2x2'), 0, 'a'), 3, 'b')
    const shrunk = gridReducer(state(layout), { type: 'setPreset', preset: '1x1' })
    const back = gridReducer(shrunk, { type: 'setPreset', preset: '2x2' })
    expect(back.layout.cells).toEqual(['a', 'b', null, null])
    expect(back.overflow).toEqual([])
  })
  it('the same preset changes nothing', () => {
    const layout = setCell(presetLayout('1x1'), 0, 'a')
    const before = state(layout)
    expect(gridReducer(before, { type: 'setPreset', preset: '1x1' })).toBe(before)
  })
})

describe('gridReducer setCell', () => {
  it('assigns a session and focuses it', () => {
    const layout = presetLayout('2x1')
    const next = gridReducer(state(layout, ['a', 'b'], 'a'), { type: 'setCell', index: 1, id: 'b' })
    expect(next.layout.cells).toEqual([null, 'b'])
    expect(next.activeId).toBe('b')
  })
  it('accepts any id; the workspace opens its tab when a session is picked', () => {
    // The reducer no longer guards on open TABS: the picker lists sessions, and picking one opens it.
    const layout = presetLayout('2x1')
    const next = gridReducer(state(layout, ['a'], 'a'), { type: 'setCell', index: 0, id: 'later' })
    expect(next.layout.cells).toEqual(['later', null])
  })
  it('clearing a cell keeps the active session', () => {
    const layout = setCell(presetLayout('2x1'), 1, 'b')
    const next = gridReducer(state(layout, ['a', 'b'], 'a'), { type: 'setCell', index: 1, id: null })
    expect(next.layout.cells).toEqual([null, null])
    expect(next.activeId).toBe('a')
  })
})

describe('gridReducer focusCell', () => {
  it('focusing a cell makes its session active', () => {
    const layout = setCell(presetLayout('2x1'), 1, 'b')
    const next = gridReducer(state(layout, ['a', 'b'], 'a'), { type: 'focusCell', index: 1 })
    expect(next.activeId).toBe('b')
  })
  it('focusing an empty cell only clears the focus target', () => {
    const layout = setCell(presetLayout('2x1'), 1, 'b')
    const next = gridReducer(state(layout, ['a', 'b'], 'b'), { type: 'focusCell', index: 0 })
    expect(next.activeId).toBeNull()
  })
})

describe('initGridState', () => {
  it('normalizes a stored layout against the open sessions', () => {
    const stored = setCell(presetLayout('2x1'), 1, 'gone')
    expect(initGridState(['a'], 'a', stored).layout.cells).toEqual([null, null])
  })
})
