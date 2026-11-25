import { memo, useMemo, useRef, type ReactElement } from 'react'
import type { Id, Session, StatusDef } from '../../../shared/types'
import { SessionContextMenu } from '../../Sidebar/SessionContextMenu'
import { toggleRead } from '../../attention/needsYou'
import { ignoreRejection } from '../../Sidebar/ignoreRejection'
import { CodeSessionCard, sameCodeList, sameCodeRuntime, sameCodeSession, sameCodeStatus } from './CodeSessionCard'
import type { CodeTreeView } from './codeTreeView'

/** Code mode has no groups: the "Move to group" items of SessionContextMenu stay inert. */
const NO_GROUPS: readonly never[] = []
const noop = (): void => undefined

export interface CodeSessionRowProps {
  readonly session: Session
  readonly view: CodeTreeView
}

function statusFor(view: CodeTreeView, session: Session): StatusDef | null {
  return view.data.statuses.find((status): boolean => status.id === session.statusId) ?? null
}

function changedAt(view: CodeTreeView, session: Session): number {
  return view.runtime.get(session.id)?.activityAt ?? view.lastChange.get(session.id) ?? session.createdAt
}

/** Value comparison of what the row and its card show; unwrapped callbacks are compared by identity. */
export function codeSessionRowPropsEqual(prev: CodeSessionRowProps, next: CodeSessionRowProps): boolean {
  if (!sameCodeSession(prev.session, next.session)) return false
  const a = prev.view
  const b = next.view
  return (
    a.now === b.now &&
    (a.activeId === prev.session.id) === (b.activeId === next.session.id) &&
    (a.renamingId === prev.session.id) === (b.renamingId === next.session.id) &&
    sameCodeRuntime(a.runtime.get(prev.session.id), b.runtime.get(next.session.id)) &&
    changedAt(a, prev.session) === changedAt(b, next.session) &&
    sameCodeStatus(statusFor(a, prev.session), statusFor(b, next.session)) &&
    // The context menu lists every status, so a status added/renamed must reach an otherwise unchanged row.
    sameCodeList(a.data.statuses, b.data.statuses) &&
    // Unwrapped callbacks/commands: identity changes only on a store or view change (never on a runtime batch),
    // and a memoized row must not keep calling an older closure.
    a.handlers === b.handlers &&
    a.commands === b.commands &&
    a.actions === b.actions &&
    a.onForkSession === b.onForkSession &&
    a.onViewChanges === b.onViewChanges
  )
}

/** One session under a worktree: the Ops session card and its context menu, wired to the Code sidebar. */
export function CodeSessionRowView(props: CodeSessionRowProps): ReactElement {
  // The memo ignores callback identities, so every inline callback reads the latest view through a ref.
  const latest = useRef(props)
  latest.current = props
  const { session, view } = props
  const cardCallbacks = useMemo(
    () => ({
      onSelect: (id: Id): void => latest.current.view.handlers.onSelect(id),
      onStartRename: (id: Id): void => latest.current.view.handlers.onStartRename(id),
      onCommitRename: (id: Id, name: string): void => latest.current.view.handlers.onCommitRename(id, name),
      onCancelRename: (): void => latest.current.view.handlers.onCancelRename(),
      onClose: (id: Id): void => latest.current.view.handlers.onCloseSession(id)
    }),
    []
  )

  const state = view.runtime.get(session.id)
  const attention = state?.attention ?? null

  return (
    <SessionContextMenu
      statuses={view.data.statuses}
      groups={NO_GROUPS}
      sleeping={state?.sleeping === true}
      canSleep={state !== undefined && state.run === 'running' && state.sleeping !== true}
      keepAwake={session.keepAwake === true}
      attention={attention}
      onToggleRead={(): void => toggleRead(latest.current.session.id, latest.current.view.runtime.get(latest.current.session.id)?.attention ?? null)}
      onToggleKeepAwake={(): void => {
        const { session: current, view: currentView } = latest.current
        void currentView.commands.setKeepAwake(current.id, current.keepAwake !== true)
      }}
      onSleep={(): void => { void latest.current.view.commands.sleepSession(latest.current.session.id) }}
      onWake={(): void => latest.current.view.handlers.onSelect(latest.current.session.id)}
      onRename={(): void => latest.current.view.handlers.onStartRename(latest.current.session.id)}
      onSetStatus={(statusId): void => ignoreRejection(latest.current.view.actions.setSessionStatus(latest.current.session.id, statusId))}
      onMoveToGroup={noop}
      onNewGroupAndMove={noop}
      onCloseSession={(): void => latest.current.view.handlers.onCloseSession(latest.current.session.id)}
      onFork={
        latest.current.view.onForkSession !== undefined && (session.agent ?? 'claude') !== 'shell'
          ? (): void => latest.current.view.onForkSession?.(latest.current.session.id)
          : undefined
      }
      onViewChanges={
        latest.current.view.onViewChanges !== undefined
          ? (): void => latest.current.view.onViewChanges?.(latest.current.session.id)
          : undefined
      }
      onRemoveSession={(): void => latest.current.view.handlers.onRequestRemoveSession(latest.current.session.id)}
    >
      <CodeSessionCard
        session={session}
        status={statusFor(view, session)}
        active={view.activeId === session.id}
        runtime={state}
        lastChange={view.lastChange.get(session.id) ?? session.createdAt}
        now={view.now}
        renaming={view.renamingId === session.id}
        {...cardCallbacks}
      />
    </SessionContextMenu>
  )
}

/** Memoized row: a batch only re-renders the sessions whose own data changed. */
export const CodeSessionRow = memo(CodeSessionRowView, codeSessionRowPropsEqual)
