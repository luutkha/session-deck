import { describe, it, expect } from 'vitest'
import type { AttentionReason, Id } from '../../shared/types'
import {
  decideNewSessionShortcut,
  type NewSessionShortcutEvent,
  resolveDropPosition,
  clampMenuPosition,
  toggleStatusFilter,
  moveFocus,
  shouldHandleGlobalShortcut,
  lastPathSegment,
  attentionLabel,
  attentionClass,
  attentionAriaLabel,
  runIndicatorClass,
  runDotAriaLabel,
  statusSectionColor,
  DEFAULT_GROUP_NAME
} from './uiLogic'

describe('resolveDropPosition', () => {
  it('returns before when the pointer is above the midpoint', () => {
    expect(resolveDropPosition(10, 0, 40)).toBe('before')
  })

  it('returns after when the pointer is below the midpoint', () => {
    expect(resolveDropPosition(30, 0, 40)).toBe('after')
  })

  it('returns after exactly at the midpoint', () => {
    expect(resolveDropPosition(20, 0, 40)).toBe('after')
  })

  it('accounts for a non-zero top offset', () => {
    expect(resolveDropPosition(104, 100, 10)).toBe('before')
    expect(resolveDropPosition(106, 100, 10)).toBe('after')
  })

  it('handles zero height rows (midpoint equals top)', () => {
    expect(resolveDropPosition(99, 100, 0)).toBe('before')
    expect(resolveDropPosition(101, 100, 0)).toBe('after')
  })
})

describe('clampMenuPosition', () => {
  it('leaves a position that fits unchanged', () => {
    expect(clampMenuPosition(50, 50, 100, 100, 1000, 800)).toEqual({ x: 50, y: 50 })
  })

  it('clamps to the left/top margin when coordinates are negative', () => {
    expect(clampMenuPosition(-20, -5, 100, 100, 1000, 800)).toEqual({ x: 4, y: 4 })
  })

  it('clamps so the menu stays fully inside the right/bottom edge', () => {
    expect(clampMenuPosition(990, 780, 200, 150, 1000, 800)).toEqual({ x: 796, y: 646 })
  })

  it('collapses to the margin when the menu is larger than the viewport', () => {
    expect(clampMenuPosition(500, 500, 2000, 2000, 1000, 800)).toEqual({ x: 4, y: 4 })
  })
})

describe('toggleStatusFilter', () => {
  it('adds an id that is not selected', () => {
    const result = toggleStatusFilter(new Set<Id | null>(), 'todo')
    expect([...result]).toEqual(['todo'])
  })

  it('removes an id that is already selected', () => {
    const result = toggleStatusFilter(new Set<Id | null>(['todo', 'done']), 'todo')
    expect([...result]).toEqual(['done'])
  })

  it('supports the null (None) bucket', () => {
    const added = toggleStatusFilter(new Set<Id | null>(), null)
    expect(added.has(null)).toBe(true)
    const removed = toggleStatusFilter(added, null)
    expect(removed.has(null)).toBe(false)
  })

  it('does not mutate the original set', () => {
    const original = new Set<Id | null>(['todo'])
    toggleStatusFilter(original, 'done')
    expect([...original]).toEqual(['todo'])
  })
})

