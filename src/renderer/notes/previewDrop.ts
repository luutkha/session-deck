// D74: what a file dropped on the side panel does. Pure: no DOM, no IPC; the panel asks for the path and calls in.
import { fileViewKindFor } from '../../shared/fileViewKind'

/** view = show it in the Preview tab; unsupported = the viewer cannot show it; ignore = nothing to do (no path). */
export type PreviewDropDecision =
  | { readonly kind: 'view'; readonly text: string }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'ignore' }

/** The decision for a dropped file's absolute path (main re-resolves the text for the session). */
export function previewDropFor(path: string): PreviewDropDecision {
  const text = path.trim()
  if (text === '') return { kind: 'ignore' }
  return fileViewKindFor(text) === null ? { kind: 'unsupported' } : { kind: 'view', text }
}
