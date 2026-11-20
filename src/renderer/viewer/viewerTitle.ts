// D73: the header title of the detached file-viewer window. Same rule as the native window title in
// main/app/window.ts: drop any "path:12:5" suffix, then show the base name.
const POSITION_SUFFIX_RE = /:[0-9]+(?::[0-9]+)?$/

export const VIEWER_FALLBACK_TITLE = 'Preview'

export function viewerTitle(text: string): string {
  const base = text.replace(POSITION_SUFFIX_RE, '').split(/[\\/]/).pop() ?? ''
  return base.length > 0 ? base : VIEWER_FALLBACK_TITLE
}
