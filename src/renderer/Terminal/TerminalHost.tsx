// Backwards-compatible single-pane host. New callers use TerminalWorkspace
// directly with a split layout; this wrapper preserves the original API.
import { useMemo, type ReactElement } from 'react'
import type { Id, RuntimeState } from '../../shared/types'
import { singleLayout } from '../split/splitLogic'
import { TerminalWorkspace } from './TerminalWorkspace'

export interface TerminalHostProps {
  readonly sessionIds: readonly Id[]
  readonly activeId: Id | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
}

const EMPTY_NAMES: ReadonlyMap<Id, string> = new Map()
const NOOP = (): void => undefined

export function TerminalHost(props: TerminalHostProps): ReactElement {
  const { sessionIds, activeId, runtime } = props
  const layout = useMemo(() => singleLayout(activeId), [activeId])
  return (
    <TerminalWorkspace
      sessionIds={sessionIds}
      layout={layout}
      activeId={activeId}
      runtime={runtime}
      names={EMPTY_NAMES}
      onFocusPane={NOOP}
      onClosePane={NOOP}
      onResize={NOOP}
      onEqualize={NOOP}
    />
  )
}
