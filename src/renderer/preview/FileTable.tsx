// The csv/sheet table of the side-panel file viewer (D73). Presentational only: cells arrive as
// display strings from main, nothing is parsed here. Column letters exist for a spreadsheet; a csv
// has no header row at all, its first row is data like the rest.
import type { ReactElement } from 'react'
import type { FileViewSheet } from '../../shared/types'
import { columnLabel } from './fileViewLogic'

export interface FileTableProps {
  readonly sheet: FileViewSheet
  /** Spreadsheet sheets get the sticky A, B, ..., AA header over their columns. */
  readonly columnLetters: boolean
}

const ROW_NUMBER_WIDTH_REM = 3
const COLUMN_WIDTH_REM = 12

/** Cells that cut their text show the whole value in the title tooltip. */
function cellTitle(value: string): string | undefined {
  return value === '' ? undefined : value
}

export function FileTable({ sheet, columnLetters }: FileTableProps): ReactElement {
  const columns = sheet.rows.reduce((widest: number, row: readonly string[]): number => Math.max(widest, row.length), 0)
  const widthRem = ROW_NUMBER_WIDTH_REM + Math.max(columns, 1) * COLUMN_WIDTH_REM
  const columnIndexes = Array.from({ length: columns }, (_unused, index: number): number => index)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table
        data-file-table=""
        className="table-fixed border-separate border-spacing-0 text-[11px] tabular-nums"
        style={{ width: `${String(widthRem)}rem` }}
      >
        <colgroup>
          <col className="w-12" />
          {columnIndexes.map((index: number) => (
            <col key={index} />
          ))}
        </colgroup>
        {columnLetters ? (
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 z-10 border-b border-r border-sidebar-border bg-card px-1.5 py-1 text-right font-medium text-muted-foreground"
              >
                #
              </th>
              {columnIndexes.map((index: number) => (
                <th
                  key={index}
                  scope="col"
                  className="sticky top-0 z-10 truncate border-b border-r border-sidebar-border bg-card px-2 py-1 text-left font-medium text-muted-foreground"
                >
                  {columnLabel(index)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {sheet.rows.map((row: readonly string[], rowIndex: number) => (
            <tr key={rowIndex} className="even:bg-muted/20">
              <td className="border-b border-r border-sidebar-border/60 px-1.5 py-0.5 text-right text-muted-foreground">
                {String(rowIndex + 1)}
              </td>
              {columnIndexes.map((columnIndex: number) => {
                const value = row[columnIndex] ?? ''
                return (
                  <td
                    key={columnIndex}
                    title={cellTitle(value)}
                    className="truncate border-b border-r border-sidebar-border/60 px-2 py-0.5 align-top"
                  >
                    {value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
