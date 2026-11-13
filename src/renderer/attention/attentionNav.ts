// Keyboard triage (D69): Ctrl+Shift+Down / Ctrl+Shift+Up jump to the next / previous session that needs you, so a heavy user
// (30+ agents, remote desktop, no mouse) can answer the bells without hunting for the card. Pure rules; the hook and the
// palette use them. The order is the needs-you list's order (newest bell first, see needsYou.ts).
import type { Id } from '../../shared/types'
import type { ShortcutContext, ShortcutKeyEvent } from '../shell/openTabsLogic'

export type AttentionShortcut = 'next' | 'previous'

/** Ctrl+Shift+Down = next, Ctrl+Shift+Up = previous. Not while a dialog is open or a text field has the focus (it selects text there). */
export function decideAttentionShortcut(event: ShortcutKeyEvent, context: ShortcutContext): AttentionShortcut | null {
  if (context.dialogOpen || context.inputFocused) return null
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return null
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  return null
}

/**
 * The session to show next. From a session that is in the list: the one after / before it, wrapping round; from any other
 * session (or none): the first (next) or last (previous). Null when nothing needs you, or the only one that does is the
 * session already on screen.
 */
export function pickAttentionTarget(items: readonly { readonly id: Id }[], activeId: Id | null, delta: 1 | -1): Id | null {
  const count = items.length
  if (count === 0) return null
  const index = activeId === null ? -1 : items.findIndex((item): boolean => item.id === activeId)
  if (index === -1) return (delta === 1 ? items[0] : items[count - 1])?.id ?? null
  if (count === 1) return null
  return items[(index + delta + count) % count]?.id ?? null
}
