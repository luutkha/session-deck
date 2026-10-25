// Pure preview logic for the Changes panel (rich previews, Code mode): which changed files render.
// Mirrors main's previewKindFor (previewRead.ts); svg/pdf etc. are deliberately out of v1.

export type PreviewKind = 'image' | 'markdown'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

export function previewKindFor(path: string): PreviewKind | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot === path.length - 1) return null
  const ext = path.slice(dot + 1).toLowerCase()
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  return null
}

/** The Changes panel shows the Diff | Preview toggle only for previewable files. */
export function isPreviewable(path: string): boolean {
  return previewKindFor(path) !== null
}
