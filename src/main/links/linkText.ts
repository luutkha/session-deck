/**
 * Pure classifier for terminal text: decides whether a piece of text is a URL
 * or a path, without touching the filesystem. Whether a path actually exists is
 * decided later by the main process (LinkService).
 */

/** A parsed URL (http/https/mailto), already normalized with `new URL`. */
export interface ParsedUrlLink {
  readonly kind: 'url'
  readonly url: string
}

/** A parsed path. `path` is the raw form with `~`/position removed; LinkService resolves it. */
export interface ParsedPathLink {
  readonly kind: 'path'
  readonly path: string
  /** 1-based line parsed from a `:12` / `(12)` suffix. */
  readonly line?: number
  /** 1-based column parsed from a `:12:5` / `(12,5)` suffix. */
  readonly column?: number
  /** true for `~/...` / `~\...`; `path` keeps the separator but not the `~`. */
  readonly home: boolean
}

export type ParsedLink = ParsedUrlLink | ParsedPathLink

/** Text longer than this is never a link. */
export const MAX_LINK_TEXT_LENGTH = 1024

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', "'", '"', '`', '>'])
const WRAPPER_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['<', '>'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}']
]
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/
const DRIVE_RE = /^[A-Za-z]:[\\/]/
const INVALID_PATH_CHARS_RE = /[*?|<>"]/
const COLON_POSITION_RE = /:(\d+)(?::(\d+))?$/
const PAREN_POSITION_RE = /\((\d+)(?:,(\d+))?\)$/

/** Windows characters that can never appear in a path (outside the drive prefix). */
function hasUnmatchedOpenParen(text: string): boolean {
  let opens = 0
  let closes = 0
  for (const ch of text) {
    if (ch === '(') opens++
    else if (ch === ')') closes++
  }
  return opens > closes
}

/** Removes trailing sentence punctuation, keeping a `)` balanced by an earlier `(` (Wikipedia URLs). */
function stripTrailing(text: string): string {
  let end = text.length
  while (end > 0) {
    const ch = text[end - 1]
    if (ch === ')') {
      if (hasUnmatchedOpenParen(text.slice(0, end - 1))) break
      end--
      continue
    }
    if (TRAILING_PUNCT.has(ch)) {
      end--
      continue
    }
    break
  }
  return text.slice(0, end)
}

/** Strips one enclosing wrapper pair (`"..."`, `<...>`, `(...)`, ...) when present. */
function stripWrappers(text: string): string {
  for (const [open, close] of WRAPPER_PAIRS) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(1, -1).trim()
    }
  }
  return text
}

function clean(text: string): string {
  let value = text
  for (let i = 0; i < 2; i++) {
    value = stripTrailing(stripWrappers(value))
  }
  return value
}

/** Decodes `%xx` escapes, leaving the text untouched when it is malformed. */
function decodePercent(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function parseUrl(text: string): ParsedLink | null {
  try {
    return { kind: 'url', url: new URL(text).toString() }
  } catch {
    return null
  }
}

/** `file:///C:/x/y` -> path `C:/x/y`; UNC-style `file://server/share` -> `\\server\share`. */
function parseFileUrl(text: string): ParsedLink | null {
  let rest = decodePercent(text.replace(/^file:\/\//i, ''))
  if (rest.length === 0) return null
  if (/^\/[A-Za-z]:(?:[\\/]|$)/.test(rest)) {
    rest = rest.slice(1)
  } else if (!rest.startsWith('/') && !/^[A-Za-z]:/.test(rest)) {
    rest = `\\\\${rest.replace(/^\/+/, '')}`
  }
  if (INVALID_PATH_CHARS_RE.test(rest)) return null
  return { kind: 'path', path: rest, home: false }
}

interface PositionSplit {
  readonly base: string
  readonly line?: number
  readonly column?: number
}

/** Pulls a `:12`, `:12:5`, `(12)` or `(12,5)` suffix off a path. A drive-letter colon never counts. */
function splitPosition(text: string): PositionSplit {
  const colon = COLON_POSITION_RE.exec(text)
  if (colon && colon.index > 1) {
    return {
      base: text.slice(0, colon.index),
      line: Number(colon[1]),
      column: colon[2] === undefined ? undefined : Number(colon[2])
    }
  }
  const paren = PAREN_POSITION_RE.exec(text)
  if (paren) {
    return {
      base: text.slice(0, paren.index),
      line: Number(paren[1]),
      column: paren[2] === undefined ? undefined : Number(paren[2])
    }
  }
  return { base: text }
}

function hasExtension(value: string): boolean {
  if (!/\.[A-Za-z][A-Za-z0-9]*$/.test(value)) return false
  // Prose abbreviations such as `e.g` / `i.e` are not files.
  return !/^[A-Za-z]\.[A-Za-z]$/.test(value)
}

/** Classifies a separator-bearing or bare path (position already removed). */
function classifyPath(value: string): { path: string; home: boolean } | null {
  if (DRIVE_RE.test(value)) return { path: value, home: false }
  if (/^\\\\/.test(value) && /[^\\/]/.test(value.slice(2))) return { path: value, home: false }
  if (value.includes(':')) return null
  if (/^~[\\/]/.test(value)) return { path: value.slice(1), home: true }
  if (/^\.\.?[\\/]/.test(value)) return { path: value, home: false }
  if (/[\\/]/.test(value)) return { path: value, home: false }
  if (hasExtension(value)) return { path: value, home: false }
  return null
}

function parsePath(text: string): ParsedLink | null {
  const position = splitPosition(text)
  const base = position.base
  if (base.length === 0) return null
  if (INVALID_PATH_CHARS_RE.test(base)) return null
  const shape = classifyPath(base)
  if (shape === null) return null
  return {
    kind: 'path',
    path: shape.path,
    home: shape.home,
    ...(position.line === undefined ? {} : { line: position.line }),
    ...(position.column === undefined ? {} : { column: position.column })
  }
}

function isDrivePath(text: string): boolean {
  return DRIVE_RE.test(text)
}

/**
 * Classifies one piece of terminal text. Returns null for anything that is not a
 * URL, a Windows path, or a path-like relative/bare filename.
 */
export function parseLinkText(raw: string): ParsedLink | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_LINK_TEXT_LENGTH) return null
  if (CONTROL_CHAR_RE.test(trimmed)) return null

  const text = clean(trimmed)
  if (text.length === 0) return null

  const scheme = SCHEME_RE.exec(text)
  if (scheme !== null) {
    const name = scheme[1].toLowerCase()
    if (name === 'http' || name === 'https' || name === 'mailto') return parseUrl(text)
    if (name === 'file') return parseFileUrl(text)
    if (!isDrivePath(text)) return null
  }

  return parsePath(text)
}
