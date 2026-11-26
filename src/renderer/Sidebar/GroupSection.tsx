import { memo, useMemo, useRef, type DragEvent as ReactDragEvent, type ReactElement } from 'react'
import type { AttentionReason, Group, Id, RuntimeState, Session, StatusDef, StoreData } from '../../shared/types'
import type { DragItem, DropOver } from '../state/dropTarget'
import type { SelectClickModifiers } from '../state/multiSelect'
import { relativeTime } from '../state/formatTime'
import { attentionClass, resolveDropPosition } from './uiLogic'
import { DropHereHint, SectionHeader } from './SectionHeader'
import { GroupContextMenu } from './GroupContextMenu'
import { SessionCard, canMoveToCode, useSessionCardHandlers, type SessionCardHandlers } from './SessionCard'
import { SessionContextMenu } from './SessionContextMenu'
import { toggleRead } from '../attention/needsYou'
import { InlineEdit } from './InlineEdit'
import { WorkspaceSection } from './WorkspaceSection'
import { workspaceBuckets, workspaceCollapseKey } from '../state/selectors'
import { sessionAgent } from '../components/AgentBadge'
import { progress } from '../notes/checklistLogic'

/** One session row, shared by the group and status sections so both skip unchanged cards on a runtime batch. */
export interface SidebarSessionRowProps {
  readonly session: Session
  readonly status: StatusDef | null
  readonly runtime: RuntimeState | undefined
  /** Pre-formatted by the section, so a clock tick only re-renders rows whose own label changed. */
  readonly relative: string
  readonly active: boolean
  readonly renaming: boolean
  readonly groupBadge: string | null
  readonly showGroupBadge: boolean
  readonly attention: AttentionReason | null
  readonly dragOver: 'before' | 'after' | null
  readonly selected: boolean
  readonly draggable: boolean
  readonly statuses: readonly StatusDef[]
  readonly groups: readonly Group[]
  /** Stable forwarding object from useSessionCardHandlers (the memoized card compares callback identity). */
  readonly handlers: SessionCardHandlers
  readonly onSelect: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onStartRenameSession: (id: Id) => void
  readonly onCloseSession: (id: Id) => void
  readonly onSetSessionStatus: (id: Id, statusId: Id | null) => void
  readonly onMoveSession: (id: Id, groupId: Id | null) => void
  readonly onCreateGroupAndMove: (id: Id) => void
  readonly onRequestRemoveSession: (id: Id) => void
  readonly onForkSession?: (id: Id) => void
  /** D88: absent = the "Move to Code mode…" item is not shown at all. */
  readonly onMoveToCode?: (id: Id) => void
}

function sameSession(a: Session, b: Session): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.name !== b.name || a.cwd !== b.cwd) return false
  if (sessionAgent(a) !== sessionAgent(b)) return false
  if ((a.keepAwake === true) !== (b.keepAwake === true)) return false
  if ((a.notes ?? '').trim() !== (b.notes ?? '').trim()) return false
  if ((a.queue?.length ?? 0) !== (b.queue?.length ?? 0)) return false
  const tagsA = a.tags ?? []
  const tagsB = b.tags ?? []
  if (tagsA.length !== tagsB.length || tagsA.some((tag, index): boolean => tag !== tagsB[index])) return false
  const doneA = progress(a.checklist ?? [])
  const doneB = progress(b.checklist ?? [])
  return doneA.done === doneB.done && doneA.total === doneB.total
}

function sameStatus(a: StatusDef | null, b: StatusDef | null): boolean {
  if (a === b) return true
  return a !== null && b !== null && a.id === b.id && a.name === b.name && a.color === b.color
}

function sameRuntime(a: RuntimeState | undefined, b: RuntimeState | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return (
    a.run === b.run &&
    a.exitCode === b.exitCode &&
    a.attention === b.attention &&
    (a.activity ?? null) === (b.activity ?? null) &&
    (a.activityMessage ?? null) === (b.activityMessage ?? null) &&
    (a.activityAt ?? null) === (b.activityAt ?? null) &&
    (a.sleeping === true) === (b.sleeping === true) &&
    (a.remoteControl === true) === (b.remoteControl === true) &&
    (a.opencodePlugin ?? null) === (b.opencodePlugin ?? null)
  )
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index): boolean => item === b[index]))
}

