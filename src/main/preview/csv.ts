// RFC-4180 CSV/TSV parsing for the side-panel file viewer (D73). Pure: no IO; the caller hands in text that
// is already size-capped, so the parser never sees more than FILE_VIEW_TEXT_MAX_BYTES.
import { FILE_VIEW_MAX_COLS, FILE_VIEW_MAX_ROWS } from '../../shared/types'

export type CsvDelimiter = ',' | ';' | '\t' | '|'

/** D75: tried in this order, so a tie keeps the more common delimiter (',' before ';' before tab before '|'). */
const DELIMITER_CANDIDATES: readonly CsvDelimiter[] = [',', ';', '\t', '|']
/** D75: enough lines to see the shape of a file; a comma inside prose elsewhere must not outvote the header. */
const DELIMITER_SAMPLE_LINES = 20

export interface CsvTable {
  readonly rows: readonly (readonly string[])[]
  /** True when rows or columns were cut at the caps. */
  readonly truncated: boolean
}

/**
 * D75: the first `maxLines` non-blank lines, cutting only at line breaks that are OUTSIDE quotes (a quoted cell
 * may hold a newline). A quote opens a quoted field only at the start of a field, exactly like `parseCsv`.
 */
function sampleLines(text: string, maxLines: number): string[] {
  const lines: string[] = []
  let lineStart = 0
  let index = 0
  let inQuotes = false
  let fieldLength = 0
  while (index < text.length && lines.length < maxLines) {
    const ch = text[index]
    if (inQuotes) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          fieldLength += 1
          index += 1
        } else inQuotes = false
      } else fieldLength += 1
      index += 1
      continue
    }
    if (ch === '"' && fieldLength === 0) inQuotes = true
    else if (ch === '\n' || ch === '\r') {
      const breakStart = index
      if (ch === '\r' && text[index + 1] === '\n') index += 1
      const line = text.slice(lineStart, breakStart)
      if (line.trim().length > 0) lines.push(line)
      lineStart = index + 1
      fieldLength = 0
      index += 1
      continue
    } else fieldLength += 1
    index += 1
  }
  if (lines.length < maxLines && lineStart < text.length) {
    const tail = text.slice(lineStart)
    if (tail.trim().length > 0) lines.push(tail)
  }
  return lines
}

/** Fields one line has with `delimiter`, counting only delimiters outside quoted cells. */
function countFields(line: string, delimiter: string): number {
  let fields = 1
  let inQuotes = false
  let fieldLength = 0
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index]
    if (inQuotes) {
      if (ch === '"') {
        if (line[index + 1] === '"') {
          fieldLength += 1
          index += 1
        } else inQuotes = false
      } else fieldLength += 1
      continue
    }
    if (ch === '"' && fieldLength === 0) inQuotes = true
    else if (ch === delimiter) {
      fields += 1
      fieldLength = 0
    } else fieldLength += 1
  }
  return fields
}

/**
 * D75: picks the delimiter of a `.csv` file from `,` `;` tab `|`. A candidate wins by giving the SAME field count
 * (> 1) on the most of the first 20 non-blank lines; ties keep the candidate order. A single-column file falls
 * back to ',', so it still shows as one column instead of one row.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const lines = sampleLines(text, DELIMITER_SAMPLE_LINES)
  let best: CsvDelimiter = ','
  let bestLines = 0
  for (const candidate of DELIMITER_CANDIDATES) {
    const linesByCount = new Map<number, number>()
    for (const line of lines) {
      const fields = countFields(line, candidate)
      if (fields > 1) linesByCount.set(fields, (linesByCount.get(fields) ?? 0) + 1)
    }
    let sameCount = 0
    for (const count of linesByCount.values()) sameCount = Math.max(sameCount, count)
    if (sameCount > bestLines) {
      best = candidate
      bestLines = sameCount
    }
  }
  return bestLines > 0 ? best : ','
}

/**
 * Splits delimited text into rows of display strings: quotes, doubled quotes ("") and embedded newlines per
 * RFC 4180, CRLF or LF line breaks, a leading BOM dropped. A trailing line break does not add an empty row;
 * a real blank line is a row with one empty cell.
 */
export function parseCsv(
  text: string,
  delimiter: CsvDelimiter,
  maxRows: number = FILE_VIEW_MAX_ROWS,
  maxCols: number = FILE_VIEW_MAX_COLS
): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let recordStarted = false
  let rowsCut = false
  let colsCut = false

  const endField = (): void => {
    if (row.length < maxCols) row.push(field)
    else colsCut = true
    field = ''
  }
  const endRecord = (): void => {
    endField()
    if (rows.length < maxRows) rows.push(row)
    else rowsCut = true
    row = []
    recordStarted = false
  }

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    // A quote only opens a quoted field at its start; elsewhere it is a literal character.
    if (ch === '"' && field.length === 0) {
      inQuotes = true
      recordStarted = true
      continue
    }
    if (ch === delimiter) {
      endField()
      recordStarted = true
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1
      endRecord()
      // Past the row cap there is nothing left to show, so stop scanning the rest of the text.
      if (rowsCut) break
      continue
    }
    field += ch
    recordStarted = true
  }
  if (recordStarted || field.length > 0) endRecord()

  return { rows, truncated: rowsCut || colsCut }
}
