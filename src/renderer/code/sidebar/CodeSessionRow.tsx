import { type ReactElement } from 'react'
import type { Session } from '../../../shared/types'
import { SessionContextMenu } from '../../Sidebar/SessionContextMenu'
import { toggleRead } from '../../attention/needsYou'
import { ignoreRejection } from '../../Sidebar/ignoreRejection'
import { CodeSessionCard } from './CodeSessionCard'
import type { CodeTreeView } from './codeTreeView'

/** Code mode has no groups: the "Move to group" items of SessionContextMenu stay inert. */
const NO_GROUPS: readonly never[] = []
const noop = (): void => undefined

export interface CodeSessionRowProps {
  readonly session: Session
  readonly view: CodeTreeView
}

/** One session under a worktree: the Ops session card and its context menu, wired to the Code sidebar. */
export function CodeSessionRow({ session, view }: CodeSessionRowProps): ReactElement {
  const { runtime, lastChange, now, activeId, renamingId, data, actions, commands, handlers } = view
  const state = runtime.get(session.id)
  const attention = state?.attention ?? null

  return (
    <SessionContextMenu
      statuses={data.statuses}
      groups={NO_GROUPS}
      sleeping={state?.sleeping === true}
      canSleep={state !== undefined && state.run === 'running' && state.sleeping !== true}
      keepAwake={session.keepAwake === true}
      attention={attention}
      onToggleRead={(): void => toggleRead(session.id, attention)}
      onToggleKeepAwake={(): void => void commands.setKeepAwake(session.id, session.keepAwake !== true)}
      onSleep={(): void => void commands.sleepSession(session.id)}
      onWake={(): void => handlers.onSelect(session.id)}
      onRename={(): void => handlers.onStartRename(session.id)}
      onSetStatus={(statusId): void => ignoreRejection(actions.setSessionStatus(session.id, statusId))}
      onMoveToGroup={noop}
      onNewGroupAndMove={noop}
      onCloseSession={(): void => handlers.onCloseSession(session.id)}
      onFork={view.onForkSession !== undefined && (session.agent ?? 'claude') !== 'shell' ? (): void => view.onForkSession?.(session.id) : undefined}
      onViewChanges={view.onViewChanges !== undefined ? (): void => view.onViewChanges?.(session.id) : undefined}
      onRemoveSession={(): void => handlers.onRequestRemoveSession(session.id)}
    >
      <CodeSessionCard
        session={session}
        status={data.statuses.find((status): boolean => status.id === session.statusId) ?? null}
        active={activeId === session.id}
        runtime={state}
        lastChange={lastChange.get(session.id) ?? session.createdAt}
        now={now}
        renaming={renamingId === session.id}
        onSelect={handlers.onSelect}
        onStartRename={handlers.onStartRename}
        onCommitRename={handlers.onCommitRename}
        onCancelRename={handlers.onCancelRename}
        onClose={handlers.onCloseSession}
      />
    </SessionContextMenu>
  )
}
