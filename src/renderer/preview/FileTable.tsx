// The csv/sheet table (D73, D74 #7): sticky header, sortable columns, 200-row pages, resizable
// columns and find across every row. Presentational: cells are display strings from main.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { FileViewSheet } from '../../shared/types'
import { Button } from '../components/ui/button'
import { findTableMatches } from './fileViewFind'
import { BodyCell } from './tableCells'
import { TableHeaderRow } from './TableHeaderRow'
import { TablePager } from './TablePager'
import {
  DEFAULT_COLUMN_WIDTH,
  TABLE_PAGE_SIZE,
  clampPage,
  columnWidth,
  pageForRow,
  sortRows,
  toggleSort,
  withColumnWidth,
  type SortableRow,
  type TableSort
} from './tableLogic'

export interface FileTableProps {
  readonly sheet: FileViewSheet
  /** Spreadsheet sheets label their unnamed columns A, B, ...; a csv uses 1, 2, ... */
  readonly columnLetters: boolean
  /** csv starts with a header row, a spreadsheet does not (its cells are data). */
  readonly headerDefault: boolean
  readonly widths: Readonly<Record<number, number>>
  readonly onWidthsChange: (widths: Readonly<Record<number, number>>) => void
  readonly query: string
  readonly active: number
  readonly onFindCount: (count: number) => void
  readonly zoomPercent: number
}

const ROW_NUMBER_WIDTH = 48

export function FileTable(props: FileTableProps): ReactElement {
  const { sheet, columnLetters, headerDefault, widths, onWidthsChange, query, active, onFindCount, zoomPercent } =
    props
  const [header, setHeader] = useState<boolean>(headerDefault)
  const [sort, setSort] = useState<TableSort | null>(null)
  const [page, setPage] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const headerRow = header && sheet.rows.length > 0 ? sheet.rows[0] : null
  const dataRows = useMemo(
    (): readonly (readonly string[])[] => (headerRow === null ? sheet.rows : sheet.rows.slice(1)),
    [sheet.rows, headerRow]
  )
  const ordered = useMemo((): readonly SortableRow[] => sortRows(dataRows, sort), [dataRows, sort])
  const columns = useMemo(
    (): number => sheet.rows.reduce((widest: number, row: readonly string[]): number => Math.max(widest, row.length), 0),
    [sheet.rows]
  )
  const columnIndexes = useMemo(
    (): readonly number[] => Array.from({ length: columns }, (_unused, index: number): number => index),
    [columns]
  )
  const rowsForFind = useMemo((): readonly (readonly string[])[] => {
    const rows = ordered.map((row: SortableRow): readonly string[] => row.cells)
    return headerRow === null ? rows : [headerRow, ...rows]
  }, [ordered, headerRow])
  const matches = useMemo(() => findTableMatches(rowsForFind, query), [rowsForFind, query])
  const cellStarts = useMemo((): ReadonlyMap<number, number> => {
    const starts = new Map<number, number>()
    matches.forEach((match, index: number): void => {
      const key = match.row * columns + match.col
      if (!starts.has(key)) starts.set(key, index)
    })
    return starts
  }, [matches, columns])

  const activeMatch = matches[active]
  const safePage = clampPage(page, ordered.length)
  const start = safePage * TABLE_PAGE_SIZE
  const pageRows = ordered.slice(start, start + TABLE_PAGE_SIZE)

  useEffect((): void => {
    onFindCount(matches.length)
  }, [matches.length, onFindCount])

  // A different sort or header mode is a different list: start again at its first page.
  useEffect((): void => {
    setPage(0)
  }, [sort, header])

  useEffect((): void => {
    if (activeMatch === undefined) return
    const target =
      headerRow === null
        ? pageForRow(activeMatch.row)
        : activeMatch.row === 0
          ? 0
          : pageForRow(activeMatch.row - 1)
    setPage(target)
  }, [activeMatch, headerRow])

  useEffect((): void => {
    if (query === '') return
    scrollRef.current
      ?.querySelector<HTMLElement>('[data-find-current]')
      ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [activeMatch, safePage, query])

  function firstMatchAt(row: number, column: number): number {
    return cellStarts.get(row * columns + column) ?? -1
  }

  function resizeColumn(column: number, width: number): void {
    onWidthsChange(withColumnWidth(widths, column, width))
  }

  function resetColumn(column: number): void {
    onWidthsChange(withColumnWidth(widths, column, DEFAULT_COLUMN_WIDTH))
  }

  const totalWidth =
    ROW_NUMBER_WIDTH +
    columnIndexes.reduce((sum: number, column: number): number => sum + columnWidth(widths, column), 0)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{ fontSize: `${String((11 * zoomPercent) / 100)}px` }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-1 py-0.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={header}
          data-table-header-toggle=""
          className="h-6 text-[11px]"
          onClick={(): void => setHeader((current: boolean): boolean => !current)}
        >
          First row is header
        </Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table
          data-file-table=""
          className="table-fixed border-separate border-spacing-0 tabular-nums"
          style={{ width: `${String(totalWidth)}px` }}
        >
          <colgroup>
            <col style={{ width: `${String(ROW_NUMBER_WIDTH)}px` }} />
            {columnIndexes.map((column: number) => (
              <col key={column} style={{ width: `${String(columnWidth(widths, column))}px` }} />
            ))}
          </colgroup>
          <TableHeaderRow
            columns={columnIndexes}
            headerRow={headerRow}
            columnLetters={columnLetters}
            widthOf={(column: number): number => columnWidth(widths, column)}
            sort={sort}
            onSort={(index: number): void => setSort((current) => toggleSort(current, index))}
            onResize={resizeColumn}
            onResetWidth={resetColumn}
            query={query}
            active={active}
            firstMatchAt={firstMatchAt}
          />
          <tbody>
            {pageRows.map((row: SortableRow, pageIndex: number) => {
              // Find rows follow the displayed order (sort + page), not the sheet's source order.
              const findRow = start + pageIndex + (headerRow === null ? 0 : 1)
              return (
                <tr key={row.source} className="even:bg-muted/20">
                  <td className="border-b border-r border-sidebar-border/60 px-1.5 py-0.5 text-right text-muted-foreground">
                    {String(row.source + 1 + (headerRow === null ? 0 : 1))}
                  </td>
                  {columnIndexes.map((column: number) => (
                    <BodyCell
                      key={column}
                      value={row.cells[column] ?? ''}
                      query={query}
                      firstMatch={firstMatchAt(findRow, column)}
                      active={active}
                    />
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <TablePager page={safePage} total={ordered.length} onPage={setPage} />
    </div>
  )
}
