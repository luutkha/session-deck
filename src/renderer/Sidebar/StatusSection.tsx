import { type DragEvent as ReactDragEvent, type ReactElement } from 'react'
import type { Id, RuntimeState, Session, StoreData } from '../../shared/types'
import type { DragItem, DropOver } from '../state/dropTarget'
import type { SelectClickModifiers } from '../state/multiSelect'
import { DropHereHint, SectionHeader } from './SectionHeader'
import { SessionCard } from './SessionCard'
import { SessionContextMenu } from './SessionContextMenu'
import { toggleRead } from '../attention/needsYou'
import { attentionClass } from './uiLogic'

export interface StatusSectionProps {
  readonly sectionKey: string
  readonly label: string
  readonly statusId: Id | null
  readonly color: string | null
  readonly sessions: readonly Session[]
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastChange: ReadonlyMap<Id, number>
  readonly now: number
  readonly activeId: Id | null
  readonly renamingSessionId: Id | null
  readonly drag: DragItem | null
  readonly dropOver: DropOver | null
  readonly collapsed: boolean
  readonly draggableSessions: boolean
  readonly selectedIds: ReadonlySet<Id>
  readonly onToggleCollapsed: () => void
  readonly onSelect: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onStartRenameSession: (id: Id) => void
  readonly onRenameSession: (id: Id, name: string) => void
  readonly onCancelRename: () => void
  readonly onCloseSession: (id: Id) => void
  /** D52: fork a Claude session (absent = no menu item). */
  readonly onForkSession?: (id: Id) => void
  readonly onSetSessionStatus: (id: Id, statusId: Id | null) => void
  readonly onMoveSession: (id: Id, groupId: Id | null) => void
  readonly onCreateGroupAndMove: (id: Id) => void
  readonly onRequestRemoveSession: (id: Id) => void
  readonly onDragStartSession: (id: Id) => void
  readonly onDragOverSession: (over: DropOver) => void
  readonly onDropItem: () => void
  readonly onDragEnd: () => void
}

export function StatusSection(props: StatusSectionProps): ReactElement {
  const {
    sectionKey, label, statusId, color, sessions, data, runtime, lastChange, now,
    activeId, renamingSessionId, drag, dropOver, collapsed, draggableSessions,
    selectedIds,
    onToggleCollapsed, onSelect, onStartRenameSession, onRenameSession, onCancelRename,
    onCloseSession, onForkSession, onSetSessionStatus, onMoveSession, onCreateGroupAndMove,
    onRequestRemoveSession, onDragStartSession, onDragOverSession, onDropItem, onDragEnd
  } = props

  const sectionId = `section-status-${sectionKey}`

  const leadingDot =
    statusId === null
      ? { color: null, ariaLabel: 'No status filter bucket' }
      : { color, ariaLabel: `${label} status color` }

  function handleBodyDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (drag === null || drag.kind !== 'session') return
    event.preventDefault()
  }

  return (
    <div
      role="group"
      aria-labelledby={sectionId}
      className="flex flex-col gap-1 px-2 pt-1"
    >
      <SectionHeader
        id={sectionId}
        label={label}
        count={sessions.length}
        collapsed={collapsed}
        leadingDot={leadingDot}
        onToggle={onToggleCollapsed}
      />
      {!collapsed && (
        <div className="flex flex-col gap-0.5 pl-2" onDragOver={handleBodyDragOver}>
          {sessions.map((session) => {
            const state = runtime.get(session.id)
            const attention = state?.attention ?? null
            const dropOverForSession =
              drag !== null && drag.kind === 'session' && dropOver !== null &&
              dropOver.kind === 'session' && dropOver.id === session.id &&
              (dropOver.position === 'before' || dropOver.position === 'after')
                ? dropOver.position
                : null

            const groupBadge = groupNameFor(session.groupId, data)
            const card = (
              <SessionCard
                session={session}
                status={data.statuses.find((s) => s.id === session.statusId) ?? null}
                active={activeId === session.id}
                runtime={state}
                lastChange={lastChange.get(session.id) ?? session.createdAt}
                now={now}
                renaming={renamingSessionId === session.id}
                groupBadge={groupBadge}
                showGroupBadge={groupBadge !== null}
                attention={attention}
                showIndicator={true}
                indicatorAriaLabel={
                  state === undefined
                    ? 'No runtime data'
                    : state.run === 'running'
                      ? 'Running'
                      : 'Exited'
                }
                indicatorClass={
                  state !== undefined && state.attention !== null
                    ? attentionClass(state.attention)
                    : state === undefined
                      ? 'bg-muted-foreground/40'
                      : state.run === 'running'
                        ? 'bg-status-success'
                        : 'bg-destructive'
                }
                draggable={draggableSessions}
                dragOver={dropOverForSession}
                selected={selectedIds.has(session.id)}
                onSelect={onSelect}
                onStartRename={onStartRenameSession}
                onCommitRename={onRenameSession}
                onCancelRename={onCancelRename}
                onClose={onCloseSession}
                onDragStart={onDragStartSession}
                onDragOverItem={(_id, position): void => {
                  onDragOverSession({ kind: 'session', id: session.id, position })
                }}
                onDropItem={onDropItem}
                onDragEnd={onDragEnd}
              />
            )

            return (
              <SessionContextMenu
                key={session.id}
                statuses={data.statuses}
                groups={data.groups}
                sleeping={state?.sleeping === true}
                canSleep={state !== undefined && state.run === 'running' && state.sleeping !== true}
                keepAwake={session.keepAwake === true}
                attention={state?.attention ?? null}
                onToggleRead={(): void => toggleRead(session.id, state?.attention ?? null)}
                onToggleKeepAwake={(): void => {
                  void window.api.setKeepAwake(session.id, session.keepAwake !== true).catch((): void => undefined)
                }}
                onSleep={(): void => {
                  void window.api.sleepSession(session.id).catch((): void => undefined)
                }}
                onWake={(): void => onSelect(session.id)}
                onRename={(): void => onStartRenameSession(session.id)}
                onSetStatus={(sid): void => onSetSessionStatus(session.id, sid)}
                onMoveToGroup={(gid): void => onMoveSession(session.id, gid)}
                onNewGroupAndMove={(): void => onCreateGroupAndMove(session.id)}
                onCloseSession={(): void => onCloseSession(session.id)}
                onFork={onForkSession !== undefined && (session.agent ?? 'claude') === 'claude' ? (): void => onForkSession(session.id) : undefined}
                onRemoveSession={(): void => onRequestRemoveSession(session.id)}
              >
                {card}
              </SessionContextMenu>
            )
          })}
          {sessions.length === 0 && <DropHereHint />}
        </div>
      )}
    </div>
  )
}

function groupNameFor(groupId: Id | null, data: StoreData): string | null {
  if (groupId === null) return 'Ungrouped'
  const group = data.groups.find((g) => g.id === groupId)
  return group?.name ?? null
}
