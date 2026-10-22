import { describe, expect, it } from 'vitest'
import { decidePaletteShortcut } from './paletteShortcut'
import type { ShortcutContext, ShortcutKeyEvent } from '../shell/openTabsLogic'

const PLAIN_CONTEXT: ShortcutContext = { dialogOpen: false, inputFocused: false, terminalFocused: false }

function key(overrides: Partial<ShortcutKeyEvent> & { key: string }): ShortcutKeyEvent {
  return { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...overrides }
}

describe('decidePaletteShortcut: Ctrl+Shift+K', () => {
  it('opens the palette from anywhere, including the terminal', () => {
    const inTerminal: ShortcutContext = { ...PLAIN_CONTEXT, terminalFocused: true }
    expect(decidePaletteShortcut(key({ key: 'K', shiftKey: true }), inTerminal)).toBe('open')
  })

  it('accepts a lower-case key too', () => {
    expect(decidePaletteShortcut(key({ key: 'k', shiftKey: true }), PLAIN_CONTEXT)).toBe('open')
  })

  it('opens the palette even while a text input is focused', () => {
    const inInput: ShortcutContext = { ...PLAIN_CONTEXT, inputFocused: true }
    expect(decidePaletteShortcut(key({ key: 'K', shiftKey: true }), inInput)).toBe('open')
  })

  it('does nothing while a dialog is open', () => {
    const dialog: ShortcutContext = { ...PLAIN_CONTEXT, dialogOpen: true }
    expect(decidePaletteShortcut(key({ key: 'K', shiftKey: true }), dialog)).toBeNull()
  })
})

describe('decidePaletteShortcut: Ctrl+K', () => {
  it('opens the palette when nothing text-like or terminal is focused', () => {
    expect(decidePaletteShortcut(key({ key: 'k' }), PLAIN_CONTEXT)).toBe('open')
  })

  it('does not open the palette in the terminal, where Ctrl+K is delete-to-end-of-line', () => {
    const inTerminal: ShortcutContext = { ...PLAIN_CONTEXT, terminalFocused: true }
    expect(decidePaletteShortcut(key({ key: 'k' }), inTerminal)).toBeNull()
  })

  it('does not open the palette inside a text input', () => {
    const inInput: ShortcutContext = { ...PLAIN_CONTEXT, inputFocused: true }
    expect(decidePaletteShortcut(key({ key: 'k' }), inInput)).toBeNull()
  })

  it('does nothing while a dialog such as Settings is open', () => {
    const dialog: ShortcutContext = { ...PLAIN_CONTEXT, dialogOpen: true }
    expect(decidePaletteShortcut(key({ key: 'k' }), dialog)).toBeNull()
  })

  it('treats a missing terminalFocused flag as not in the terminal', () => {
    const context: ShortcutContext = { dialogOpen: false, inputFocused: false }
    expect(decidePaletteShortcut(key({ key: 'k' }), context)).toBe('open')
  })
})

describe('decidePaletteShortcut: other keys and modifiers', () => {
  it('ignores a press with Alt', () => {
    expect(decidePaletteShortcut(key({ key: 'k', altKey: true }), PLAIN_CONTEXT)).toBeNull()
    expect(decidePaletteShortcut(key({ key: 'K', shiftKey: true, altKey: true }), PLAIN_CONTEXT)).toBeNull()
  })

  it('ignores a press with Meta', () => {
    expect(decidePaletteShortcut(key({ key: 'k', metaKey: true }), PLAIN_CONTEXT)).toBeNull()
  })

  it('ignores K without Ctrl', () => {
    expect(decidePaletteShortcut(key({ key: 'k', ctrlKey: false }), PLAIN_CONTEXT)).toBeNull()
    expect(decidePaletteShortcut(key({ key: 'K', ctrlKey: false, shiftKey: true }), PLAIN_CONTEXT)).toBeNull()
  })

  it('ignores other letters with Ctrl', () => {
    expect(decidePaletteShortcut(key({ key: 'j' }), PLAIN_CONTEXT)).toBeNull()
    expect(decidePaletteShortcut(key({ key: 'w', shiftKey: true }), PLAIN_CONTEXT)).toBeNull()
  })
})
