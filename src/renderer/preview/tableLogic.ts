// Table rules of the preview pane (D74 #7): the first-row header toggle, a numeric-aware stable
// sort, 200-row pages, column widths and the honest "what was cut" note. Pure; FileTable renders.
import type { FileViewSheet } from '../../shared/types'
import { FILE_VIEW_MAX_COLS, FILE_VIEW_MAX_ROWS } from '../../shared/types'

export const TABLE_PAGE_SIZE = 200
export const MIN_COLUMN_WIDTH = 48
export const DEFAULT_COLUMN_WIDTH = 120

export type SortDirection = 'asc' | 'desc'

export interface TableSort {
  readonly column: number
  readonly direction: SortDirection
}

/** A data row plus its source index, so numbering and ties survive a sort. */
export interface SortableRow {
  readonly cells: readonly string[]
  readonly source: number
}

function isBlank(value: string): boolean {
  return value.trim() === ''
}

/** A plain decimal number (10 > 9); everything else is text. */
export function parseNumeric(value: string): number | null {
  const text = value.trim()
  if (text === '' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

/** Numbers before text, case-insensitive text, empty cells last (in both directions). */
export function compareCellText(a: string, b: string): number {
  const aBlank = isBlank(a)
  const bBlank = isBlank(b)
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1
  const aNumber = parseNumeric(a)
  const bNumber = parseNumeric(b)
  if (aNumber !== null || bNumber !== null) {
    if (aNumber === null) return 1
    if (bNumber === null) return -1
    return aNumber - bNumber
  }
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'base' })
}

/** asc -> desc -> none, the header-click cycle. */
export function toggleSort(current: TableSort | null, column: number): TableSort | null {
  if (current === null || current.column !== column) return { column, direction: 'asc' }
  return current.direction === 'asc' ? { column, direction: 'desc' } : null
}

/** Stable sort over the data rows; empty cells stay last whichever way the column is sorted. */
export function sortRows(
  rows: readonly (readonly string[])[],
  sort: TableSort | null
): readonly SortableRow[] {
  const entries = rows.map((cells: readonly string[], source: number): SortableRow => ({ cells, source }))
  if (sort === null) return entries
  const sign = sort.direction === 'asc' ? 1 : -1
  return entries.slice().sort((a: SortableRow, b: SortableRow): number => {
    const aValue = a.cells[sort.column] ?? ''
    const bValue = b.cells[sort.column] ?? ''
    const aBlank = isBlank(aValue)
    const bBlank = isBlank(bValue)
    if (aBlank || bBlank) return aBlank === bBlank ? a.source - b.source : aBlank ? 1 : -1
    const compared = compareCellText(aValue, bValue) * sign
    return compared === 0 ? a.source - b.source : compared
  })
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / TABLE_PAGE_SIZE))
}

export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 0
  return Math.min(pageCount(total) - 1, Math.max(0, Math.trunc(page)))
}

export function pageForRow(row: number): number {
  if (!Number.isFinite(row) || row <= 0) return 0
  return Math.floor(Math.trunc(row) / TABLE_PAGE_SIZE)
}

/** "rows 1-200 of 2000" for the pager. */
export function pageRangeLabel(page: number, total: number): string {
  const safe = clampPage(page, total)
  const start = total === 0 ? 0 : safe * TABLE_PAGE_SIZE + 1
  const end = Math.min(total, (safe + 1) * TABLE_PAGE_SIZE)
  return `rows ${String(start)}-${String(end)} of ${String(total)}`
}

export function columnWidth(widths: Readonly<Record<number, number>>, column: number): number {
  return widths[column] ?? DEFAULT_COLUMN_WIDTH
}

export function withColumnWidth(
  widths: Readonly<Record<number, number>>,
  column: number,
  width: number
): Readonly<Record<number, number>> {
  const next = Number.isFinite(width) ? Math.max(MIN_COLUMN_WIDTH, Math.round(width)) : MIN_COLUMN_WIDTH
  return { ...widths, [column]: next }
}

/** Which side main cut; the old fixed "2000 / 50" wording hid the axis that was actually cut. */
export function truncationNote(sheet: FileViewSheet): string | null {
  if (!sheet.truncated) return null
  const rowsCut = sheet.rows.length === FILE_VIEW_MAX_ROWS
  const colsCut = sheet.rows.some((row: readonly string[]): boolean => row.length === FILE_VIEW_MAX_COLS)
  if (rowsCut && colsCut) {
    return `Showing the first ${String(FILE_VIEW_MAX_ROWS)} rows / ${String(FILE_VIEW_MAX_COLS)} columns — the rest was cut at the size cap.`
  }
  if (rowsCut) return `Showing the first ${String(FILE_VIEW_MAX_ROWS)} rows — the rest was cut at the size cap.`
  if (colsCut) {
    return `Showing the first ${String(FILE_VIEW_MAX_COLS)} columns — the rest was cut at the size cap.`
  }
  return 'The table was cut at the size cap.'
}
