// Find rules of the preview pane (D74 #6). Pure: no React, no DOM. The text body splits its string
// with splitByMatches, the table counts every row of the active sheet with findTableMatches, and
// nextMatchIndex wraps the counter shown in the find bar.
export const FIND_HIGHLIGHT_MAX = 2000

/**
 * Lower-cases WITHOUT changing the length: 'İ'.toLowerCase() is two UTF-16 units (i + U+0307), which shifted every later
 * index, so a highlight landed on the wrong character (or was empty) while the counter still counted it. A character whose
 * lower-case form has another length stays as it is; everything else maps one to one, so indices match the original text.
 */
export function foldCase(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase()
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

/** A query made only of blanks is no query (the same in text, tables and rendered documents). */
export function isBlankQuery(query: string): boolean {
  return query.trim() === ''
}


export interface TextSegment {
  readonly text: string
  readonly match: boolean
}

/** Splits `text` into plain and match segments, case-insensitive, capped at `max` highlights. */
export function splitByMatches(
  text: string,
  query: string,
  max: number = FIND_HIGHLIGHT_MAX
): readonly TextSegment[] {
  if (text === '') return []
  if (isBlankQuery(query)) return [{ text, match: false }]
  const haystack = foldCase(text)
  const needle = foldCase(query)
  const segments: TextSegment[] = []
  let from = 0
  let count = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index < 0 || count >= max) break
    if (index > from) segments.push({ text: text.slice(from, index), match: false })
    segments.push({ text: text.slice(index, index + needle.length), match: true })
    count += 1
    from = index + needle.length
  }
  if (from < text.length) segments.push({ text: text.slice(from), match: false })
  return segments
}

/** The number of highlights splitByMatches would draw (the cap applies). */
export function countMatches(text: string, query: string, max: number = FIND_HIGHLIGHT_MAX): number {
  if (text === '' || isBlankQuery(query)) return 0
  const haystack = foldCase(text)
  const needle = foldCase(query)
  let count = 0
  let from = 0
  while (count < max) {
    const index = haystack.indexOf(needle, from)
    if (index < 0) break
    count += 1
    from = index + needle.length
  }
  return count
}

/** Next/previous match with wrap-around; 0 when there is nothing to select. */
export function nextMatchIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0
  const base = Number.isFinite(current) ? ((Math.trunc(current) % total) + total) % total : 0
  return (((base + direction) % total) + total) % total
}

/** The "3/17" counter; "0/0" when the query is empty or nothing matched. */
export function matchCounter(query: string, active: number, total: number): string {
  if (isBlankQuery(query) || total <= 0) return '0/0'
  return `${String(Math.min(Math.max(active, 0), total - 1) + 1)}/${String(total)}`
}

export interface TableMatch {
  readonly row: number
  readonly col: number
  /** Ordinal inside that cell, so the cell marks exactly the occurrence the counter is on. */
  readonly inCell: number
}

/** Every match of the rows (all pages), row by row, with its cell and ordinal inside the cell. */
export function findTableMatches(
  rows: readonly (readonly string[])[],
  query: string,
  max: number = FIND_HIGHLIGHT_MAX
): readonly TableMatch[] {
  const matches: TableMatch[] = []
  if (isBlankQuery(query)) return matches
  const needle = foldCase(query)
  for (let row = 0; row < rows.length; row += 1) {
    const cells = rows[row] ?? []
    for (let col = 0; col < cells.length; col += 1) {
      const haystack = foldCase(cells[col] ?? '')
      let from = 0
      let inCell = 0
      for (;;) {
        const index = haystack.indexOf(needle, from)
        if (index < 0) break
        matches.push({ row, col, inCell })
        inCell += 1
        if (matches.length >= max) return matches
        from = index + needle.length
      }
    }
  }
  return matches
}
