// Table tab of the preview pane (D73, D74 #7): sheet tabs, the honest cut note, and the FileTable.
// Column widths and the first-row-header choice belong to each sheet of this file.
import { useState, type ReactElement } from 'react'
import type { FileView } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Notice } from './Notice'
import { FileTable } from './FileTable'
import { visibleSheet } from './fileViewLogic'
import { truncationNote } from './tableLogic'

export interface TableBodyProps {
  readonly view: FileView
  readonly activeSheet: number
  readonly onSelectSheet: (index: number) => void
  readonly query: string
  readonly active: number
  readonly onCount: (count: number) => void
  readonly zoomPercent: number
}

const EMPTY_TABLE = 'No table data.'
const NO_ROWS = 'No rows.'

export function TableBody(props: TableBodyProps): ReactElement {
  const { view, activeSheet, onSelectSheet, query, active, onCount, zoomPercent } = props
  const [widthsBySheet, setWidthsBySheet] = useState<Readonly<Record<number, Readonly<Record<number, number>>>>>({})
  const sheet = visibleSheet(view, activeSheet)
  if (sheet === null) return <Notice text={EMPTY_TABLE} />
  const selected = view.sheets.indexOf(sheet)
  const note = truncationNote(sheet)
  const widths = widthsBySheet[selected] ?? {}

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view.sheets.length > 1 ? (
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-sidebar-border px-1 py-1"
        >
          {view.sheets.map((option, index: number) => (
            <Button
              key={`${option.name}:${String(index)}`}
              type="button"
              role="tab"
              size="xs"
              variant={index === selected ? 'secondary' : 'ghost'}
              aria-selected={index === selected}
              data-sheet-tab={index}
              className="shrink-0 text-[11px]"
              title={option.name}
              onClick={(): void => onSelectSheet(index)}
            >
              {option.name}
            </Button>
          ))}
        </div>
      ) : null}
      {note === null ? null : (
        <p
          data-table-truncated=""
          className="shrink-0 border-b border-sidebar-border px-3 py-2 text-xs text-muted-foreground"
        >
          {note}
        </p>
      )}
      {sheet.rows.length === 0 ? (
        <Notice text={NO_ROWS} />
      ) : (
        <FileTable
          key={selected}
          sheet={sheet}
          columnLetters={view.kind === 'sheet'}
          headerDefault={view.kind === 'csv'}
          widths={widths}
          onWidthsChange={(next: Readonly<Record<number, number>>): void =>
            setWidthsBySheet((current) => ({ ...current, [selected]: next }))
          }
          query={query}
          active={active}
          onFindCount={onCount}
          zoomPercent={zoomPercent}
        />
      )}
    </div>
  )
}
