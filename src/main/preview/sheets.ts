// Excel (.xlsx) reading for the side-panel file viewer (D73): every sheet up to FILE_VIEW_MAX_SHEETS, cells
// as display strings, rows and columns capped. Legacy .xls has no viewer kind (see shared/fileViewKind.ts).
import readXlsxFile from 'read-excel-file/node'
import {
  FILE_VIEW_MAX_COLS,
  FILE_VIEW_MAX_ROWS,
  FILE_VIEW_MAX_SHEETS,
  type FileViewSheet
} from '../../shared/types'

export interface SheetRead {
  readonly sheets: readonly FileViewSheet[]
  /** True when sheets were dropped or any sheet was cut. */
  readonly truncated: boolean
}

/** One cell as the viewer shows it: '' when empty, ISO date for dates, String() for numbers and booleans. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const iso = value.toISOString()
    const time = iso.slice(11, 19)
    // Excel dates are day values; a real time is only shown when the cell carries one.
    return time === '00:00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`
  }
  return String(value)
}

/** Reads a whole .xlsx buffer (read-excel-file's all-sheets API). Throws when the file is not a zip workbook. */
export async function readSheets(buffer: Buffer): Promise<SheetRead> {
  const workbook = await readXlsxFile(buffer)
  let truncated = workbook.length > FILE_VIEW_MAX_SHEETS
  const sheets = workbook.slice(0, FILE_VIEW_MAX_SHEETS).map((sheet): FileViewSheet => {
    let cut = sheet.data.length > FILE_VIEW_MAX_ROWS
    const rows = sheet.data.slice(0, FILE_VIEW_MAX_ROWS).map((row) => {
      if (row.length > FILE_VIEW_MAX_COLS) cut = true
      return row.slice(0, FILE_VIEW_MAX_COLS).map(cellToText)
    })
    if (cut) truncated = true
    return { name: sheet.sheet, rows, truncated: cut }
  })
  return { sheets, truncated }
}
