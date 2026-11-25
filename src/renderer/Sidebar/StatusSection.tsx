import { type DragEvent as ReactDragEvent, type ReactElement } from 'react'
import type { Group, Id, RuntimeState, Session, StatusDef, StoreData } from '../../shared/types'
import type { DragItem, DropOver } from '../state/dropTarget'
import type { SelectClickModifiers } from '../state/multiSelect'
import { relativeTime } from '../state/formatTime'
import { DropHereHint, SectionHeader } from './SectionHeader'
import { useSessionCardHandlers } from './SessionCard'
import { SidebarSessionRow, useStableSidebarRowCallbacks } from './GroupSection'

export interface StatusSectionProps {
  readonly sectionKey: string
  readonly label: string
  readonly statusId: Id | null
  readonly color: string | null
  readonly sessions: readonly Session[]
  readonly data: StoreData
  /** Indexed once per store data by SessionList, so a row never scans statuses/groups. */
  readonly statusById: ReadonlyMap<Id, StatusDef>
  readonly groupById: ReadonlyMap<Id, Group>
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
  readonly onToggleCollapsed: (sectionKey: string, collapsed: boolean) => void
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
    sectionKey, label, statusId, color, sessions, data, statusById, groupById, runtime, lastChange, now,
    activeId, renamingSessionId, drag, dropOver, collapsed, draggableSessions,
    selectedIds,
    onToggleCollapsed, onSelect, onStartRenameSession, onRenameSession, onCancelRename,
    onCloseSession, onForkSession, onSetSessionStatus, onMoveSession, onCreateGroupAndMove,
    onRequestRemoveSession, onDragStartSession, onDragOverSession, onDropItem, onDragEnd
  } = props

  // One stable object for every row: the memoized card compares callback identity, and each callback reads the
  // section's latest closures through a ref (see useSessionCardHandlers).
  const handlers = useSessionCardHandlers({
    onSelect,
    onStartRename: onStartRenameSession,
    onCommitRename: onRenameSession,
    onCancelRename,
    onClose: onCloseSession,
    onDragStart: onDragStartSession,
    onDragOverItem: (id, position): void => onDragOverSession({ kind: 'session', id, position }),
    onDropItem,
    onDragEnd
  })
  const rowCallbacks = useStableSidebarRowCallbacks({
    onSelect,
    onStartRenameSession,
    onCloseSession,
    onSetSessionStatus,
    onMoveSession,
    onCreateGroupAndMove,
    onRequestRemoveSession
  })

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
        onToggle={(): void => onToggleCollapsed(sectionKey, !collapsed)}
      />
      {!collapsed && (
        <div className="flex flex-col gap-0.5 pl-2" onDragOver={handleBodyDragOver}>
          {sessions.map((session) => {
            const state = runtime.get(session.id)
            const groupBadge = groupNameFor(session.groupId, groupById)
            const dropOverForSession =
              drag !== null && drag.kind === 'session' && dropOver !== null &&
              dropOver.kind === 'session' && dropOver.id === session.id &&
              (dropOver.position === 'before' || dropOver.position === 'after')
                ? dropOver.position
                : null
            return (
              <SidebarSessionRow
                key={session.id}
                session={session}
                status={session.statusId === null ? null : (statusById.get(session.statusId) ?? null)}
                runtime={state}
                relative={relativeTime(now, state?.activityAt ?? (lastChange.get(session.id) ?? session.createdAt))}
                active={activeId === session.id}
                renaming={renamingSessionId === session.id}
                groupBadge={groupBadge}
                showGroupBadge={groupBadge !== null}
                attention={state?.attention ?? null}
                dragOver={dropOverForSession}
                selected={selectedIds.has(session.id)}
                draggable={draggableSessions}
                statuses={data.statuses}
                groups={data.groups}
                handlers={handlers}
                {...rowCallbacks}
                onForkSession={onForkSession}
              />
            )
          })}
          {sessions.length === 0 && <DropHereHint />}
        </div>
      )}
    </div>
  )
}

function groupNameFor(groupId: Id | null, groupById: ReadonlyMap<Id, Group>): string | null {
  if (groupId === null) return 'Ungrouped'
  return groupById.get(groupId)?.name ?? null
}