describe('shouldHandleGlobalShortcut', () => {
  it('handles the shortcut when no target and no modal', () => {
    expect(shouldHandleGlobalShortcut(null, false)).toBe(true)
  })

  it('handles the shortcut when the target is a non-editable element', () => {
    expect(shouldHandleGlobalShortcut({ tagName: 'BUTTON' }, false)).toBe(true)
    expect(shouldHandleGlobalShortcut({ tagName: 'DIV' }, false)).toBe(true)
  })

  it('ignores the shortcut while an input, textarea or select is focused', () => {
    expect(shouldHandleGlobalShortcut({ tagName: 'INPUT' }, false)).toBe(false)
    expect(shouldHandleGlobalShortcut({ tagName: 'TEXTAREA' }, false)).toBe(false)
    expect(shouldHandleGlobalShortcut({ tagName: 'SELECT' }, false)).toBe(false)
  })

  it('ignores the shortcut for a contenteditable target', () => {
    expect(shouldHandleGlobalShortcut({ tagName: 'DIV', isContentEditable: true }, false)).toBe(false)
  })

  it('ignores the shortcut while a modal is open regardless of target', () => {
    expect(shouldHandleGlobalShortcut(null, true)).toBe(false)
    expect(shouldHandleGlobalShortcut({ tagName: 'BUTTON' }, true)).toBe(false)
    expect(shouldHandleGlobalShortcut({ tagName: 'INPUT' }, true)).toBe(false)
  })

  it('treats a lowercase tag name case-insensitively', () => {
    expect(shouldHandleGlobalShortcut({ tagName: 'input' }, false)).toBe(false)
  })
})

describe('moveFocus', () => {
  const ids: readonly Id[] = ['a', 'b', 'c']

  it('returns null for an empty list', () => {
    expect(moveFocus([], 'a', 1)).toBeNull()
  })

  it('selects the first item when moving down with no active id', () => {
    expect(moveFocus(ids, null, 1)).toBe('a')
  })

  it('selects the last item when moving up with no active id', () => {
    expect(moveFocus(ids, null, -1)).toBe('c')
  })

  it('moves down one item', () => {
    expect(moveFocus(ids, 'a', 1)).toBe('b')
  })

  it('moves up one item', () => {
    expect(moveFocus(ids, 'c', -1)).toBe('b')
  })

  it('clamps at the bottom', () => {
    expect(moveFocus(ids, 'c', 1)).toBe('c')
  })

  it('clamps at the top', () => {
    expect(moveFocus(ids, 'a', -1)).toBe('a')
  })

  it('starts from the first item when the active id is not in the list', () => {
    expect(moveFocus(ids, 'zzz', 1)).toBe('a')
    expect(moveFocus(ids, 'zzz', -1)).toBe('c')
  })
})

describe('lastPathSegment', () => {
  it('returns the final segment of a windows path', () => {
    expect(lastPathSegment('C:\\Users\\me\\project')).toBe('project')
  })

  it('returns the final segment of a unix path', () => {
    expect(lastPathSegment('/home/me/project')).toBe('project')
  })

  it('ignores trailing separators', () => {
    expect(lastPathSegment('C:\\Users\\me\\project\\')).toBe('project')
    expect(lastPathSegment('/home/me/project/')).toBe('project')
  })

  it('returns the input when it is a bare name', () => {
    expect(lastPathSegment('project')).toBe('project')
  })

  it('falls back to the input for a root path', () => {
    expect(lastPathSegment('/')).toBe('/')
  })

  it('returns the input for an empty string', () => {
    expect(lastPathSegment('')).toBe('')
  })
})

describe('attentionLabel', () => {
  it('labels each reason', () => {
    expect(attentionLabel('permission')).toBe('Needs attention: permission')
    expect(attentionLabel('done')).toBe('Needs attention: finished')
    expect(attentionLabel('idle')).toBe('Needs attention: idle')
    expect(attentionLabel('bell')).toBe('Needs attention: bell')
  })
})

describe('attentionClass', () => {
  const reasons: readonly AttentionReason[] = ['permission', 'done', 'idle', 'bell']

  it('returns a tailwind utility class for every reason', () => {
    for (const reason of reasons) {
      expect(attentionClass(reason)).toMatch(/^bg-/)
    }
  })

  it('maps permission to warning', () => {
    expect(attentionClass('permission')).toBe('bg-status-warning')
  })

  it('maps done to success', () => {
    expect(attentionClass('done')).toBe('bg-status-success')
  })
})

