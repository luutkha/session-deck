// Renders the split layout of terminal panes. Every visible pane shows one
// session; hidden sessions keep their xterm mounted (see useTerminalPanes).
import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import type { AttentionReason, Id, RuntimeState, SessionRun } from '../../shared/types'
import type { SplitLayout } from '../split/splitLogic'
import { restartPane, useTerminalPanes, type TerminalPaneHandle, type TerminalPanesApi } from './useTerminalPanes'
import { SplitDivider } from './SplitDivider'
import { TerminalPane } from './TerminalPane'
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
}

export function TerminalWorkspace(props: TerminalWorkspaceProps): ReactElement {
  const { sessionIds, layout, activeId, runtime, names, onFocusPane, onClosePane, onResize, onEqualize } =
    props
  const visibleIds = layout.paneIds
  // The registry may be owned up the tree (D32: split + grid share one xterm per session). The owned
  // hook still runs (hooks rules) but stays idle: no visible ids means it creates nothing.
  const owned = useTerminalPanes(props.panes !== undefined ? [] : visibleIds, sessionIds, runtime)
  const { panesRef, createdIds, handleViewportRef, fitPanes, focusPane } = props.panes ?? owned

  const layoutKey = `${layout.direction}:${layout.paneIds.join('|')}:${layout.sizes
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

  const multi = visibleIds.length > 1
  const indexById = useMemo(() => {
    const map = new Map<Id, number>()
    visibleIds.forEach((id: Id, index: number): void => {
      map.set(id, index)
    })
    return map
  }, [visibleIds])

  return (
    <div className="terminal-workspace" data-direction={layout.direction}>
      {createdIds.map((id: Id): ReactElement => {
        const index = indexById.get(id) ?? -1
        const visible = index >= 0
        const state = runtime.get(id)
        const run: SessionRun | null = state?.run ?? null
        const attention: AttentionReason | null = state?.attention ?? null
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
            size={visible ? (layout.sizes[index] ?? 1) : 1}
            order={visible ? index * 2 : 0}
            onFocus={onFocusPane}
            onClose={onClosePane}
            onRestart={handleRestart}
            handleViewportRef={handleViewportRef}
          />
        )
      })}
      {multi
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
