// Pure rules of the side-panel file viewer (D73): column letters, labels, sizes, image src and the
// docx HTML policy. No React, no DOM and no IPC: main reads every file, FileViewPane only renders.
import DOMPurify, { type Config } from 'dompurify'
import type { FileView, FileViewKind, FileViewSheet } from '../../shared/types'

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

const KIND_LABELS: Readonly<Record<FileViewKind, string>> = {
  markdown: 'Markdown',
  text: 'Text',
  image: 'Image',
  csv: 'CSV',
  sheet: 'Spreadsheet',
  docx: 'Word document',
  pdf: 'PDF document'
}

/** A0 -> A, Z25 -> Z, 26 -> AA (spreadsheet letters). Anything negative or not finite has no label. */
export function columnLabel(index: number): string {
  if (!Number.isFinite(index)) return ''
  let value = Math.trunc(index)
  if (value < 0) return ''
  let label = ''
  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

/** "512 B", "1.5 KB", "12.4 MB": one decimal below 100 so a capped file still reads exactly. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${SIZE_UNITS[0]}`
  let value = Math.round(bytes)
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  if (unit === 0) return `${String(value)} B`
  return `${value.toFixed(value < 100 ? 1 : 0)} ${SIZE_UNITS[unit]}`
}

export function kindLabel(kind: FileViewKind): string {
  return KIND_LABELS[kind]
}

/** The data URL of an image view; '' when main sent no bytes (the pane shows a notice instead). */
export function imageSrc(view: FileView): string {
  const base64 = view.base64.trim()
  if (base64 === '') return ''
  const mime = view.mime.trim() === '' ? 'application/octet-stream' : view.mime.trim()
  return `data:${mime};base64,${base64}`
}

/** The sheet to draw: the stored index clamped, so a shorter workbook never renders nothing. */
export function visibleSheet(view: FileView, activeIndex: number): FileViewSheet | null {
  if (view.sheets.length === 0) return null
  const index = Number.isFinite(activeIndex) ? Math.trunc(activeIndex) : 0
  return view.sheets[Math.min(Math.max(index, 0), view.sheets.length - 1)] ?? null
}

// --- docx HTML ----------------------------------------------------------------------------------
// mammoth gives UNSANITIZED HTML. DOMPurify is the security boundary (mXSS, entities, URI schemes);
// the allow-list pass after it enforces exactly the tags/attributes this app shows, and keeps the
// policy testable in Node, where DOMPurify has no DOM to work on.

/** The text tags a Word document may keep. Images are dropped: main does not carry docx images. */
const DOCX_ALLOWED_TAGS: readonly string[] = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'br',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'blockquote',
  'pre',
  'code',
  'span'
]

const DOCX_ALLOWED_ATTRS: readonly string[] = ['href', 'colspan', 'rowspan']

const DOCX_PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [...DOCX_ALLOWED_TAGS],
  ALLOWED_ATTR: [...DOCX_ALLOWED_ATTRS],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false
}

const ALLOWED_TAG_SET = new Set<string>(DOCX_ALLOWED_TAGS)
const VOID_TAG_SET = new Set<string>(['br'])

/** Tags whose text is not prose: drop the block and its content, not only the tag. */
const DROPPED_BLOCKS: readonly string[] = ['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'form']

/** Receives the strict config so the wiring itself is testable (the default asks DOMPurify). */
export type DocxPurifier = (html: string, config: Config) => string

function purifyWithDomPurify(html: string, config: Config): string {
  // In Node (unit tests) DOMPurify has no DOM and only hands out a factory: there the allow-list
  // pass below is the whole sanitizer. The renderer always has a DOM.
  return typeof DOMPurify.sanitize === 'function' ? DOMPurify.sanitize(html, config) : html
}

export function sanitizeDocxHtml(html: string, purify: DocxPurifier = purifyWithDomPurify): string {
  if (html === '') return ''
  return enforceAllowList(purify(html, DOCX_PURIFY_CONFIG))
}

function enforceAllowList(html: string): string {
  let out = stripDroppedBlocks(html)
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_match: string, slash: string, name: string, attrs: string): string =>
    rebuildTag(slash, name, attrs)
  )
  return out
}

function stripDroppedBlocks(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const tag of DROPPED_BLOCKS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
    // A stray opener or a self-closing tag: still no tag survives, its text is harmless.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '')
  }
  return out
}

function rebuildTag(slash: string, rawName: string, attrs: string): string {
  const name = rawName.toLowerCase()
  if (!ALLOWED_TAG_SET.has(name)) return ''
  if (slash === '/') return VOID_TAG_SET.has(name) ? '' : `</${name}>`
  if (VOID_TAG_SET.has(name)) return `<${name}>`
  return `<${name}${keptAttributes(name, attrs)}>`
}

function keptAttributes(tag: string, rawAttrs: string): string {
  if (tag === 'a') {
    const href = attributeValue(rawAttrs, 'href')
    return href !== null && isSafeHref(href) ? ` href="${escapeAttribute(href)}"` : ''
  }
  if (tag === 'td' || tag === 'th') {
    return spanAttribute(rawAttrs, 'colspan') + spanAttribute(rawAttrs, 'rowspan')
  }
  return ''
}

function attributeValue(rawAttrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(rawAttrs)
  if (match === null) return null
  return match[1] ?? match[2] ?? match[3] ?? null
}

function spanAttribute(rawAttrs: string, name: 'colspan' | 'rowspan'): string {
  const value = attributeValue(rawAttrs, name)
  return value !== null && /^[1-9]\d{0,2}$/.test(value.trim()) ? ` ${name}="${String(Number(value.trim()))}"` : ''
}

/** Relative, folder and #bookmark links are inert; only http(s) ever reach the open pipeline. */
function isSafeHref(href: string): boolean {
  const compact = href.replace(/[\u0000-\u0020\u00a0]/g, '')
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)
  if (scheme === null) return true
  const name = (scheme[1] ?? '').toLowerCase()
  return name === 'http' || name === 'https'
}

/** A `"` left in a value would end the attribute; `&` is left alone so a second pass stays stable. */
function escapeAttribute(value: string): string {
  return value.replace(/["<>]/g, (char: string): string =>
    char === '"' ? '&quot;' : char === '<' ? '&lt;' : '&gt;'
  )
}
