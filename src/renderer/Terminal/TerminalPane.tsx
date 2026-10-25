// One pane: an optional slim header (multi-pane only), the xterm viewport and
// the exited overlay. Panes are never unmounted; invisible ones use display:none.
import type { ReactNode, MouseEvent, ReactElement } from 'react'
import type { AttentionReason, Id, SessionRun } from '../../shared/types'
import { cn } from '@/lib/utils'
import { SplitPaneHeader } from './SplitPaneHeader'

/** Grid placement (D32): the cell's row-major index inside the preset shape. */
export interface PaneGridPlacement {
  readonly index: number
  readonly cols: number
  readonly rows: number
}

export interface TerminalPaneProps {
  readonly id: Id
  readonly name: string
  readonly run: SessionRun | null
  readonly attention: AttentionReason | null
  readonly exitCode: number | null
  readonly visible: boolean
  readonly multi: boolean
  readonly active: boolean
  readonly size: number
  readonly order: number
  readonly onFocus: (id: Id) => void
  readonly onClose: (id: Id) => void
  readonly onRestart: (id: Id) => void
  readonly handleViewportRef: (element: HTMLDivElement | null) => void
  /** Grid mode (D32): the pane is placed by grid-area instead of flex+order. */
  readonly grid?: PaneGridPlacement
  /** Grid mode: the cell index, as a DOM hook for tests and styling (`data-grid-cell`). */
  readonly cellIndex?: number
  /** Grid cells render their own header (session picker, unassign); flex panes keep SplitPaneHeader. */
  readonly header?: ReactNode
}

function exitLabel(exitCode: number | null): string {
  return exitCode === null ? 'Process exited' : `Process exited (code ${String(exitCode)})`
}

export function TerminalPane(props: TerminalPaneProps): ReactElement {
  const { id, name, run, attention, exitCode, visible, multi, active, size, order } = props
  const exited = run === 'exited'
  const inGrid = props.grid !== undefined
  const placementStyle = inGrid && props.grid !== undefined
    ? { gridColumn: (props.grid.index % props.grid.cols) + 1, gridRow: Math.floor(props.grid.index / props.grid.cols) + 1 }
    : undefined

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (visible && event.button === 0) {
      props.onFocus(id)
    }
  }

  return (
    <div
      className={cn(
        'terminal-pane',
        !visible && 'terminal-pane--hidden',
        multi && active && 'terminal-pane--active'
      )}
      data-grid-cell={props.cellIndex === undefined ? undefined : String(props.cellIndex)}
      style={visible ? (placementStyle ?? { flex: `${size} 1 0`, order }) : undefined}
      onMouseDownCapture={handleMouseDown}
    >
      {props.header !== undefined ? (
        props.header
      ) : multi ? (
        <SplitPaneHeader
          name={name}
          run={run}
          attention={attention}
          onClose={(): void => props.onClose(id)}
        />
      ) : null}
      <div className="terminal-pane__stage">
        <div className="terminal-pane__viewport" data-session-id={id} ref={props.handleViewportRef} />
        {exited ? (
          <div className="terminal-pane__overlay">
            <span className="terminal-pane__overlay-label">{exitLabel(exitCode)}</span>
            <button
              type="button"
              className="terminal-pane__restart"
              onClick={(event: MouseEvent<HTMLButtonElement>): void => {
                event.stopPropagation()
                props.onRestart(id)
              }}
            >
              Restart
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