/** Value comparison: a runtime batch passes a new Map, but a row whose own data is unchanged keeps its DOM. */
export function sidebarSessionRowPropsEqual(prev: SidebarSessionRowProps, next: SidebarSessionRowProps): boolean {
  return (
    sameSession(prev.session, next.session) &&
    sameStatus(prev.status, next.status) &&
    sameRuntime(prev.runtime, next.runtime) &&
    prev.relative === next.relative &&
    prev.active === next.active &&
    prev.renaming === next.renaming &&
    prev.groupBadge === next.groupBadge &&
    prev.showGroupBadge === next.showGroupBadge &&
    prev.attention === next.attention &&
    prev.dragOver === next.dragOver &&
    prev.selected === next.selected &&
    prev.draggable === next.draggable &&
    sameList(prev.statuses, next.statuses) &&
    sameList(prev.groups, next.groups) &&
    // Fork is the one raw (unwrapped) callback: compare it so a replaced handler cannot leave a stale menu item.
    prev.onForkSession === next.onForkSession
  )
  // Callback identity is deliberately ignored: the sections pass stable ref-forwarding wrappers
  // (useStableSidebarRowCallbacks and useSessionCardHandlers), so a skipped row never calls a stale closure.
  // The D88 menu callback reads the row's latest props through `latest`, so it is safe to ignore here too.
}

export function SidebarSessionRowView(props: SidebarSessionRowProps): ReactElement {
  // Latest props for the inline menu callbacks; memo ignores their identity, including section-level closures
  // that change when the store or drag state changes.
  const latest = useRef(props)
  latest.current = props
  const {
    session, status, runtime, relative, active, renaming,
    groupBadge, showGroupBadge, attention, dragOver, selected, draggable, statuses, groups, handlers
  } = props

  return (
    <SessionContextMenu
      statuses={statuses}
      groups={groups}
      sleeping={runtime?.sleeping === true}
      canSleep={runtime !== undefined && runtime.run === 'running' && runtime.sleeping !== true}
      keepAwake={session.keepAwake === true}
      attention={attention}
      onToggleRead={(): void => toggleRead(latest.current.session.id, latest.current.runtime?.attention ?? null)}
      onToggleKeepAwake={(): void => {
        const current = latest.current.session
        void window.api.setKeepAwake(current.id, current.keepAwake !== true).catch((): void => undefined)
      }}
      onSleep={(): void => {
        void window.api.sleepSession(latest.current.session.id).catch((): void => undefined)
      }}
      onWake={(): void => latest.current.onSelect(latest.current.session.id)}
      onRename={(): void => latest.current.onStartRenameSession(latest.current.session.id)}
      onSetStatus={(statusId): void => latest.current.onSetSessionStatus(latest.current.session.id, statusId)}
      onMoveToGroup={(groupId): void => latest.current.onMoveSession(latest.current.session.id, groupId)}
      onNewGroupAndMove={(): void => latest.current.onCreateGroupAndMove(latest.current.session.id)}
      onCloseSession={(): void => latest.current.onCloseSession(latest.current.session.id)}
      onFork={
        latest.current.onForkSession !== undefined && (session.agent ?? 'claude') !== 'shell'
          ? (): void => latest.current.onForkSession?.(latest.current.session.id)
          : undefined
      }
      moveToCodeId={canMoveToCode(session) ? session.id : undefined}
      onMoveToCode={
        canMoveToCode(session) && latest.current.onMoveToCode !== undefined
          ? (id): void => latest.current.onMoveToCode?.(id)
          : undefined
      }
      onRemoveSession={(): void => latest.current.onRequestRemoveSession(latest.current.session.id)}
    >
      <SessionCard
        session={session}
        status={status}
        active={active}
        runtime={runtime}
        relative={relative}
        renaming={renaming}
        groupBadge={groupBadge}
        showGroupBadge={showGroupBadge}
        attention={attention}
        showIndicator={true}
        indicatorAriaLabel={
          runtime === undefined ? 'No runtime data' : runtime.run === 'running' ? 'Running' : 'Exited'
        }
        indicatorClass={
          runtime !== undefined && runtime.attention !== null
            ? attentionClass(runtime.attention)
            : runtime === undefined
              ? 'bg-muted-foreground/40'
              : runtime.run === 'running'
                ? 'bg-status-success'
                : 'bg-destructive'
        }
        draggable={draggable}
        dragOver={dragOver}
        selected={selected}
        {...handlers}
      />
    </SessionContextMenu>
  )
}

