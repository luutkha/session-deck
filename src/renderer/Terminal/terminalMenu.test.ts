import { describe, expect, it } from 'vitest'
import { DEFAULT_RIGHT_CLICK, parseRightClickMode } from './rightClickPref'
import { isOpeningGesture, menuRows } from './terminalMenuLogic'
import type { Session } from '../../shared/types'

const session = (extra: Partial<Session> = {}): Session =>
  ({ id: 'a', name: 'A', cwd: 'C:/work', groupId: null, statusId: null, createdAt: 0, ...extra }) as Session

describe('right-click preference (D59)', () => {
  it('defaults to the menu, like Orca', () => {
    expect(DEFAULT_RIGHT_CLICK).toBe('menu')
    expect(parseRightClickMode(null)).toBe('menu')
    expect(parseRightClickMode('garbage')).toBe('menu')
  })

  it('reads a stored choice', () => {
    expect(parseRightClickMode('paste')).toBe('paste')
    expect(parseRightClickMode('menu')).toBe('menu')
  })
})

describe('menuRows (D59)', () => {
  it('offers Split only when the workspace can split', () => {
    expect(menuRows('a', session(), true, ['a']).split).toBe(true)
    expect(menuRows('a', session(), false, ['a']).split).toBe(false)
  })

  it('offers Close Pane only for a pane among two or more on screen', () => {
    expect(menuRows('a', session(), false, ['a', 'b']).closePane).toBe(true)
    expect(menuRows('a', session(), false, ['a']).closePane).toBe(false)
    expect(menuRows('c', session({ id: 'c' }), false, ['a', 'b']).closePane).toBe(false)
    expect(menuRows('a', session(), false, []).closePane).toBe(false)
  })

  it('offers Fork for a Claude session with a saved conversation, never Jarvis', () => {
    expect(menuRows('a', session({ claudeSessionId: 'x1' }), false, []).fork).toBe(true)
    expect(menuRows('a', session({ agent: 'claude', claudeSessionId: 'x1' }), false, []).fork).toBe(true)
    expect(menuRows('a', session(), false, []).fork).toBe(false)
    expect(menuRows('a', session({ agent: 'shell', claudeSessionId: 'x1' }), false, []).fork).toBe(false)
    expect(menuRows('a', session({ role: 'jarvis', claudeSessionId: 'x1' }), false, []).fork).toBe(false)
    expect(menuRows('a', undefined, false, []).fork).toBe(false)
  })

  it('offers Fork for an OpenCode session with a saved conversation (D79: a copy)', () => {
    expect(menuRows('a', session({ agent: 'opencode', opencodeSessionId: 'ses_abc12345678' }), false, []).fork).toBe(true)
    expect(menuRows('a', session({ agent: 'opencode' }), false, []).fork).toBe(false)
    expect(menuRows('a', session({ agent: 'opencode', opencodeSessionId: 'ses_abc12345678', role: 'jarvis' }), false, []).fork).toBe(false)
  })
})

describe('isOpeningGesture', () => {
  it('ignores the opening click for 100 ms only', () => {
    expect(isOpeningGesture(1000, 1050)).toBe(true)
    expect(isOpeningGesture(1000, 1100)).toBe(false)
  })
})
