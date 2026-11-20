// RFC-4180 CSV/TSV parsing for the side-panel file viewer (D73). Pure: no IO; the caller hands in text that
// is already size-capped, so the parser never sees more than FILE_VIEW_TEXT_MAX_BYTES.
import { FILE_VIEW_MAX_COLS, FILE_VIEW_MAX_ROWS } from '../../shared/types'

export interface CsvTable {
  readonly rows: readonly (readonly string[])[]
  /** True when rows or columns were cut at the caps. */
  readonly truncated: boolean
}

/**
 * Splits delimited text into rows of display strings: quotes, doubled quotes ("") and embedded newlines per
 * RFC 4180, CRLF or LF line breaks, a leading BOM dropped. A trailing line break does not add an empty row;
 * a real blank line is a row with one empty cell.
 */
export function parseCsv(
  text: string,
  delimiter: ',' | '\t',
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
