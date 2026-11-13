import { describe, expect, it } from 'vitest'
import type { ShortcutContext, ShortcutKeyEvent } from '../shell/openTabsLogic'
import { decideAttentionShortcut, pickAttentionTarget } from './attentionNav'

const key = (over: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({ key: 'ArrowDown', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...over })
const ctx = (over: Partial<ShortcutContext> = {}): ShortcutContext => ({ dialogOpen: false, inputFocused: false, terminalFocused: false, ...over })

describe('decideAttentionShortcut', () => {
  it('Ctrl+Shift+Down is next and Ctrl+Shift+Up is previous, also with the terminal focused', () => {
    expect(decideAttentionShortcut(key({}), ctx())).toBe('next')
    expect(decideAttentionShortcut(key({ key: 'ArrowUp' }), ctx())).toBe('previous')
    expect(decideAttentionShortcut(key({}), ctx({ terminalFocused: true }))).toBe('next')
  })

  it('needs exactly Ctrl+Shift', () => {
    expect(decideAttentionShortcut(key({ ctrlKey: false }), ctx())).toBeNull()
    expect(decideAttentionShortcut(key({ shiftKey: false }), ctx())).toBeNull()
    expect(decideAttentionShortcut(key({ altKey: true }), ctx())).toBeNull()
    expect(decideAttentionShortcut(key({ metaKey: true }), ctx())).toBeNull()
    expect(decideAttentionShortcut(key({ key: 'ArrowLeft' }), ctx())).toBeNull()
    expect(decideAttentionShortcut(key({ key: 'a' }), ctx())).toBeNull()
  })

  it('does nothing while a dialog is open or a text field has the focus', () => {
    expect(decideAttentionShortcut(key({}), ctx({ dialogOpen: true }))).toBeNull()
    expect(decideAttentionShortcut(key({}), ctx({ inputFocused: true }))).toBeNull()
  })
})

describe('pickAttentionTarget', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('moves to the next / previous one in the list and wraps round', () => {
    expect(pickAttentionTarget(items, 'a', 1)).toBe('b')
    expect(pickAttentionTarget(items, 'b', 1)).toBe('c')
    expect(pickAttentionTarget(items, 'c', 1)).toBe('a')
    expect(pickAttentionTarget(items, 'a', -1)).toBe('c')
    expect(pickAttentionTarget(items, 'c', -1)).toBe('b')
  })

  it('from a session that does not need you (or none), next is the first and previous the last', () => {
    expect(pickAttentionTarget(items, 'z', 1)).toBe('a')
    expect(pickAttentionTarget(items, 'z', -1)).toBe('c')
    expect(pickAttentionTarget(items, null, 1)).toBe('a')
    expect(pickAttentionTarget(items, null, -1)).toBe('c')
  })

  it('is null when nothing needs you', () => {
    expect(pickAttentionTarget([], 'a', 1)).toBeNull()
    expect(pickAttentionTarget([], null, -1)).toBeNull()
  })

  it('is null when the only session that needs you is already on screen, but jumps to it from elsewhere', () => {
    expect(pickAttentionTarget([{ id: 'a' }], 'a', 1)).toBeNull()
    expect(pickAttentionTarget([{ id: 'a' }], 'a', -1)).toBeNull()
    expect(pickAttentionTarget([{ id: 'a' }], 'z', 1)).toBe('a')
  })
})
