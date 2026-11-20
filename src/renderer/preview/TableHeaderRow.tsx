// The sticky header row of the file table (D74 #7): sortable column headers with resize grips. The
// first data row is shown as the header when the toggle is on; otherwise the columns are labelled.
import type { ReactElement } from 'react'
import { columnLabel } from './fileViewLogic'
import { HeaderCell, HighlightedText } from './tableCells'
import type { TableSort } from './tableLogic'

export interface TableHeaderRowProps {
  readonly columns: readonly number[]
  readonly headerRow: readonly string[] | null
  readonly columnLetters: boolean
  readonly widthOf: (column: number) => number
  readonly sort: TableSort | null
  readonly onSort: (column: number) => void
  readonly onResize: (column: number, width: number) => void
  readonly onResetWidth: (column: number) => void
  readonly query: string
  readonly active: number
  readonly firstMatchAt: (row: number, column: number) => number
}

function labelFor(column: number, headerRow: readonly string[] | null, columnLetters: boolean): string {
  if (headerRow !== null) return headerRow[column] ?? ''
  return columnLetters ? columnLabel(column) : String(column + 1)
}

export function TableHeaderRow(props: TableHeaderRowProps): ReactElement {
  const { columns, headerRow, columnLetters, widthOf, sort, onSort, onResize, onResetWidth, query, active } =
    props
  return (
    <thead>
      <tr>
        <th
          scope="col"
          className="sticky top-0 z-10 border-b border-r border-sidebar-border bg-card px-1.5 py-1 text-right font-medium text-muted-foreground"
        >
          #
        </th>
        {columns.map((column: number) => {
          const label = labelFor(column, headerRow, columnLetters)
          return (
            <HeaderCell
              key={column}
              label={label}
              column={column}
              width={widthOf(column)}
              sorted={sort?.column === column ? sort.direction : null}
              onSort={onSort}
              onResize={onResize}
              onResetWidth={onResetWidth}
            >
              {headerRow === null ? (
                label
              ) : (
                <HighlightedText
                  text={label}
                  query={query}
                  firstMatch={props.firstMatchAt(0, column)}
                  active={active}
                />
              )}
            </HeaderCell>
          )
        })}
      </tr>
    </thead>
  )
}
