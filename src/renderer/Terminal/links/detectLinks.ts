/**
 * Pure detection of clickable targets in a single terminal line.
 *
 * `detectLinkCandidates` scans one line and returns non-overlapping candidates
 * in left-to-right order, as character offsets into that line (`end`
 * exclusive). It performs no I/O and no filesystem checks: whether a path
 * actually exists is decided later by the main process.
 */

export interface LinkCandidate {
  /** The matched text, including a trailing position suffix when present. */
  readonly text: string
  /** Inclusive character offset into the scanned line. */
  readonly start: number
  /** Exclusive character offset into the scanned line. */
  readonly end: number
}

/** Characters past this offset in a line are never scanned. */
export const MAX_LINE_LENGTH = 2000
/** At most this many candidates are returned from one line. */
export const MAX_CANDIDATES = 40

interface RawMatch extends LinkCandidate {
  readonly priority: number
}

interface ProtectedRange {
  readonly start: number
  readonly end: number
}

const URL_RE = /(?:https?:\/\/|mailto:)[^\s"'`<>]+/gi
const FULL_URL_RE = /^(?:https?:\/\/|mailto:)\S+$/i
const TOKEN_RE = /[A-Za-z0-9_\-.:/\\~@+%$#&]+/g
const POSITION_PREFIX_RE = /^(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))/
const POSITION_SUFFIX_RE = /(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))$/
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', "'", '"', '`'])
const QUOTES = new Set(['"', "'", '`'])

/**
 * Drops trailing punctuation from a match. A trailing `)` is kept only while
 * it is balanced by an opening `(` inside the match (e.g. Wikipedia URLs).
 * Returns the trimmed exclusive end offset.
 */
function trimTrailing(line: string, start: number, end: number): number {
  let e = end
  while (e > start) {
    const ch = line[e - 1]
    if (ch === ')') {
      let opens = 0
      let closes = 0
      for (let i = start; i < e; i++) {
        const inner = line[i]
        if (inner === '(') opens++
        else if (inner === ')') closes++
      }
      if (closes <= opens) break
      e--
      continue
    }
    if (TRAILING_PUNCT.has(ch)) {
      e--
      continue
    }
    break
  }
  return e
}

function intersectsAny(start: number, end: number, ranges: readonly ProtectedRange[]): boolean {
  return ranges.some((range) => start < range.end && range.start < end)
}

/** A bare filename token (no separators) with a real, alphabetic extension. */
function isBareFilename(value: string): boolean {
  if (!/^[A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)+$/.test(value)) return false
  return isFileWithExtension(value)
}

/** Like {@link isBareFilename} but tolerant of spaces (used for quoted text). */
function isBareFilenameLoose(value: string): boolean {
  return isFileWithExtension(value)
}

function isFileWithExtension(value: string): boolean {
  if (!/[A-Za-z]/.test(value)) return false
  if (!/\.[A-Za-z][A-Za-z0-9]*$/.test(value)) return false
  // Prose abbreviations such as `e.g` / `i.e` are not files.
  if (/^[A-Za-z]\.[A-Za-z]$/.test(value)) return false
  return true
}

/**
 * Whether `value` looks like a path. When `allowSpaces` is true (quoted text)
 * the whole value is treated as one path; otherwise it is a single token.
 */
function looksLikePath(value: string, allowSpaces: boolean): boolean {
  if (value.length === 0) return false
  if (/^[A-Za-z]:[\\/]/.test(value)) return true // C:\... or C:/...
  if (/^\\\\[^\\/]+[\\/]/.test(value)) return true // \\server\share\...
  if (/^(?:~|\.{1,2})[\\/]/.test(value)) return true // ~/ ./ ../
  if (/[\\/]/.test(value)) {
    if (/\.[A-Za-z][A-Za-z0-9]*$/.test(value)) return true // src/main/index.ts
    if (/[\\/]$/.test(value)) return true // src/main/
    return false
  }
  return allowSpaces ? isBareFilenameLoose(value) : isBareFilename(value)
}

/** A quoted/backticked run whose inside text is a URL or a path (spaces allowed). */
function isQuotedTarget(content: string): boolean {
  if (FULL_URL_RE.test(content)) return true
  if (looksLikePath(content, true)) return true
  const base = content.replace(POSITION_SUFFIX_RE, '')
  if (base === content) return false
  return FULL_URL_RE.test(base) || looksLikePath(base, true)
}

function collectQuoted(input: string, matches: RawMatch[], protectedRanges: ProtectedRange[]): void {
  for (let i = 0; i < input.length; i++) {
    const quote = input[i]
    if (!QUOTES.has(quote)) continue
    const close = input.indexOf(quote, i + 1)
    if (close === -1) continue
    const end = trimTrailing(input, i + 1, close)
    if (end <= i + 1) continue
    const content = input.slice(i + 1, end)
    if (!isQuotedTarget(content)) continue
    matches.push({ start: i + 1, end, text: content, priority: 1 })
    protectedRanges.push({ start: i, end: close + 1 })
    i = close
  }
}

function collectUrls(input: string, matches: RawMatch[], protectedRanges: ProtectedRange[]): void {
  for (const match of input.matchAll(URL_RE)) {
    if (match.index === undefined) continue
    const start = match.index
    const rawEnd = start + match[0].length
    if (intersectsAny(start, rawEnd, protectedRanges)) continue
    const end = trimTrailing(input, start, rawEnd)
    if (end <= start) continue
    matches.push({ start, end, text: input.slice(start, end), priority: 0 })
    protectedRanges.push({ start, end: rawEnd })
  }
}

function collectTokens(input: string, matches: RawMatch[], protectedRanges: ProtectedRange[]): void {
  for (const match of input.matchAll(TOKEN_RE)) {
    if (match.index === undefined) continue
    const start = match.index
    const rawEnd = start + match[0].length
    if (intersectsAny(start, rawEnd, protectedRanges)) continue
    const end = trimTrailing(input, start, rawEnd)
    if (end <= start) continue
    const token = input.slice(start, end)
    const suffix = POSITION_SUFFIX_RE.exec(token)
    const base = suffix === null ? token : token.slice(0, token.length - suffix[0].length)
    if (!looksLikePath(base, false)) continue
    let finalEnd = end
    if (suffix === null) {
      const paren = POSITION_PREFIX_RE.exec(input.slice(end))
      if (paren !== null) finalEnd = end + paren[0].length
    }
    matches.push({ start, end: finalEnd, text: input.slice(start, finalEnd), priority: 2 })
  }
}

function select(matches: readonly RawMatch[]): readonly LinkCandidate[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end
  )
  const result: LinkCandidate[] = []
  let lastEnd = -1
  for (const match of sorted) {
    if (match.start < lastEnd) continue
    result.push({ text: match.text, start: match.start, end: match.end })
    lastEnd = match.end
    if (result.length >= MAX_CANDIDATES) break
  }
  return result
}

/**
 * Finds clickable targets in one terminal line. URL schemes, Windows absolute
 * paths, `~/` `./` `../` paths, relative paths with an extension or trailing
 * separator, and bare filenames are matched; quoted/backticked targets may
 * contain spaces. A trailing `:12`, `:12:5`, `(12)` or `(12,5)` position stays
 * part of the matched text.
 */
export function detectLinkCandidates(line: string): readonly LinkCandidate[] {
  const input = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line
  const matches: RawMatch[] = []
  const protectedRanges: ProtectedRange[] = []
  collectQuoted(input, matches, protectedRanges)
  collectUrls(input, matches, protectedRanges)
  collectTokens(input, matches, protectedRanges)
  return select(matches)
}
