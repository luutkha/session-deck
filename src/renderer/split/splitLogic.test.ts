import { describe, expect, it } from 'vitest'
import {
  MAX_PANES,
  MIN_FRACTION,
  addPane,
  equalSizes,
  equalize,
  isSplit,
  normalizeLayout,
  normalizeSizes,
  parseLayout,
  pickPartner,
  removePane,
  replacePane,
  resizeBetween,
  serializeLayout,
  singleLayout,
  splitWith,
  type SplitLayout
} from './splitLogic'

function layout(
  direction: 'row' | 'column',
  paneIds: readonly string[],
  sizes: readonly number[]
): SplitLayout {
  return { direction, paneIds, sizes }
}

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length)
  actual.forEach((value: number, index: number): void => {
    expect(value).toBeCloseTo(expected[index] ?? 0, 6)
  })
}

describe('singleLayout', () => {
  it('is empty for null', () => {
    expect(singleLayout(null)).toEqual({ direction: 'row', paneIds: [], sizes: [] })
  })

  it('is one full-size row pane for an id', () => {
    expect(singleLayout('a')).toEqual({ direction: 'row', paneIds: ['a'], sizes: [1] })
  })
})

describe('isSplit', () => {
  it('is false for zero or one pane', () => {
    expect(isSplit(singleLayout(null))).toBe(false)
    expect(isSplit(singleLayout('a'))).toBe(false)
  })

  it('is true for two or more panes', () => {
    expect(isSplit(layout('row', ['a', 'b'], [0.5, 0.5]))).toBe(true)
  })
})

describe('equalSizes', () => {
  it('splits evenly and handles non-positive counts', () => {
    expect(equalSizes(0)).toEqual([])
    expect(equalSizes(-1)).toEqual([])
    expectClose(equalSizes(4), [0.25, 0.25, 0.25, 0.25])
  })
})

describe('normalizeSizes', () => {
  it('rescales a drifting but valid array to sum 1', () => {
    expectClose(normalizeSizes([3, 1], 2), [0.75, 0.25])
  })

  it('falls back to equal sizes when the length is wrong', () => {
    expectClose(normalizeSizes([0.5], 3), [1 / 3, 1 / 3, 1 / 3])
  })

  it('falls back to equal sizes for zero, negative or non-finite values', () => {
    expectClose(normalizeSizes([0, 1], 2), [0.5, 0.5])
    expectClose(normalizeSizes([-1, 2], 2), [0.5, 0.5])
    expectClose(normalizeSizes([Number.NaN, 1], 2), [0.5, 0.5])
  })

  it('returns empty for a non-positive count', () => {
    expect(normalizeSizes([], 0)).toEqual([])
  })
})

describe('normalizeLayout', () => {
  it('drops ids that are not open', () => {
    const result = normalizeLayout(layout('row', ['a', 'x', 'b'], [0.4, 0.3, 0.3]), ['a', 'b'], 'a')
    expect(result.paneIds).toEqual(['a', 'b'])
    expectClose(result.sizes, normalizeSizes([0.4, 0.3], 2))
  })

  it('drops duplicate ids', () => {
    const result = normalizeLayout(layout('row', ['a', 'a', 'b'], [0.3, 0.3, 0.4]), ['a', 'b'], 'a')
    expect(result.paneIds).toEqual(['a', 'b'])
  })

  it('caps the layout at MAX_PANES', () => {
    const result = normalizeLayout(
      layout('row', ['a', 'b', 'c', 'd', 'e'], [0.2, 0.2, 0.2, 0.2, 0.2]),
      ['a', 'b', 'c', 'd', 'e'],
      'a'
    )
    expect(result.paneIds).toEqual(['a', 'b', 'c', 'd'])
    expect(result.paneIds.length).toBe(MAX_PANES)
  })

  it('replaces the last pane when the active session is not visible', () => {
    const result = normalizeLayout(layout('row', ['a', 'b'], [0.5, 0.5]), ['a', 'b', 'c'], 'c')
    expect(result.paneIds).toEqual(['a', 'c'])
  })

  it('adds the active session to an empty layout', () => {
    expect(normalizeLayout(singleLayout(null), ['a'], 'a')).toEqual(singleLayout('a'))
  })

  it('stays empty only when there is no active session', () => {
    expect(normalizeLayout(singleLayout(null), ['a'], null)).toEqual(singleLayout(null))
  })

  it('repairs drifting sizes and invalid ones', () => {
    const drift = normalizeLayout(layout('row', ['a', 'b'], [3, 1]), ['a', 'b'], 'a')
    expectClose(drift.sizes, [0.75, 0.25])
    const invalid = normalizeLayout(layout('row', ['a', 'b'], [0, 0]), ['a', 'b'], 'a')
    expectClose(invalid.sizes, [0.5, 0.5])
  })

  it('preserves the direction', () => {
    const result = normalizeLayout(layout('column', ['a', 'b'], [0.5, 0.5]), ['a', 'b'], 'a')
    expect(result.direction).toBe('column')
  })
})

