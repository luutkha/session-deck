import { describe, expect, it } from 'vitest'
import {
  EMPTY_PREVIEW_HISTORY,
  PREVIEW_HISTORY_MAX,
  canPreviewBack,
  canPreviewForward,
  currentPreviewPath,
  forgetPreviewSession,
  previewHistoryReducer,
  previewHistoryShortcut,
  stepPreviewPath,
  type PreviewHistoryState
} from './previewHistory'

function push(state: PreviewHistoryState, sessionId: string, path: string): PreviewHistoryState {
  return previewHistoryReducer(state, { type: 'push', sessionId, path })
}

function back(state: PreviewHistoryState, sessionId: string): PreviewHistoryState {
  return previewHistoryReducer(state, { type: 'back', sessionId })
}

function forward(state: PreviewHistoryState, sessionId: string): PreviewHistoryState {
  return previewHistoryReducer(state, { type: 'forward', sessionId })
}

function forget(state: PreviewHistoryState, sessionId: string): PreviewHistoryState {
  return previewHistoryReducer(state, { type: 'forgetSession', sessionId })
}

function pathsOf(state: PreviewHistoryState, sessionId: string): readonly string[] {
  return state[sessionId]?.paths ?? []
}

describe('push', () => {
  it('starts empty: no preview and no navigation for a session never seen', () => {
    expect(currentPreviewPath(EMPTY_PREVIEW_HISTORY, 'a')).toBeNull()
    expect(canPreviewBack(EMPTY_PREVIEW_HISTORY, 'a')).toBe(false)
    expect(canPreviewForward(EMPTY_PREVIEW_HISTORY, 'a')).toBe(false)
  })

  it('shows the first pushed path at index 0', () => {
    const next = push(EMPTY_PREVIEW_HISTORY, 'a', 'C:\\p\\README.md')
    expect(currentPreviewPath(next, 'a')).toBe('C:\\p\\README.md')
    expect(pathsOf(next, 'a')).toEqual(['C:\\p\\README.md'])
    expect(next.a?.index).toBe(0)
    expect(canPreviewBack(next, 'a')).toBe(false)
    expect(canPreviewForward(next, 'a')).toBe(false)
  })

  it('keeps several files in order and shows the newest', () => {
    let state = push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md')
    state = push(state, 'a', 'two.md')
    state = push(state, 'a', 'three.md')
    expect(pathsOf(state, 'a')).toEqual(['one.md', 'two.md', 'three.md'])
    expect(currentPreviewPath(state, 'a')).toBe('three.md')
    expect(state.a?.index).toBe(2)
    expect(canPreviewBack(state, 'a')).toBe(true)
  })

  it('dedupes the path already on screen without growing the list', () => {
    const state = push(push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md'), 'a', 'two.md')
    const again = push(state, 'a', 'two.md')
    expect(again).toBe(state)
    expect(pathsOf(again, 'a')).toEqual(['one.md', 'two.md'])
    expect(currentPreviewPath(again, 'a')).toBe('two.md')
  })

  it('does not dedupe the same path after a different one in between', () => {
    let state = push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md')
    state = push(state, 'a', 'two.md')
    state = push(state, 'a', 'one.md')
    expect(pathsOf(state, 'a')).toEqual(['one.md', 'two.md', 'one.md'])
    expect(state.a?.index).toBe(2)
  })

  it('re-requesting the current path after Back keeps the forward entries', () => {
    let state = push(push(push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md'), 'a', 'two.md'), 'a', 'three.md')
    state = back(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBe('two.md')
    expect(push(state, 'a', 'two.md')).toBe(state)
    expect(pathsOf(state, 'a')).toEqual(['one.md', 'two.md', 'three.md'])
    expect(canPreviewForward(state, 'a')).toBe(true)
  })

  it('ignores a blank path', () => {
    const state = push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md')
    expect(push(state, 'a', '')).toBe(state)
    expect(push(state, 'a', '   ')).toBe(state)
    expect(push(EMPTY_PREVIEW_HISTORY, 'a', '  ')).toBe(EMPTY_PREVIEW_HISTORY)
  })

  it('drops the forward tail when a new file is opened after Back', () => {
    let state = push(push(push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md'), 'a', 'two.md'), 'a', 'three.md')
    state = back(state, 'a')
    state = back(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBe('one.md')
    state = push(state, 'a', 'four.md')
    expect(pathsOf(state, 'a')).toEqual(['one.md', 'four.md'])
    expect(state.a?.index).toBe(1)
    expect(canPreviewForward(state, 'a')).toBe(false)
  })

  it('keeps at most 20 entries, dropping the oldest', () => {
    let state = EMPTY_PREVIEW_HISTORY
    for (let i = 1; i <= PREVIEW_HISTORY_MAX + 5; i += 1) {
      state = push(state, 'a', `file-${String(i).padStart(2, '0')}.md`)
    }
    expect(state.a?.paths).toHaveLength(PREVIEW_HISTORY_MAX)
    expect(state.a?.paths[0]).toBe('file-06.md')
    expect(state.a?.index).toBe(PREVIEW_HISTORY_MAX - 1)
    expect(currentPreviewPath(state, 'a')).toBe('file-25.md')
    expect(canPreviewBack(state, 'a')).toBe(true)
  })

  it('does not trim the oldest entries when a push follows Back inside a full list', () => {
    let state = EMPTY_PREVIEW_HISTORY
    for (let i = 1; i <= PREVIEW_HISTORY_MAX; i += 1) state = push(state, 'a', `f${String(i)}.md`)
    state = back(state, 'a')
    state = back(state, 'a')
    state = back(state, 'a')
    state = push(state, 'a', 'new.md')
    expect(state.a?.paths).toHaveLength(PREVIEW_HISTORY_MAX - 2)
    expect(state.a?.paths[0]).toBe('f1.md')
    expect(currentPreviewPath(state, 'a')).toBe('new.md')
  })

  it('never mutates the state it was given', () => {
    const first = push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md')
    const second = push(first, 'a', 'two.md')
    expect(pathsOf(first, 'a')).toEqual(['one.md'])
    expect(pathsOf(second, 'a')).toEqual(['one.md', 'two.md'])
  })
})

describe('Back / Forward', () => {
  function three(): PreviewHistoryState {
    return push(push(push(EMPTY_PREVIEW_HISTORY, 'a', 'one.md'), 'a', 'two.md'), 'a', 'three.md')
  }

  it('steps one entry at a time in both directions', () => {
    let state = three()
    state = back(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBe('two.md')
    state = back(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBe('one.md')
    state = forward(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBe('two.md')
    state = forward(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBe('three.md')
  })

  it('returns the same state at the ends and for a session with no history', () => {
    const state = three()
    expect(back(EMPTY_PREVIEW_HISTORY, 'a')).toBe(EMPTY_PREVIEW_HISTORY)
    expect(forward(EMPTY_PREVIEW_HISTORY, 'a')).toBe(EMPTY_PREVIEW_HISTORY)
    expect(back(state, 'missing')).toBe(state)
    expect(forward(state, 'missing')).toBe(state)
    const first = back(back(state, 'a'), 'a')
    expect(back(first, 'a')).toBe(first)
    const last = forward(first, 'a')
    const end = forward(forward(last, 'a'), 'a')
    expect(forward(end, 'a')).toBe(end)
  })

  it('does not change the stored paths when moving the cursor', () => {
    const state = three()
    const moved = back(state, 'a')
    expect(moved.a?.paths).toBe(state.a?.paths)
    expect(moved.a?.index).toBe(1)
    expect(state.a?.index).toBe(2)
  })

  it('exposes the button states around the cursor', () => {
    const state = three()
    expect(canPreviewBack(state, 'a')).toBe(true)
    expect(canPreviewForward(state, 'a')).toBe(false)
    const first = back(back(state, 'a'), 'a')
    expect(canPreviewBack(first, 'a')).toBe(false)
    expect(canPreviewForward(first, 'a')).toBe(true)
  })

  it('uses the same step function for both shortcuts', () => {
    const state = three()
    expect(stepPreviewPath(state, 'a', -1)).toEqual(back(state, 'a'))
    expect(stepPreviewPath(state, 'a', 1)).toEqual(forward(state, 'a'))
  })
})

describe('one history per session', () => {
  it('keeps independent lists and cursors', () => {
    let state = push(EMPTY_PREVIEW_HISTORY, 'a', 'a1.md')
    state = push(state, 'a', 'a2.md')
    state = push(state, 'b', 'b1.md')
    expect(pathsOf(state, 'a')).toEqual(['a1.md', 'a2.md'])
    expect(pathsOf(state, 'b')).toEqual(['b1.md'])
    expect(currentPreviewPath(state, 'a')).toBe('a2.md')
    expect(currentPreviewPath(state, 'b')).toBe('b1.md')
    expect(currentPreviewPath(state, 'c')).toBeNull()
    state = back(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBe('a1.md')
    expect(currentPreviewPath(state, 'b')).toBe('b1.md')
  })

  it('does not dedupe the same path across different sessions', () => {
    const state = push(push(EMPTY_PREVIEW_HISTORY, 'a', 'same.md'), 'b', 'same.md')
    expect(pathsOf(state, 'a')).toEqual(['same.md'])
    expect(pathsOf(state, 'b')).toEqual(['same.md'])
    expect(currentPreviewPath(state, 'b')).toBe('same.md')
  })
})

describe('forgetSession', () => {
  it('drops only the removed session and keeps the others', () => {
    let state = push(push(EMPTY_PREVIEW_HISTORY, 'a', 'a1.md'), 'b', 'b1.md')
    state = forget(state, 'a')
    expect(currentPreviewPath(state, 'a')).toBeNull()
    expect(state.a).toBeUndefined()
    expect(currentPreviewPath(state, 'b')).toBe('b1.md')
    expect(pathsOf(state, 'b')).toEqual(['b1.md'])
  })

  it('is a no-op for a session that is not remembered', () => {
    const state = push(EMPTY_PREVIEW_HISTORY, 'a', 'a1.md')
    expect(forget(state, 'b')).toBe(state)
    expect(forgetPreviewSession(EMPTY_PREVIEW_HISTORY, 'a')).toBe(EMPTY_PREVIEW_HISTORY)
    // 'toString' is an inherited key: it must not be mistaken for a remembered session.
    expect(forget(state, 'toString')).toBe(state)
  })

  it('leaves an empty state after the last session is removed', () => {
    const state = forget(push(EMPTY_PREVIEW_HISTORY, 'a', 'a1.md'), 'a')
    expect(state).toEqual({})
    expect(currentPreviewPath(state, 'a')).toBeNull()
  })
})

describe('previewHistoryShortcut', () => {
  it('maps Alt+Left / Alt+Right to Back / Forward', () => {
    expect(previewHistoryShortcut({ key: 'ArrowLeft', altKey: true })).toBe(-1)
    expect(previewHistoryShortcut({ key: 'ArrowRight', altKey: true })).toBe(1)
  })

  it('leaves plain arrows and other keys alone', () => {
    expect(previewHistoryShortcut({ key: 'ArrowLeft', altKey: false })).toBeNull()
    expect(previewHistoryShortcut({ key: 'ArrowRight', altKey: false })).toBeNull()
    expect(previewHistoryShortcut({ key: 'a', altKey: true })).toBeNull()
    expect(previewHistoryShortcut({ key: 'ArrowUp', altKey: true })).toBeNull()
  })

  it('does not steal Ctrl+Alt, Meta+Alt or Shift+Alt combinations', () => {
    expect(previewHistoryShortcut({ key: 'ArrowLeft', altKey: true, ctrlKey: true })).toBeNull()
    expect(previewHistoryShortcut({ key: 'ArrowRight', altKey: true, metaKey: true })).toBeNull()
    expect(previewHistoryShortcut({ key: 'ArrowLeft', altKey: true, shiftKey: true })).toBeNull()
  })
})
