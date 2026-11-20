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
  // D75: svg is safe as an <img> (scripts never run in an image context); the renderer never inlines it.
  svg: 'image',
  ico: 'image',
  avif: 'image',
  csv: 'csv',
  tsv: 'csv',
  xlsx: 'sheet',
  xlsm: 'sheet',
  docx: 'docx',
  docm: 'docx',
  dotx: 'docx',
  pdf: 'pdf'
}

/** The viewer kind for a path (by extension, case-insensitive), or null when the viewer cannot show it (legacy .doc/.xls, .exe, archives...). */
export function fileViewKindFor(path: string): FileViewKind | null {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  return KIND_BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? null
}
