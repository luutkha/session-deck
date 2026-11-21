// D76: which detected terminal link the pointer is over, per terminal. The right-click handler reads this when the
// menu opens, so the menu can act on the link under the pointer (the same links a click opens). A WeakMap keeps the
// record with its terminal: a disposed pane leaves nothing behind.
import type { Terminal } from '@xterm/xterm'
import type { Id, ResolvedLink } from '../../../shared/types'

export interface HoveredLink {
  /** The pane's session: the rows prove the link against this session's cwd, like a click does. */
  readonly sessionId: Id
  /** The link text exactly as the terminal showed it (main re-resolves it, never trusts the renderer). */
  readonly text: string
  /** What main resolved the text to when it provided the link. */
  readonly link: ResolvedLink
}

const hoveredLinks = new WeakMap<Terminal, HoveredLink>()

export function setHoveredLink(term: Terminal, hovered: HoveredLink | null): void {
  if (hovered === null) {
    hoveredLinks.delete(term)
  } else {
    hoveredLinks.set(term, hovered)
  }
}

export function getHoveredLink(term: Terminal): HoveredLink | null {
  return hoveredLinks.get(term) ?? null
}

/**
 * Clears the record only while it still describes `hovered`. xterm can fire the next link's hover before the
 * previous link's leave; an unconditional delete there would drop the new link (no stale rows, no lost rows).
 */
export function clearHoveredLink(term: Terminal, hovered: HoveredLink): void {
  const current = hoveredLinks.get(term)
  if (current === undefined) {
    return
  }
  if (current.link === hovered.link && current.text === hovered.text) {
    hoveredLinks.delete(term)
  }
}
