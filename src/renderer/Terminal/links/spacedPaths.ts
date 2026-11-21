/**
 * Alternatives for unquoted paths that contain spaces (D75).
 *
 * A terminal line does not say where a path with spaces ends, so for every word that ends with
 * a file extension this module emits candidates that prepend 1..6 previous words of the same
 * run (single spaces only). The provider resolves them on disk and keeps the longest one that
 * exists; nothing here does I/O.
 */
import { MAX_LINE_LENGTH, trimTrailing, type LinkCandidate } from './detectLinks'

/** Alternatives of one extension word, longest (most prepended words) first. */
export interface SpacedGroup {
  readonly alternatives: readonly LinkCandidate[]
}

/** At most this many groups are built from one line (same cap as plain candidates). */
export const MAX_SPACED_GROUPS = 40
/** How many previous words may be prepended to an extension word. */
export const MAX_PREPENDED_WORDS = 6

/** `.` + a letter-initial extension of 1 to 8 letters/digits (D75: any script). */
const EXTENSION_RE = /\.[\p{L}][\p{L}\p{N}]{0,7}$/u
const POSITION_SUFFIX_RE = /(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))$/
const LEADING_WRAPPERS = new Set(['(', '"', "'", '`', '<'])
const SPACE_RE = /\s/

interface Word {
  /** Inclusive offset of the first character of the word. */
  readonly start: number
  /** Exclusive offset of the last character of the word. */
  readonly end: number
  /** Index of the first word in the run this word belongs to. */
  readonly runStart: number
}

interface Bounds {
  readonly start: number
  readonly end: number
}

function isSpace(ch: string): boolean {
  return SPACE_RE.test(ch)
}

/** Splits a line into whitespace-separated words and marks the runs joined by single spaces. */
function splitWords(line: string): Word[] {
  const words: Word[] = []
  let runStart = 0
  let prevEnd = -1
  let i = 0
  while (i < line.length) {
    while (i < line.length && isSpace(line[i])) i++
    if (i >= line.length) break
    const start = i
    while (i < line.length && !isSpace(line[i])) i++
    // Two spaces or a tab end the run; only exactly one space joins two words.
    if (!(prevEnd >= 0 && start === prevEnd + 1 && line[prevEnd] === ' ')) runStart = words.length
    words.push({ start, end: i, runStart })
    prevEnd = i
  }
  return words
}

/**
 * How many characters to drop from the start of `word`: leading wrappers such as `"` or `<`,
 * and a call-like prefix before a `(` (`Read(C:\...` starts at `C:\...`).
 */
function leadingSkip(word: string): number {
  let i = 0
  while (i < word.length && LEADING_WRAPPERS.has(word[i])) i++
  const paren = word.indexOf('(', i)
  if (paren > i && !/[\\/]/.test(word.slice(i, paren))) return paren + 1
  return i
}

/** Trailing wrappers and punctuation, keeping a position suffix such as `(12)`. */
function trimWordEnd(line: string, start: number, end: number): number {
  let e = trimTrailing(line, start, end)
  while (e > start && line[e - 1] === '>') e--
  return e
}

/** The candidate bounds of an extension word, or null when it does not end with an extension. */
function extensionBounds(line: string, word: Word): Bounds | null {
  const start = word.start + leadingSkip(line.slice(word.start, word.end))
  if (start >= word.end) return null
  const end = trimWordEnd(line, start, word.end)
  if (end <= start) return null
  const body = line.slice(start, end)
  const suffix = POSITION_SUFFIX_RE.exec(body)
  const base = suffix === null ? body : body.slice(0, body.length - suffix[0].length)
  return EXTENSION_RE.test(base) ? { start, end } : null
}

/** Quick pre-check: a `.` followed by a letter and at least one space can form a spaced path. */
export function hasSpacedPathHint(line: string): boolean {
  return line.includes(' ') && /\.[\p{L}]/u.test(line)
}

/**
 * Groups alternatives for every extension word in `line`, at most {@link MAX_SPACED_GROUPS}.
 * Offsets are UTF-16 indices into the line, like {@link LinkCandidate}; a group whose
 * single-word alternative equals a plain candidate is still returned.
 */
export function detectSpacedPathGroups(line: string): SpacedGroup[] {
  const input = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line
  const words = splitWords(input)
  const groups: SpacedGroup[] = []
  for (let w = 0; w < words.length && groups.length < MAX_SPACED_GROUPS; w++) {
    const bounds = extensionBounds(input, words[w])
    if (bounds === null) continue
    const alternatives: LinkCandidate[] = []
    const back = Math.min(MAX_PREPENDED_WORDS, w - words[w].runStart)
    for (let step = back; step >= 0; step--) {
      const first = words[w - step]
      const start = first.start + leadingSkip(input.slice(first.start, first.end))
      if (start >= bounds.end) continue
      alternatives.push({ text: input.slice(start, bounds.end), start, end: bounds.end })
    }
    if (alternatives.length > 0) groups.push({ alternatives })
  }
  return groups
}
