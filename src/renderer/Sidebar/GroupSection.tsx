import { type DragEvent as ReactDragEvent, type ReactElement } from 'react'
import type { Group, Id, RuntimeState, Session, StoreData } from '../../shared/types'
import type { DragItem, DropOver } from '../state/dropTarget'
import { resolveDropPosition } from './uiLogic'
import { DropHereHint, SectionHeader } from './SectionHeader'
import { GroupContextMenu } from './GroupContextMenu'
import { SessionCard } from './SessionCard'
import { SessionContextMenu } from './SessionContextMenu'
import { InlineEdit } from './InlineEdit'
import { WorkspaceSection } from './WorkspaceSection'
import { workspaceBuckets, workspaceCollapseKey } from '../state/selectors'

export interface GroupSectionProps {
  readonly group: Group | null
  readonly sessions: readonly Session[]
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastChange: ReadonlyMap<Id, number>
  readonly now: number
  readonly activeId: Id | null
  readonly renamingGroupId: Id | null
  readonly renamingSessionId: Id | null
  readonly drag: DragItem | null
  readonly dropOver: DropOver | null
  readonly groupBy: 'groups' | 'status'
  readonly draggableSessions: boolean
  readonly draggableGroupHeader: boolean
  readonly showWorkspaces: boolean
  readonly workspaceCollapsed: ReadonlyMap<string, boolean>
  readonly onToggleWorkspace: (collapseKey: string, collapsed: boolean) => void
  readonly onNewSessionInFolder: (groupId: Id | null, folder: string) => void
  readonly onToggleCollapsed: (groupId: Id) => void
  readonly onSelect: (id: Id) => void
  readonly onStartRenameSession: (id: Id) => void
  readonly onRenameSession: (id: Id, name: string) => void
  readonly onCancelRename: () => void
  readonly onStartRenameGroup: (groupId: Id) => void
  readonly onRenameGroup: (groupId: Id, name: string) => void
  readonly onCloseSession: (id: Id) => void
  readonly onSetSessionStatus: (id: Id, statusId: Id | null) => void
  readonly onMoveSession: (id: Id, groupId: Id | null) => void
  readonly onCreateGroupAndMove: (id: Id) => void
  readonly onRequestRemoveSession: (id: Id) => void
  readonly onRemoveGroup: (groupId: Id) => void
  readonly onNewSession: (groupId: Id | null) => void
  readonly onDragStartSession: (id: Id) => void
  readonly onDragStartGroup: (id: Id) => void
  readonly onDragOverSession: (over: DropOver) => void
  readonly onDragOverUngrouped: () => void
  readonly onDropItem: () => void
  readonly onDragEnd: () => void
}

