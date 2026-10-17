import { describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import {
  EMPTY_OPEN_TABS,
  cycleTab,
  decideTabShortcut,
  openTab,
  parseOpenTabs,
  pruneOpenTabs,
  removeTabs,
  serializeOpenTabs,
  type OpenTabsState,
  type ShortcutKeyEvent
} from './openTabsLogic'

function session(id: string, closedAt?: number): Session {
  return {
    id,
    name: `name ${id}`,
    cwd: 'C:\\work',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...(closedAt === undefined ? {} : { closedAt })
  }
}

function tabs(ids: readonly string[], activeId: string | null): OpenTabsState {
  return { ids, activeId }
}

describe('openTab', () => {
  it('appends a new id and makes it active', () => {
    expect(openTab(tabs(['a'], 'a'), 'b')).toEqual(tabs(['a', 'b'], 'b'))
  })

  it('does not duplicate an id that is already open but still activates it', () => {
    expect(openTab(tabs(['a', 'b'], 'a'), 'b')).toEqual(tabs(['a', 'b'], 'b'))
  })

  it('does not mutate the input state', () => {
    const input = tabs(['a'], 'a')
    openTab(input, 'b')
    expect(input).toEqual(tabs(['a'], 'a'))
  })
})

describe('removeTabs (closing picks neighbours)', () => {
  it('activates the right neighbour when the active tab closes', () => {
    const result = removeTabs(tabs(['a', 'b', 'c'], 'b'), ['b'])
    expect(result.nextActiveId).toBe('c')
    expect(result.state).toEqual(tabs(['a', 'c'], 'c'))
  })

  it('falls back to the left neighbour when the rightmost tab closes', () => {
    const result = removeTabs(tabs(['a', 'b', 'c'], 'c'), ['c'])
    expect(result.nextActiveId).toBe('b')
    expect(result.state).toEqual(tabs(['a', 'b'], 'b'))
  })

  it('leaves no active tab when the last tab closes', () => {
    const result = removeTabs(tabs(['a'], 'a'), ['a'])
    expect(result.nextActiveId).toBeNull()
    expect(result.state).toEqual(EMPTY_OPEN_TABS)
  })

  it('keeps the active tab when a non-active tab closes', () => {
    const result = removeTabs(tabs(['a', 'b', 'c'], 'a'), ['c'])
    expect(result.nextActiveId).toBe('a')
    expect(result.state).toEqual(tabs(['a', 'b'], 'a'))
  })

  it('skips neighbours that are removed in the same batch', () => {
    const result = removeTabs(tabs(['a', 'b', 'c', 'd'], 'b'), ['b', 'c'])
    expect(result.nextActiveId).toBe('d')
    expect(result.state).toEqual(tabs(['a', 'd'], 'd'))
  })

  it('returns the same state object when nothing it holds is removed', () => {
    const input = tabs(['a'], 'a')
    expect(removeTabs(input, ['zzz']).state).toBe(input)
  })

  it('does not mutate the input state', () => {
    const input = tabs(['a', 'b'], 'a')
    removeTabs(input, ['a'])
    expect(input).toEqual(tabs(['a', 'b'], 'a'))
  })
})

describe('closing every other tab (batch remove)', () => {
  it('keeps only the chosen tab and makes it active when it was not active', () => {
    const others = ['a', 'b']
    expect(removeTabs(tabs(['a', 'b', 'c'], 'a'), others).state).toEqual(tabs(['c'], 'c'))
  })

  it('keeps the chosen tab active when it already was', () => {
    expect(removeTabs(tabs(['a', 'b', 'c'], 'c'), ['a', 'b']).state).toEqual(tabs(['c'], 'c'))
  })
})

describe('cycleTab', () => {
  it('moves forward and wraps to the first tab', () => {
    expect(cycleTab(tabs(['a', 'b', 'c'], 'b'), 1)).toEqual(tabs(['a', 'b', 'c'], 'c'))
    expect(cycleTab(tabs(['a', 'b', 'c'], 'c'), 1)).toEqual(tabs(['a', 'b', 'c'], 'a'))
  })

  it('moves backward and wraps to the last tab', () => {
    expect(cycleTab(tabs(['a', 'b', 'c'], 'a'), -1)).toEqual(tabs(['a', 'b', 'c'], 'c'))
  })

  it('starts from the first tab when nothing is active', () => {
    expect(cycleTab(tabs(['a', 'b'], null), 1)).toEqual(tabs(['a', 'b'], 'a'))
  })

  it('is a no-op with no tabs', () => {
    expect(cycleTab(EMPTY_OPEN_TABS, 1)).toEqual(EMPTY_OPEN_TABS)
  })
})

describe('pruneOpenTabs', () => {
  it('drops tabs whose session no longer exists', () => {
    const result = pruneOpenTabs(tabs(['a', 'b'], 'b'), [session('a')])
    expect(result).toEqual(tabs(['a'], 'a'))
  })

  it('drops tabs whose session is closed', () => {
    const result = pruneOpenTabs(tabs(['a', 'b'], 'a'), [session('a'), session('b', 123)])
    expect(result).toEqual(tabs(['a'], 'a'))
  })

  it('keeps the state object when every tab is still live', () => {
    const input = tabs(['a'], 'a')
    expect(pruneOpenTabs(input, [session('a')])).toBe(input)
  })

  it('clears the active id when every tab is pruned', () => {
    expect(pruneOpenTabs(tabs(['a'], 'a'), [])).toEqual(EMPTY_OPEN_TABS)
  })
})

describe('parseOpenTabs (restore from localStorage)', () => {
  it('returns empty tabs when nothing is stored', () => {
    expect(parseOpenTabs(null)).toEqual(EMPTY_OPEN_TABS)
  })

  it('returns empty tabs for corrupt JSON', () => {
    expect(parseOpenTabs('{not json')).toEqual(EMPTY_OPEN_TABS)
  })

  it('returns empty tabs when the JSON has the wrong shape', () => {
    expect(parseOpenTabs('"hello"')).toEqual(EMPTY_OPEN_TABS)
    expect(parseOpenTabs('{"ids":"a"}')).toEqual(EMPTY_OPEN_TABS)
    expect(parseOpenTabs('null')).toEqual(EMPTY_OPEN_TABS)
  })

  it('drops non-string and empty ids and removes duplicates', () => {
    const parsed = parseOpenTabs('{"ids":["a",1,"",null,"a","b"],"activeId":"b"}')
    expect(parsed).toEqual(tabs(['a', 'b'], 'b'))
  })

  it('falls back to the first id when the stored active id is not open', () => {
    expect(parseOpenTabs('{"ids":["a","b"],"activeId":"zzz"}')).toEqual(tabs(['a', 'b'], 'a'))
  })

  it('keeps a null active id when there are no tabs', () => {
    expect(parseOpenTabs('{"ids":[],"activeId":null}')).toEqual(EMPTY_OPEN_TABS)
  })

  it('round-trips through serializeOpenTabs', () => {
    const state = tabs(['x', 'y'], 'y')
    expect(parseOpenTabs(serializeOpenTabs(state))).toEqual(state)
  })
})

function key(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { key: 'a', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...overrides }
}

const FREE = { dialogOpen: false, inputFocused: false }

describe('decideTabShortcut', () => {
  it('maps Ctrl+W to closing the active tab', () => {
    expect(decideTabShortcut(key({ key: 'w' }), FREE)).toBe('close-active')
    expect(decideTabShortcut(key({ key: 'W' }), FREE)).toBe('close-active')
  })

  it('maps Ctrl+Tab to the next tab and Ctrl+Shift+Tab to the previous tab', () => {
    expect(decideTabShortcut(key({ key: 'Tab' }), FREE)).toBe('next-tab')
    expect(decideTabShortcut(key({ key: 'Tab', shiftKey: true }), FREE)).toBe('previous-tab')
  })

  it('ignores plain keys and Ctrl-less keys', () => {
    expect(decideTabShortcut(key({ key: 'w', ctrlKey: false }), FREE)).toBeNull()
    expect(decideTabShortcut(key({ key: 'x' }), FREE)).toBeNull()
  })

  it('lets plain Ctrl+W reach the terminal (readline delete-word) but Ctrl+Shift+W still closes the tab', () => {
    const inTerminal = { dialogOpen: false, inputFocused: false, terminalFocused: true }
    expect(decideTabShortcut(key({ key: 'w' }), inTerminal)).toBeNull()
    expect(decideTabShortcut(key({ key: 'w', shiftKey: true }), inTerminal)).toBe('close-active')
    expect(decideTabShortcut(key({ key: 'W', shiftKey: true }), FREE)).toBe('close-active')
  })

  it('keeps Ctrl+Tab cycling while the terminal has focus', () => {
    const inTerminal = { dialogOpen: false, inputFocused: false, terminalFocused: true }
    expect(decideTabShortcut(key({ key: 'Tab' }), inTerminal)).toBe('next-tab')
  })

  it('ignores combinations with Alt or Meta', () => {
    expect(decideTabShortcut(key({ key: 'w', altKey: true }), FREE)).toBeNull()
    expect(decideTabShortcut(key({ key: 'Tab', metaKey: true }), FREE)).toBeNull()
  })

  it('ignores every shortcut while a dialog is open', () => {
    const dialog = { dialogOpen: true, inputFocused: false }
    expect(decideTabShortcut(key({ key: 'w' }), dialog)).toBeNull()
    expect(decideTabShortcut(key({ key: 'Tab' }), dialog)).toBeNull()
  })

  it('ignores every shortcut while a text input has focus', () => {
    const typing = { dialogOpen: false, inputFocused: true }
    expect(decideTabShortcut(key({ key: 'w' }), typing)).toBeNull()
    expect(decideTabShortcut(key({ key: 'Tab' }), typing)).toBeNull()
  })
})