/** Memoized row: only sessions whose displayed data changed re-render on a runtime publish. */
export const SidebarSessionRow = memo(SidebarSessionRowView, sidebarSessionRowPropsEqual)

/** The section-level callbacks a row forwards to (everything except the card handlers, which are stable too). */
export type SidebarRowCallbacks = Pick<
  SidebarSessionRowProps,
  | 'onSelect'
  | 'onStartRenameSession'
  | 'onCloseSession'
  | 'onSetSessionStatus'
  | 'onMoveSession'
  | 'onCreateGroupAndMove'
  | 'onRequestRemoveSession'
>

/**
 * Stable wrappers for the row callbacks. A section rebuilds these closures on every store/runtime event; the memo
 * ignores their identity, so they must always call the section's latest closure rather than the one from the
 * render that last created the row.
 */
export function useStableSidebarRowCallbacks(callbacks: SidebarRowCallbacks): SidebarRowCallbacks {
  const latest = useRef(callbacks)
  latest.current = callbacks
  return useMemo(
    (): SidebarRowCallbacks => ({
      onSelect: (id, modifiers): void => latest.current.onSelect(id, modifiers),
      onStartRenameSession: (id): void => latest.current.onStartRenameSession(id),
      onCloseSession: (id): void => latest.current.onCloseSession(id),
      onSetSessionStatus: (id, statusId): void => latest.current.onSetSessionStatus(id, statusId),
      onMoveSession: (id, groupId): void => latest.current.onMoveSession(id, groupId),
      onCreateGroupAndMove: (id): void => latest.current.onCreateGroupAndMove(id),
      onRequestRemoveSession: (id): void => latest.current.onRequestRemoveSession(id)
    }),
    []
  )
}

export interface GroupSectionProps {
  readonly group: Group | null
  readonly sessions: readonly Session[]
  readonly data: StoreData
  /** Indexed once per store data by SessionList, so a row never scans statuses/groups. */
  readonly statusById: ReadonlyMap<Id, StatusDef>
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
  readonly selectedIds: ReadonlySet<Id>
  readonly onToggleWorkspace: (collapseKey: string, collapsed: boolean) => void
  readonly onNewSessionInFolder: (groupId: Id | null, folder: string) => void
  readonly onToggleCollapsed: (groupId: Id) => void
  readonly onSelect: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onStartRenameSession: (id: Id) => void
  readonly onRenameSession: (id: Id, name: string) => void
  readonly onCancelRename: () => void
  readonly onStartRenameGroup: (groupId: Id) => void
  readonly onRenameGroup: (groupId: Id, name: string) => void
  readonly onCloseSession: (id: Id) => void
  /** D52: fork a Claude session (absent = no menu item). */
  readonly onForkSession?: (id: Id) => void
  /** D88: opens the New worktree dialog for this Ops session (absent = no menu item). */
  readonly onMoveToCode?: (id: Id) => void
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
    group, sessions, data, statusById, runtime, lastChange, now, activeId,
    renamingGroupId, renamingSessionId, drag, dropOver,
    groupBy, draggableSessions, draggableGroupHeader,
    showWorkspaces, workspaceCollapsed, onToggleWorkspace, onNewSessionInFolder,
    selectedIds,
    onToggleCollapsed, onSelect, onStartRenameSession, onRenameSession, onCancelRename,
    onStartRenameGroup, onRenameGroup, onCloseSession, onForkSession, onMoveToCode, onSetSessionStatus,
    onMoveSession, onCreateGroupAndMove, onRequestRemoveSession, onRemoveGroup,
    onNewSession, onDragStartSession, onDragStartGroup,
    onDragOverSession, onDragOverUngrouped,
    onDropItem, onDragEnd
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
    const groupBadge = group === null ? null : group.name
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
        showGroupBadge={groupBy === 'status' && groupBadge !== null}
        attention={state?.attention ?? null}
        dragOver={dropOverForSession}
        selected={selectedIds.has(session.id)}
        draggable={draggableSessions}
        statuses={data.statuses}
        groups={data.groups}
        handlers={handlers}
        {...rowCallbacks}
        onForkSession={onForkSession}
        onMoveToCode={onMoveToCode}
      />
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
