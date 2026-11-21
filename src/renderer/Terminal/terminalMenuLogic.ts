// Pure rules of the terminal right-click menu (D59): which optional rows a pane gets, and the opening-click guard.
import type { Id, Session } from '../../shared/types'

/** Which optional rows a pane gets. */
export function menuRows(
  id: Id,
  session: Session | undefined,
  canSplit: boolean,
  splitPaneIds: readonly Id[]
): { readonly split: boolean; readonly closePane: boolean; readonly fork: boolean } {
  return {
    split: canSplit,
    closePane: splitPaneIds.length > 1 && splitPaneIds.includes(id),
    // D52: a Claude session forks its saved conversation. D79: an OpenCode one is COPIED through export/import, so it
    // needs its conversation id too. A shell has neither; Jarvis never forks itself.
    fork: session !== undefined && session.role !== 'jarvis' && (session.agent ?? 'claude') !== 'shell' &&
      ((session.agent ?? 'claude') === 'claude'
        ? typeof session.claudeSessionId === 'string' && session.claudeSessionId.length > 0
        : typeof session.opencodeSessionId === 'string' && session.opencodeSessionId.length > 0)
  }
}

/** The opening right-click must not count as a click outside (Orca's 100 ms guard). */
export function isOpeningGesture(openedAt: number, now: number): boolean {
  return now - openedAt < 100
}
