// Cells of the file table (D74 #7): highlighted text, a sortable header cell with a drag-to-resize
// grip, and a body cell. Kept out of FileTable so the table keeps one clear job.
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { MIN_COLUMN_WIDTH, type SortDirection } from './tableLogic'
import { splitByMatches } from './fileViewFind'

const MATCH_CLASS = 'rounded-sm bg-amber-400/30 text-inherit'
const CURRENT_CLASS = 'rounded-sm bg-amber-400 text-black'

export interface HighlightedTextProps {
  readonly text: string
  readonly query: string
  /** Global ordinal of this cell's first match, or -1 when the cell has none. */
  readonly firstMatch: number
  readonly active: number
}

export function HighlightedText({ text, query, firstMatch, active }: HighlightedTextProps): ReactElement {
  if (firstMatch < 0 || query === '') return <>{text}</>
  const segments = splitByMatches(text, query)
  let ordinal = firstMatch
  return (
    <>
      {segments.map((segment, index) => {
        if (!segment.match) return <span key={index}>{segment.text}</span>
        const own = ordinal
        ordinal += 1
        return (
          <mark
            key={index}
            data-find-match=""
            data-find-current={own === active ? '' : undefined}
            className={own === active ? CURRENT_CLASS : MATCH_CLASS}
          >
            {segment.text}
          </mark>
        )
      })}
    </>
  )
}

export interface HeaderCellProps {
  readonly label: string
  readonly column: number
  readonly width: number
  readonly sorted: SortDirection | null
  readonly onSort: (column: number) => void
  readonly onResize: (column: number, width: number) => void
  readonly onResetWidth: (column: number) => void
  readonly children: ReactNode
}

function startResize(
  event: ReactPointerEvent<HTMLSpanElement>,
  column: number,
  width: number,
  onResize: (column: number, width: number) => void
): void {
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const move = (moveEvent: PointerEvent): void => {
    onResize(column, Math.max(MIN_COLUMN_WIDTH, width + moveEvent.clientX - startX))
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

export function HeaderCell(props: HeaderCellProps): ReactElement {
  const { label, column, width, sorted, onSort, onResize, onResetWidth, children } = props
  return (
    <th
      scope="col"
      aria-sort={sorted === null ? undefined : sorted === 'asc' ? 'ascending' : 'descending'}
      style={{ width: `${String(width)}px` }}
      className="sticky top-0 z-10 border-b border-r border-sidebar-border bg-card p-0 text-left font-medium text-muted-foreground"
    >
      <div className="relative flex items-center">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left hover:text-foreground"
          aria-label={`Sort by ${label === '' ? `column ${String(column + 1)}` : label}`}
          onClick={(): void => onSort(column)}
        >
          <span className="truncate">{children}</span>
          {sorted === null ? null : (
            <span aria-hidden="true" className="shrink-0 text-[9px]">
              {sorted === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </button>
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize column ${label === '' ? String(column + 1) : label}`}
          title="Drag to resize; double-click to reset"
          data-column-resize={column}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-ring/40"
          onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>): void => {
            startResize(event, column, width, onResize)
          }}
          onDoubleClick={(event): void => {
            event.stopPropagation()
            onResetWidth(column)
          }}
        />
      </div>
    </th>
  )
}

export interface BodyCellProps {
  readonly value: string
  readonly query: string
  readonly firstMatch: number
  readonly active: number
}

export function BodyCell({ value, query, firstMatch, active }: BodyCellProps): ReactElement {
  return (
    <td
      title={value === '' ? undefined : value}
      className="truncate border-b border-r border-sidebar-border/60 px-2 py-0.5 align-top"
    >
      <HighlightedText text={value} query={query} firstMatch={firstMatch} active={active} />
    </td>
  )
}
