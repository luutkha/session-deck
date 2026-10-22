// Pure decision for the command palette shortcut. No React, no DOM.
import type { ShortcutContext, ShortcutKeyEvent } from '../shell/openTabsLogic'

const PALETTE_KEY = 'k'

/**
 * Ctrl+Shift+K opens the palette everywhere (except over an open dialog).
 * Plain Ctrl+K opens it only outside the terminal and outside text inputs, because in the
 * terminal Ctrl+K is Claude's delete-to-end-of-line and must reach the program.
 */
export function decidePaletteShortcut(
  event: ShortcutKeyEvent,
  context: ShortcutContext
): 'open' | null {
  if (context.dialogOpen || event.altKey || event.metaKey || !event.ctrlKey) {
    return null
  }
  if (event.key.toLowerCase() !== PALETTE_KEY) {
    return null
  }
  if (event.shiftKey) {
    return 'open'
  }
  const typing = context.inputFocused || context.terminalFocused === true
  return typing ? null : 'open'
}
