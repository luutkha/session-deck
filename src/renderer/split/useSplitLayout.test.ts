import { describe, expect, it } from 'vitest'
import type { Id } from '../../shared/types'
import {
  createLayoutPersistence,
  initSplitState,
  splitReducer,
  type SplitAction,
  type SplitState
} from './useSplitLayout'
import { equalSizes, resizeBetween, serializeLayout, singleLayout, type SplitLayout } from './splitLogic'

function layout(
  direction: 'row' | 'column',
  paneIds: readonly Id[],
  sizes: readonly number[]
): SplitLayout {
  return { direction, paneIds, sizes }
}

function state(
  openIds: readonly Id[],
  activeId: Id | null,
  layoutValue: SplitLayout,
  recentIds?: readonly Id[]
): SplitState {
  return {
    layout: layoutValue,
    openIds,
    activeId,
    recentIds: recentIds ?? (activeId === null ? [] : [activeId])
  }
}

function run(from: SplitState, action: SplitAction): SplitState {
  return splitReducer(from, action)
}

describe('initSplitState', () => {
  it('normalizes against the open sessions and tracks the active id', () => {
    const result = initSplitState(['a', 'b'], 'a', layout('row', ['x', 'b'], [0.5, 0.5]))
    expect(result.layout.paneIds).toEqual(['a'])
    expect(result.activeId).toBe('a')
    expect(result.recentIds).toEqual(['a'])
  })
})

describe('splitReducer sync', () => {
  it('drops closed sessions and keeps the active one visible', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'sync', openIds: ['b'], activeId: 'b' })
    expect(after.layout.paneIds).toEqual(['b'])
    expect(after.openIds).toEqual(['b'])
  })

  it('records the newly active session first and prunes closed recents', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]), ['x', 'a'])
    const after = run(before, { type: 'sync', openIds: ['a', 'b'], activeId: 'b' })
    expect(after.recentIds).toEqual(['b', 'a'])
  })

  it('replaces the last pane when the active session is outside the layout', () => {
    const before = state(['a', 'b', 'c'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'sync', openIds: ['a', 'b', 'c'], activeId: 'c' })
    expect(after.layout.paneIds).toEqual(['a', 'c'])
  })
})

describe('splitReducer split / unsplit', () => {
  it('splits with the most recent other session', () => {
    const before = state(['a', 'b', 'c'], 'a', singleLayout('a'), ['a', 'c', 'b'])
    const after = run(before, { type: 'split', direction: 'row' })
    expect(after.layout).toEqual(layout('row', ['a', 'c'], [0.5, 0.5]))
  })

  it('uses the requested direction down', () => {
    const before = state(['a', 'b'], 'a', singleLayout('a'))
    const after = run(before, { type: 'split', direction: 'column' })
    expect(after.layout.direction).toBe('column')
    expect(after.layout.paneIds).toEqual(['a', 'b'])
  })

  it('is a no-op without another open session', () => {
    const before = state(['a'], 'a', singleLayout('a'))
    expect(run(before, { type: 'split', direction: 'row' })).toBe(before)
  })

  it('collapses back to the active session', () => {
    const before = state(['a', 'b'], 'b', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'unsplit' })
    expect(after.layout).toEqual(singleLayout('b'))
  })
})

describe('splitReducer openToSide', () => {
  it('opens a new session to the side using the fallback direction', () => {
    const before = state(['a', 'b'], 'a', singleLayout('a'))
    const after = run(before, { type: 'openToSide', id: 'b' })
    expect(after.layout).toEqual(layout('row', ['a', 'b'], [0.5, 0.5]))
  })

  it('respects an explicit direction when not split', () => {
    const before = state(['a', 'b'], 'a', singleLayout('a'))
    const after = run(before, { type: 'openToSide', id: 'b', direction: 'column' })
    expect(after.layout.direction).toBe('column')
  })

  it('is a no-op for an already visible or unknown id', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    expect(run(before, { type: 'openToSide', id: 'b' })).toBe(before)
    expect(run(before, { type: 'openToSide', id: 'z' })).toBe(before)
  })
})

describe('splitReducer removePane', () => {
  it('removes a non-active pane', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'removePane', id: 'b' })
    expect(after.layout.paneIds).toEqual(['a'])
  })

  it('keeps the active session visible even when it is the removed pane', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'removePane', id: 'a' })
    expect(after.layout.paneIds).toEqual(['a'])
  })
})