describe('attentionAriaLabel', () => {
  it('labels each reason', () => {
    expect(attentionAriaLabel('permission')).toBe('Needs attention: permission')
    expect(attentionAriaLabel('done')).toBe('Needs attention: finished')
    expect(attentionAriaLabel('idle')).toBe('Needs attention: idle')
    expect(attentionAriaLabel('bell')).toBe('Needs attention: bell')
  })
})

describe('runIndicatorClass', () => {
  it('maps running to a positive color', () => {
    expect(runIndicatorClass('running')).toBe('bg-status-success')
  })

  it('maps exited to destructive', () => {
    expect(runIndicatorClass('exited')).toBe('bg-destructive')
  })
})

describe('runDotAriaLabel', () => {
  it('maps running to "Running"', () => {
    expect(runDotAriaLabel('running')).toBe('Running')
  })

  it('maps exited to "Exited"', () => {
    expect(runDotAriaLabel('exited')).toBe('Exited')
  })
})

describe('statusSectionColor', () => {
  const statuses = [
    { id: 'todo', name: 'Todo', color: '#9e9e9e' },
    { id: 'done', name: 'Done', color: '#66bb6a' }
  ]

  it('returns the status color when found', () => {
    expect(statusSectionColor('todo', statuses)).toBe('#9e9e9e')
  })

  it('returns null for the "no status" bucket', () => {
    expect(statusSectionColor(null, statuses)).toBeNull()
  })

  it('returns null for an unknown status id', () => {
    expect(statusSectionColor('unknown', statuses)).toBeNull()
  })
})

describe('DEFAULT_GROUP_NAME', () => {
  it('is a non-empty name', () => {
    expect(DEFAULT_GROUP_NAME.length).toBeGreaterThan(0)
  })
})
describe('decideNewSessionShortcut', () => {
  const ev = (over: Partial<NewSessionShortcutEvent> = {}): NewSessionShortcutEvent => ({
    key: 'n', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...over
  })
  const FREE = { dialogOpen: false, inputFocused: false, terminalFocused: false }
  const IN_TERMINAL = { dialogOpen: false, inputFocused: false, terminalFocused: true }

  it('Ctrl+N starts a session outside the terminal', () => {
    expect(decideNewSessionShortcut(ev(), FREE)).toBe(true)
    expect(decideNewSessionShortcut(ev({ key: 'N' }), FREE)).toBe(true)
  })

  it('plain Ctrl+N is left to the terminal (readline next-history) while it has focus', () => {
    expect(decideNewSessionShortcut(ev(), IN_TERMINAL)).toBe(false)
  })

  it('Ctrl+Shift+N works everywhere, including inside the terminal', () => {
    expect(decideNewSessionShortcut(ev({ shiftKey: true }), IN_TERMINAL)).toBe(true)
    expect(decideNewSessionShortcut(ev({ shiftKey: true }), FREE)).toBe(true)
  })

  it('never fires while a dialog is open or a text input has focus', () => {
    const dialog = { ...FREE, dialogOpen: true }
    const typing = { ...FREE, inputFocused: true }
    expect(decideNewSessionShortcut(ev(), dialog)).toBe(false)
    expect(decideNewSessionShortcut(ev({ shiftKey: true }), dialog)).toBe(false)
    expect(decideNewSessionShortcut(ev(), typing)).toBe(false)
    expect(decideNewSessionShortcut(ev({ shiftKey: true }), typing)).toBe(false)
  })

  it('ignores other keys and Alt/Meta/Ctrl-less combinations', () => {
    expect(decideNewSessionShortcut(ev({ key: 'm' }), FREE)).toBe(false)
    expect(decideNewSessionShortcut(ev({ ctrlKey: false }), FREE)).toBe(false)
    expect(decideNewSessionShortcut(ev({ altKey: true }), FREE)).toBe(false)
    expect(decideNewSessionShortcut(ev({ metaKey: true }), FREE)).toBe(false)
  })
})