export function GroupSection(props: GroupSectionProps): ReactElement {
  const {
    group, sessions, data, runtime, lastChange, now, activeId,
    renamingGroupId, renamingSessionId, drag, dropOver,
    groupBy, draggableSessions, draggableGroupHeader,
    showWorkspaces, workspaceCollapsed, onToggleWorkspace, onNewSessionInFolder,
    onToggleCollapsed, onSelect, onStartRenameSession, onRenameSession, onCancelRename,
    onStartRenameGroup, onRenameGroup, onCloseSession, onSetSessionStatus,
    onMoveSession, onCreateGroupAndMove, onRequestRemoveSession, onRemoveGroup,
    onNewSession, onDragStartSession, onDragStartGroup,
    onDragOverSession, onDragOverUngrouped,
    onDropItem, onDragEnd
  } = props

  const sectionId = group === null ? 'section-ungrouped' : `section-group-${group.id}`
  const collapsed = group !== null && group.collapsed
  const label = group === null ? 'Ungrouped' : group.name

  const headerIsDragging =
    group !== null && drag !== null && drag.kind === 'group' && drag.id === group.id

  const headerIndicator =
    group !== null &&
    drag !== null &&
    drag.kind === 'group' &&
    dropOver !== null &&
    dropOver.kind === 'group' &&
    dropOver.id === group.id &&
    (dropOver.position === 'before' || dropOver.position === 'after')
      ? dropOver.position
      : null

  const dropInside =
    group !== null &&
    drag !== null &&
    drag.kind === 'session' &&
    dropOver !== null &&
    dropOver.kind === 'group' &&
    dropOver.id === group.id &&
    dropOver.position === 'inside'

  const ungroupedDropInside =
    group === null &&
    drag !== null &&
    drag.kind === 'session' &&
    dropOver !== null &&
    dropOver.kind === 'ungrouped' &&
    dropOver.position === 'inside'

  function handleHeaderDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (drag === null || group === null) return
    event.preventDefault()
    if (drag.kind === 'session') {
      onDragOverSession({ kind: 'group', id: group.id, position: 'inside' })
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const position = resolveDropPosition(event.clientY, rect.top, rect.height)
    onDragOverSession({ kind: 'group', id: group.id, position })
  }

  function handleUngroupedDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (drag === null || drag.kind !== 'session') return
    event.preventDefault()
    onDragOverUngrouped()
  }

  const headerWrapperClasses: string[] = ['rounded-md']
  if (headerIsDragging) headerWrapperClasses.push('opacity-50')
  if (dropInside) headerWrapperClasses.push('ring-1 ring-inset ring-primary/40 bg-worktree-sidebar-accent/40')

  let headerNode: ReactElement
  if (group !== null) {
    headerNode = (
      <GroupContextMenu
        onRename={(): void => onStartRenameGroup(group.id)}
        onNewSession={(): void => onNewSession(group.id)}
        onRemove={(): void => onRemoveGroup(group.id)}
      >
        <div
          className={headerWrapperClasses.join(' ')}
          draggable={draggableGroupHeader}
          onDragStart={(event): void => {
            if (!draggableGroupHeader) return
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', group.id)
            onDragStartGroup(group.id)
          }}
          onDragOver={handleHeaderDragOver}
          onDrop={(event): void => {
            event.preventDefault()
            onDropItem()
          }}
          onDragEnd={(): void => onDragEnd()}
          onDoubleClick={(): void => onStartRenameGroup(group.id)}
        >
          {renamingGroupId === group.id ? (
            <div className="px-1.5 py-1">
              <InlineEdit
                value={group.name}
                ariaLabel="Group name"
                onCommit={(value): void => onRenameGroup(group.id, value)}
                onCancel={onCancelRename}
              />
            </div>
          ) : (
            <SectionHeader
              id={sectionId}
              label={label}
              count={sessions.length}
              collapsed={collapsed}
              onToggle={(): void => onToggleCollapsed(group.id)}
            />
          )}
          {headerIndicator === 'before' && <div className="h-0.5 -mt-0.5 bg-primary" aria-hidden="true" />}
          {headerIndicator === 'after' && <div className="h-0.5 -mb-0.5 bg-primary" aria-hidden="true" />}
        </div>
      </GroupContextMenu>
    )
  } else {
    headerNode = (
      <div
        className={ungroupedDropInside ? 'rounded-md ring-1 ring-inset ring-primary/40 bg-worktree-sidebar-accent/40' : 'rounded-md'}
        onDragOver={handleUngroupedDragOver}
        onDrop={(event): void => {
          event.preventDefault()
          onDropItem()
        }}
      >
        <SectionHeader
          id={sectionId}
          label={label}
          count={sessions.length}
          collapsed={false}
          onToggle={(): void => undefined}
        />
      </div>
    )
  }

  function renderSession(session: Session): ReactElement {
    const state = runtime.get(session.id)
    const attention = state?.attention ?? null
    const groupBadge = group === null ? null : group.name
    const showGroupBadge = groupBy === 'status' && groupBadge !== null
    const dropOverForSession =
      drag !== null && drag.kind === 'session' && dropOver !== null &&
      dropOver.kind === 'session' && dropOver.id === session.id &&
      (dropOver.position === 'before' || dropOver.position === 'after')
        ? dropOver.position
        : null

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
        showGroupBadge={showGroupBadge}
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
            ? attentionBgClass(state.attention)
            : state === undefined
              ? 'bg-muted-foreground/40'
              : state.run === 'running'
                ? 'bg-status-success'
                : 'bg-destructive'
        }
        indicatorPulse={attention !== null}
        draggable={draggableSessions}
        dragOver={dropOverForSession}
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
        onToggleKeepAwake={(): void => {
          void window.api.setKeepAwake(session.id, session.keepAwake !== true).catch((): void => undefined)
        }}
        onSleep={(): void => {
          void window.api.sleepSession(session.id).catch((): void => undefined)
        }}
        onWake={(): void => onSelect(session.id)}
        onRename={(): void => onStartRenameSession(session.id)}
        onSetStatus={(statusId): void => onSetSessionStatus(session.id, statusId)}
        onMoveToGroup={(groupId): void => onMoveSession(session.id, groupId)}
        onNewGroupAndMove={(): void => onCreateGroupAndMove(session.id)}
        onCloseSession={(): void => onCloseSession(session.id)}
        onRemoveSession={(): void => onRequestRemoveSession(session.id)}
      >
        {card}
      </SessionContextMenu>
    )
  }

  return (
    <div
      role="group"
      aria-labelledby={sectionId}
      className="flex flex-col gap-1 px-2 pt-1"
    >
      {headerNode}
      {!collapsed && (
        <div className="flex flex-col gap-0.5 pl-2">
          {showWorkspaces ? (
            workspaceBuckets(sessions).map((bucket): ReactElement => {
              const collapseKey = workspaceCollapseKey(group?.id ?? null, bucket.key)
              return (
                <WorkspaceSection
                  key={bucket.key}
                  sectionId={`workspace-${sectionId}-${bucket.key}`}
                  bucket={bucket}
                  collapsed={workspaceCollapsed.get(collapseKey) ?? false}
                  onToggle={(): void => onToggleWorkspace(collapseKey, !(workspaceCollapsed.get(collapseKey) ?? false))}
                  onNewSession={(folder): void => onNewSessionInFolder(group?.id ?? null, folder)}
                  renderSession={renderSession}
                />
              )
            })
          ) : (
            sessions.map(renderSession)
          )}
          {sessions.length === 0 && <DropHereHint />}
        </div>
      )}
    </div>
  )
}

function attentionBgClass(reason: 'permission' | 'idle' | 'done' | 'bell'): string {
  switch (reason) {
    case 'permission':
      return 'bg-status-warning'
    case 'done':
      return 'bg-status-success'
    case 'idle':
    case 'bell':
      return 'bg-blue-500'
  }
}