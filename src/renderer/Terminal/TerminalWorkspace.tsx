// Renders the split layout of terminal panes. Every visible pane shows one
// session; hidden sessions keep their xterm mounted (see useTerminalPanes).
import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import type { AttentionReason, Id, RuntimeState, SessionRun } from '../../shared/types'
import type { SplitLayout } from '../split/splitLogic'
import { restartPane, useTerminalPanes, type TerminalPaneHandle, type TerminalPanesApi } from './useTerminalPanes'
import { SplitDivider } from './SplitDivider'
import { TerminalPane } from './TerminalPane'
import { GridCellHeader } from '../grid/GridCellHeader'
import { EmptyGridCell, gridChoices, gridTemplate, type TerminalGridMode } from '../grid/GridCells'
import { cellIndexFor, presetShape } from '../grid/gridLogic'
import '@xterm/xterm/css/xterm.css'
import './Terminal.css'

export interface TerminalWorkspaceProps {
  readonly sessionIds: readonly Id[]
  readonly layout: SplitLayout
  readonly activeId: Id | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly names: ReadonlyMap<Id, string>
  readonly onFocusPane: (id: Id) => void
  readonly onClosePane: (id: Id) => void
  readonly onResize: (dividerIndex: number, delta: number) => void
  readonly onEqualize: () => void
  /**
   * A pane registry owned UP the tree (D32: the grid and the split layout share one xterm per session).
   * When absent the workspace owns its own registry, exactly as before.
   */
  readonly panes?: TerminalPanesApi
  /**
   * Grid view (D32): draw the assigned sessions in the cells of a preset grid instead of the split layout. The panes
   * stay children of this workspace either way, so each xterm keeps its one host element when the view changes.
   */
  readonly grid?: TerminalGridMode
}

export function TerminalWorkspace(props: TerminalWorkspaceProps): ReactElement {
  const { sessionIds, layout, activeId, runtime, names, onFocusPane, onClosePane, onResize, onEqualize } =
    props
  const { grid } = props
  const gridIds = useMemo(
    (): readonly Id[] => (grid === undefined ? [] : grid.layout.cells.filter((id): id is Id => id !== null)),
    [grid?.layout]
  )
  const visibleIds = grid === undefined ? layout.paneIds : gridIds
  // The registry may be owned up the tree (D32: split + grid share one xterm per session). The owned
  // hook still runs (hooks rules) but stays idle: no visible ids means it creates nothing.
  const owned = useTerminalPanes(props.panes !== undefined ? [] : visibleIds, sessionIds, runtime)
  const { panesRef, createdIds, handleViewportRef, fitPanes, focusPane } = props.panes ?? owned

  const gridKey = grid === undefined ? 'split' : `grid:${grid.layout.preset}:${grid.layout.cells.join('|')}`
  const layoutKey = `${gridKey}:${layout.direction}:${layout.paneIds.join('|')}:${layout.sizes
    .map((size: number): string => size.toFixed(4))
    .join(',')}`

  // A pane that becomes visible, resizes or changes layout must refit + report its pty size.
  useEffect((): void => {
    fitPanes(visibleIds)
  }, [layoutKey, createdIds, fitPanes, visibleIds])

  // Activation: clear attention, refit (size may have changed while hidden), focus.
  useEffect((): void => {
    focusPane(activeId)
  }, [activeId, createdIds, focusPane])

  const handleRestart = useCallback(
    (id: Id): void => {
      const pane: TerminalPaneHandle | undefined = panesRef.current.get(id)
      if (pane !== undefined) {
        restartPane(pane)
      }
    },
    [panesRef]
  )

  const multi = grid !== undefined || visibleIds.length > 1
  const indexById = useMemo(() => {
    const map = new Map<Id, number>()
    visibleIds.forEach((id: Id, index: number): void => {
      map.set(id, index)
    })
    return map
  }, [visibleIds])

  const gridShape = grid === undefined ? null : presetShape(grid.layout.preset)
  const choices = useMemo(
    () => (grid === undefined ? [] : gridChoices(grid.sessions, runtime, names)),
    [grid, runtime, names]
  )

  return (
    <div
      className={grid === undefined ? 'terminal-workspace' : 'terminal-workspace terminal-workspace--grid'}
      data-direction={layout.direction}
      data-testid={grid === undefined ? undefined : 'grid-view'}
      data-grid-preset={grid?.layout.preset}
      style={grid === undefined ? undefined : gridTemplate(grid.layout)}
    >
      {createdIds.map((id: Id): ReactElement => {
        const cell = grid === undefined ? null : cellIndexFor(grid.layout, id)
        const index = grid === undefined ? (indexById.get(id) ?? -1) : (cell ?? -1)
        const visible = index >= 0
        const state = runtime.get(id)
        const run: SessionRun | null = state?.run ?? null
        const attention: AttentionReason | null = state?.attention ?? null
        const inGrid = grid !== undefined && gridShape !== null && cell !== null
        return (
          <TerminalPane
            key={id}
            id={id}
            name={names.get(id) ?? id}
            run={run}
            attention={attention}
            exitCode={state?.exitCode ?? null}
            visible={visible}
            multi={multi}
            active={id === activeId}
            size={visible && grid === undefined ? (layout.sizes[index] ?? 1) : 1}
            order={visible ? index * 2 : 0}
            onFocus={inGrid ? (): void => grid.onFocusCell(cell) : onFocusPane}
            onClose={inGrid ? (): void => grid.onPickCell(cell, null) : onClosePane}
            onRestart={handleRestart}
            handleViewportRef={handleViewportRef}
            grid={inGrid ? { index: cell, cols: gridShape.cols, rows: gridShape.rows } : undefined}
            cellIndex={inGrid ? cell : undefined}
            header={
              inGrid ? (
                <GridCellHeader
                  name={names.get(id) ?? id}
                  run={run}
                  attention={attention}
                  choices={choices}
                  onPick={(picked: Id): void => grid.onPickCell(cell, picked)}
                  onUnassign={(): void => grid.onPickCell(cell, null)}
                />
              ) : undefined
            }
          />
        )
      })}
      {grid !== undefined && gridShape !== null
        ? grid.layout.cells.map((cellId: Id | null, index: number): ReactElement | null =>
            cellId === null ? (
              <EmptyGridCell
                key={`empty-${String(index)}`}
                index={index}
                cols={gridShape.cols}
                choices={choices}
                onPick={(picked: Id): void => grid.onPickCell(index, picked)}
                onUnassign={(): void => grid.onPickCell(index, null)}
              />
            ) : null
          )
        : null}
      {grid === undefined && multi
        ? visibleIds.slice(0, -1).map((_: Id, dividerIndex: number): ReactElement => (
            <SplitDivider
              key={`divider-${String(dividerIndex)}`}
              index={dividerIndex}
              direction={layout.direction}
              order={dividerIndex * 2 + 1}
              onResize={onResize}
              onEqualize={onEqualize}
            />
          ))
        : null}
    </div>
  )
}