describe('splitWith', () => {
  it('opens a second pane next to the active one with the requested direction', () => {
    const result = splitWith(singleLayout('a'), 'a', 'b', 'row')
    expect(result).toEqual(layout('row', ['a', 'b'], [0.5, 0.5]))
  })

  it('keeps the current direction once already split', () => {
    const result = splitWith(layout('column', ['a', 'b'], [0.5, 0.5]), 'a', 'c', 'row')
    expect(result.direction).toBe('column')
    expect(result.paneIds).toEqual(['a', 'c', 'b'])
    expectClose(result.sizes, [1 / 3, 1 / 3, 1 / 3])
  })

  it('is a no-op for an already visible id, the same id, null active or a full layout', () => {
    const split = layout('row', ['a', 'b'], [0.5, 0.5])
    expect(splitWith(split, 'a', 'b', 'row')).toBe(split)
    expect(splitWith(split, 'a', 'a', 'row')).toBe(split)
    expect(splitWith(singleLayout('a'), null, 'b', 'row')).toEqual(singleLayout('a'))
    const full = layout('row', ['a', 'b', 'c', 'd'], [0.25, 0.25, 0.25, 0.25])
    expect(splitWith(full, 'a', 'e', 'row')).toBe(full)
  })
})

describe('addPane', () => {
  it('appends a pane with equal sizes', () => {
    expect(addPane(singleLayout('a'), 'b')).toEqual(layout('row', ['a', 'b'], [0.5, 0.5]))
  })

  it('creates a single pane from an empty layout', () => {
    expect(addPane(singleLayout(null), 'a')).toEqual(singleLayout('a'))
  })

  it('ignores duplicates and layouts at the cap', () => {
    const split = layout('row', ['a', 'b'], [0.5, 0.5])
    expect(addPane(split, 'a')).toBe(split)
    const full = layout('row', ['a', 'b', 'c', 'd'], [0.25, 0.25, 0.25, 0.25])
    expect(addPane(full, 'e')).toBe(full)
  })
})

describe('removePane', () => {
  it('collapses to a single layout when one pane remains', () => {
    const result = removePane(layout('row', ['a', 'b'], [0.5, 0.5]), 'a')
    expect(result).toEqual(singleLayout('b'))
  })

  it('removes the middle pane and renormalizes the sizes', () => {
    const result = removePane(layout('row', ['a', 'b', 'c'], [0.5, 0.25, 0.25]), 'b')
    expect(result.paneIds).toEqual(['a', 'c'])
    expectClose(result.sizes, [2 / 3, 1 / 3])
  })

  it('is a no-op for an unknown id', () => {
    const split = layout('row', ['a', 'b'], [0.5, 0.5])
    expect(removePane(split, 'x')).toBe(split)
  })

  it('removing the only pane yields an empty single layout', () => {
    expect(removePane(singleLayout('a'), 'a')).toEqual(singleLayout(null))
  })
})

describe('replacePane', () => {
  it('replaces a pane session in place', () => {
    const result = replacePane(layout('row', ['a', 'b'], [0.4, 0.6]), 'a', 'c')
    expect(result.paneIds).toEqual(['c', 'b'])
    expect(result.sizes).toEqual([0.4, 0.6])
  })

  it('swaps positions when the new id is already visible', () => {
    const result = replacePane(layout('row', ['a', 'b', 'c'], [0.3, 0.3, 0.4]), 'a', 'c')
    expect(result.paneIds).toEqual(['c', 'b', 'a'])
    expect(result.sizes).toEqual([0.3, 0.3, 0.4])
  })

  it('is a no-op for an unknown pane or the same id', () => {
    const split = layout('row', ['a', 'b'], [0.5, 0.5])
    expect(replacePane(split, 'x', 'c')).toBe(split)
    expect(replacePane(split, 'a', 'a')).toBe(split)
  })
})