describe('splitReducer showInPane', () => {
  it('just focuses an already visible session', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'showInPane', id: 'b' })
    expect(after.activeId).toBe('b')
    expect(after.layout).toBe(before.layout)
  })

  it('replaces the active pane when split and the session is not visible', () => {
    const before = state(['a', 'b', 'c'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'showInPane', id: 'c' })
    expect(after.layout.paneIds).toEqual(['c', 'b'])
    expect(after.activeId).toBe('c')
  })

  it('becomes the only pane when not split', () => {
    const before = state(['a', 'b'], 'a', singleLayout('a'))
    const after = run(before, { type: 'showInPane', id: 'b' })
    expect(after.layout).toEqual(singleLayout('b'))
  })

  it('is a no-op for an unknown id', () => {
    const before = state(['a'], 'a', singleLayout('a'))
    expect(run(before, { type: 'showInPane', id: 'z' })).toBe(before)
  })
})

describe('splitReducer sizes', () => {
  it('applies a valid size array', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const after = run(before, { type: 'setSizes', sizes: [0.7, 0.3] })
    expect(after.layout.sizes).toEqual([0.7, 0.3])
  })

  it('ignores a size array of the wrong length', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    expect(run(before, { type: 'setSizes', sizes: [1] })).toBe(before)
  })

  it('resizes around a divider and equalizes', () => {
    const before = state(['a', 'b'], 'a', layout('row', ['a', 'b'], [0.5, 0.5]))
    const resized = run(before, { type: 'resize', dividerIndex: 0, delta: 0.2 })
    expect(resized.layout.sizes).toEqual([0.7, 0.3])
    const equalized = run(resized, { type: 'equalize' })
    expect(equalized.layout.sizes).toEqual(equalSizes(2))
  })
})

describe('layout write policy (deferred drag)', () => {
  const key = 'sessiondeck.split.v1'

  it('N drag moves cause 0 writes and the drag end writes the final layout exactly once', () => {
    const writes: Array<{ readonly key: string; readonly value: string }> = []
    const writer = createLayoutPersistence((storageKey, value) => void writes.push({ key: storageKey, value }))
    let live = layout('row', ['a', 'b'], [0.5, 0.5])
    writer.changed(key, serializeLayout(live))
    expect(writes).toHaveLength(1)

    writer.defer()
    for (let frame = 0; frame < 60; frame += 1) {
      live = resizeBetween(live, 0, 0.005)
      writer.changed(key, serializeLayout(live))
    }
    expect(writes).toHaveLength(1)

    writer.commit(key, serializeLayout(live))
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual({ key, value: serializeLayout(live) })
    // An effect flushed after the commit, or a lostpointercapture echo, must not write again.
    writer.changed(key, serializeLayout(live))
    writer.commit(key, serializeLayout(live))
    expect(writes).toHaveLength(2)
  })

  it('keyboard resize writes immediately, even if a drag was in progress', () => {
    const writes: string[] = []
    const writer = createLayoutPersistence((_key, value) => void writes.push(value))
    const start = layout('row', ['a', 'b'], [0.5, 0.5])
    writer.changed(key, serializeLayout(start))
    writer.defer()
    const dragged = resizeBetween(start, 0, 0.1)
    writer.changed(key, serializeLayout(dragged))
    expect(writes).toHaveLength(1)

    writer.resume()
    const nudged = resizeBetween(dragged, 0, 0.02)
    writer.changed(key, serializeLayout(nudged))
    expect(writes).toHaveLength(2)
    expect(writes[1]).toBe(serializeLayout(nudged))
    writer.commit(key, serializeLayout(nudged))
    expect(writes).toHaveLength(2)
  })

  it('a write with no pending drag is a no-op, and a new storage key still writes', () => {
    const writes: Array<{ readonly key: string; readonly value: string }> = []
    const writer = createLayoutPersistence((storageKey, value) => void writes.push({ key: storageKey, value }))
    writer.commit(key, 'value')
    expect(writes).toEqual([])
    writer.changed(key, 'value')
    writer.changed(key, 'value')
    expect(writes).toEqual([{ key, value: 'value' }])
    writer.changed('other.key', 'value')
    expect(writes).toEqual([
      { key, value: 'value' },
      { key: 'other.key', value: 'value' }
    ])
  })
})
