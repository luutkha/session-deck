// The grid view (D32): a preset layout of interactive terminal cells. One xterm per session — the
// panes registry is shared with the split workspace (hoisted into ModeWorkspace). Empty cells show
// the session picker (no auto-fill).
import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import type { AttentionReason, Id, RuntimeState, SessionRun } from '../../shared/types'
import { presetShape, type GridLayout } from './gridLogic'
import { restartPane, type TerminalPanesApi } from '../Terminal/useTerminalPanes'
import { TerminalPane } from '../Terminal/TerminalPane'
import { GridCellHeader, type GridCellSessionChoice } from './GridCellHeader'
import '@xterm/xterm/css/xterm.css'

export interface GridViewProps {
  readonly grid: GridLayout
  /** All open sessions of this mode (picker choices; cells only ever hold open sessions). */
  readonly sessions: readonly SessionChoiceSource[]
  readonly activeId: Id | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly names: ReadonlyMap<Id, string>
  readonly panes: TerminalPanesApi
  readonly onFocusCell: (index: number) => void
  readonly onPickCell: (index: number, id: Id | null) => void
}

interface SessionChoiceSource {
  readonly id: Id
  readonly name: string
}

export function GridView({ grid, sessions, activeId, runtime, names, panes, onFocusCell, onPickCell }: GridViewProps): ReactElement {
  const { cols, rows } = presetShape(grid.preset)

  // Assignment dropdown choices for one cell: every open session (the cell's own is marked by the dot).
  const choicesFor = useCallback(
    (): readonly GridCellSessionChoice[] =>
      sessions.map((session) => {
        const state = runtime.get(session.id)
        return {
          id: session.id,
          name: names.get(session.id) ?? session.id,
          run: state?.run ?? null,
          attention: state?.attention ?? null
        }
      }),
    [sessions, runtime, names]
  )

  // A preset or assignment change resizes the cells: refit the assigned panes.
  const assignedIds = useMemo((): readonly Id[] => grid.cells.filter((id): id is Id => id !== null), [grid])
  const gridKey = `${grid.preset}:${grid.cells.join('|')}`
  useEffect((): void => {
    panes.fitPanes(assignedIds)
  }, [gridKey, panes, assignedIds])

  const handleRestart = useCallback(
    (id: Id): void => {
      const pane = panes.panesRef.current.get(id)
      if (pane !== undefined) {
        restartPane(pane)
      }
    },
    [panes]
  )

  const multi = cols * rows > 1
  void multi
  return (
    <div
      data-testid="grid-view"
      data-grid-preset={grid.preset}
      className="grid h-full min-h-0 w-full gap-px bg-border"
      style={{ gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${String(rows)}, minmax(0, 1fr))` }}
    >
      {grid.cells.map((cellId: Id | null, index: number): ReactElement => {
        if (cellId === null) {
          return (
            <div key={`empty-${String(index)}`} className="flex min-h-0 flex-col bg-background" data-grid-cell={String(index)}>
              <GridCellHeader
                name={null}
                run={null}
                attention={null}
                choices={choicesFor()}
                onPick={(id: Id): void => onPickCell(index, id)}
                onUnassign={(): void => onPickCell(index, null)}
              />
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <p className="px-3 text-xs text-muted-foreground">Pick a session for this cell.</p>
              </div>
            </div>
          )
        }
        const state = runtime.get(cellId)
        const run: SessionRun | null = state?.run ?? null
        const attention: AttentionReason | null = state?.attention ?? null
        return (
          <TerminalPane
            key={cellId}
            id={cellId}
            name={names.get(cellId) ?? cellId}
            run={run}
            attention={attention}
            exitCode={state?.exitCode ?? null}
            visible
            multi
            active={cellId === activeId}
            size={1}
            order={index}
            grid={{ index, cols, rows }}
            cellIndex={index}
            onFocus={(): void => onFocusCell(index)}
            onClose={(): void => onPickCell(index, null)}
            onRestart={handleRestart}
            handleViewportRef={panes.handleViewportRef}
            header={
              <GridCellHeader
                name={names.get(cellId) ?? cellId}
                run={run}
                attention={attention}
                choices={choicesFor()}
                onPick={(id: Id): void => onPickCell(index, id)}
                onUnassign={(): void => onPickCell(index, null)}
              />
            }
          />
        )
      })}
    </div>
  )
}