describe('resizeBetween', () => {
  it('moves a divider and keeps the total at 1', () => {
    const result = resizeBetween(layout('row', ['a', 'b'], [0.5, 0.5]), 0, 0.2)
    expectClose(result.sizes, [0.7, 0.3])
  })

  it('clamps both sides to MIN_FRACTION', () => {
    const right = resizeBetween(layout('row', ['a', 'b'], [0.5, 0.5]), 0, 0.9)
    expectClose(right.sizes, [1 - MIN_FRACTION, MIN_FRACTION])
    const left = resizeBetween(layout('row', ['a', 'b'], [0.5, 0.5]), 0, -0.9)
    expectClose(left.sizes, [MIN_FRACTION, 1 - MIN_FRACTION])
  })

  it('only touches the two panes around the divider', () => {
    const result = resizeBetween(
      layout('row', ['a', 'b', 'c'], [0.2, 0.4, 0.4]),
      1,
      0.1
    )
    expectClose(result.sizes, [0.2, 0.5, 0.3])
  })

  it('is a no-op for invalid dividers, deltas or single-pane layouts', () => {
    const split = layout('row', ['a', 'b'], [0.5, 0.5])
    expect(resizeBetween(split, -1, 0.1)).toBe(split)
    expect(resizeBetween(split, 1, 0.1)).toBe(split)
    expect(resizeBetween(split, 0, Number.NaN)).toBe(split)
    const single = singleLayout('a')
    expect(resizeBetween(single, 0, 0.1)).toBe(single)
  })
})

describe('equalize', () => {
  it('gives every pane the same fraction', () => {
    expect(equalize(layout('column', ['a', 'b', 'c'], [0.5, 0.3, 0.2])).sizes).toEqual(
      equalSizes(3)
    )
  })
})

describe('pickPartner', () => {
  it('prefers the most recently used open session', () => {
    expect(pickPartner(['a', 'b', 'c'], 'a', ['c', 'b'])).toBe('c')
  })

  it('falls back to the first other open session', () => {
    expect(pickPartner(['a', 'b', 'c'], 'a', [])).toBe('b')
  })

  it('skips the active id and unknown recents', () => {
    expect(pickPartner(['a', 'b'], 'a', ['a', 'x'])).toBe('b')
  })

  it('returns null when there is no other open session', () => {
    expect(pickPartner(['a'], 'a', [])).toBeNull()
    expect(pickPartner([], null, [])).toBeNull()
  })
})

describe('parseLayout / serializeLayout', () => {
  it('round-trips a layout', () => {
    const original = layout('column', ['a', 'b'], [0.3, 0.7])
    expect(parseLayout(serializeLayout(original))).toEqual(original)
  })

  it('accepts an empty layout', () => {
    expect(parseLayout(serializeLayout(singleLayout(null)))).toEqual(singleLayout(null))
  })

  it('returns null for null, corrupt JSON and wrong shapes', () => {
    expect(parseLayout(null)).toBeNull()
    expect(parseLayout('not json')).toBeNull()
    expect(parseLayout('[]')).toBeNull()
    expect(parseLayout(JSON.stringify({ direction: 'diagonal', paneIds: [], sizes: [] }))).toBeNull()
    expect(parseLayout(JSON.stringify({ direction: 'row', paneIds: 'a', sizes: [] }))).toBeNull()
    expect(parseLayout(JSON.stringify({ direction: 'row', paneIds: ['a'], sizes: [] }))).toBeNull()
  })

  it('rejects duplicate, empty or too many pane ids', () => {
    expect(
      parseLayout(JSON.stringify({ direction: 'row', paneIds: ['a', 'a'], sizes: [0.5, 0.5] }))
    ).toBeNull()
    expect(
      parseLayout(JSON.stringify({ direction: 'row', paneIds: [''], sizes: [1] }))
    ).toBeNull()
    expect(
      parseLayout(
        JSON.stringify({ direction: 'row', paneIds: ['a', 'b', 'c', 'd', 'e'], sizes: [0.2, 0.2, 0.2, 0.2, 0.2] })
      )
    ).toBeNull()
  })

  it('rejects non-positive or non-finite sizes', () => {
    expect(
      parseLayout(JSON.stringify({ direction: 'row', paneIds: ['a'], sizes: [0] }))
    ).toBeNull()
    expect(
      parseLayout(JSON.stringify({ direction: 'row', paneIds: ['a'], sizes: ['x'] }))
    ).toBeNull()
  })
})
