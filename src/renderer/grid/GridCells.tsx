// Grid-view pieces (D32) rendered INSIDE TerminalWorkspace: the picker choices and the empty cell. The panes
// themselves are not drawn here — an xterm can only be opened into one DOM element, so the workspace stays the
// single host of every pane and just places the assigned ones into their grid cells.
import type { ReactElement } from 'react'
import type { Id, RuntimeState } from '../../shared/types'
import { presetShape, type GridLayout } from './gridLogic'
import { GridCellHeader, type GridCellSessionChoice } from './GridCellHeader'

/** What TerminalWorkspace needs to draw the grid instead of the split layout. */
export interface TerminalGridMode {
  readonly layout: GridLayout
  /** All open sessions of this mode (picker choices; cells only ever hold open sessions). */
  readonly sessions: readonly { readonly id: Id; readonly name: string }[]
  readonly onFocusCell: (index: number) => void
  readonly onPickCell: (index: number, id: Id | null) => void
}

/** Assignment dropdown choices for a cell: every open session. */
export function gridChoices(
  sessions: TerminalGridMode['sessions'],
  runtime: ReadonlyMap<Id, RuntimeState>,
  names: ReadonlyMap<Id, string>
): readonly GridCellSessionChoice[] {
  return sessions.map((session) => {
    const state = runtime.get(session.id)
    return {
      id: session.id,
      name: names.get(session.id) ?? session.id,
      run: state?.run ?? null,
      attention: state?.attention ?? null
    }
  })
}

/** CSS grid placement (1-based) of a row-major cell index. */
export function cellPlacement(index: number, cols: number): { gridColumn: number; gridRow: number } {
  return { gridColumn: (index % cols) + 1, gridRow: Math.floor(index / cols) + 1 }
}

export function gridTemplate(layout: GridLayout): { gridTemplateColumns: string; gridTemplateRows: string } {
  const { cols, rows } = presetShape(layout.preset)
  return {
    gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${String(rows)}, minmax(0, 1fr))`
  }
}

export function EmptyGridCell(props: {
  readonly index: number
  readonly cols: number
  readonly choices: readonly GridCellSessionChoice[]
  readonly onPick: (id: Id) => void
  readonly onUnassign: () => void
}): ReactElement {
  return (
    <div
      className="flex min-h-0 flex-col bg-background"
      data-grid-cell={String(props.index)}
      style={cellPlacement(props.index, props.cols)}
    >
      <GridCellHeader
        name={null}
        run={null}
        attention={null}
        choices={props.choices}
        onPick={props.onPick}
        onUnassign={props.onUnassign}
      />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="px-3 text-xs text-muted-foreground">Pick a session for this cell.</p>
      </div>
    </div>
  )
}
