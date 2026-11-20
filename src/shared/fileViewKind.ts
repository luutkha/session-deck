import type { FileViewKind } from './types'

const KIND_BY_EXTENSION: Readonly<Record<string, FileViewKind>> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  json: 'text',
  yaml: 'text',
  yml: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  csv: 'csv',
  tsv: 'csv',
  xlsx: 'sheet',
  docx: 'docx'
}

/** The viewer kind for a path (by extension, case-insensitive), or null when the viewer cannot show it. svg is never one (scriptable). */
export function fileViewKindFor(path: string): FileViewKind | null {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  return KIND_BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? null
}
