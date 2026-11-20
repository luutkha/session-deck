// D73: what one click on a detected terminal link does. Shift still reveals, Ctrl/Meta forces the old
// "open with the default app" behaviour, and a plain click on a file the viewer can show goes to the
// side-panel Preview tab instead. URLs, folders and unviewable files keep the old plain-click open.
import { fileViewKindFor } from '../../../shared/fileViewKind'
import type { ResolvedLink } from '../../../shared/types'

export interface LinkClickModifiers {
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
}

export type LinkClickAction = 'view' | 'open' | 'reveal'

/** Shift wins over Ctrl/Meta: it is the more specific modifier and never shows the viewer. */
export function decideLinkClick(link: ResolvedLink, modifiers: LinkClickModifiers): LinkClickAction {
  if (modifiers.shiftKey) return 'reveal'
  if (modifiers.ctrlKey || modifiers.metaKey) return 'open'
  if (link.kind === 'file' && fileViewKindFor(link.target) !== null) return 'view'
  return 'open'
}
