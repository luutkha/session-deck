import { useMemo, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import type { Group, Id, RuntimeState, StatusDef, StoreData } from '../../shared/types'
import type { DropOver, DragItem } from '../state/dropTarget'
import type { SelectClickModifiers } from '../state/multiSelect'
import { indexById, type Section, type StatusSection as StatusSectionData } from '../state/selectors'
import type { GroupBy, StatusCollapsedMap } from './sidebarPrefs'
import { GroupSection } from './GroupSection'
import { StatusSection } from './StatusSection'

export interface SessionListProps {
  readonly groupBy: GroupBy
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastChange: ReadonlyMap<Id, number>
  readonly now: number
  readonly activeId: Id | null
  readonly renamingSessionId: Id | null
  readonly renamingGroupId: Id | null
  readonly drag: DragItem | null
  readonly dropOver: DropOver | null
  readonly statusCollapsed: StatusCollapsedMap
  readonly showWorkspaces: boolean
  readonly workspaceCollapsed: StatusCollapsedMap
  /** W4: ids in the bulk selection (Ctrl/Shift+click), rendered with the selected style. */
  readonly selectedIds: ReadonlySet<Id>
  readonly onToggleWorkspace: (collapseKey: string, collapsed: boolean) => void
  readonly onNewSessionInFolder: (groupId: Id | null, folder: string) => void
  readonly groupSections: readonly Section[]
  readonly statusSections: readonly StatusSectionData[]
  readonly onListKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  readonly onToggleGroupCollapsed: (groupId: Id) => void
  readonly onToggleStatusCollapsed: (sectionKey: string, collapsed: boolean) => void
  readonly onSelect: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onStartRenameSession: (id: Id) => void
  readonly onRenameSession: (id: Id, name: string) => void
  readonly onCancelRename: () => void
  readonly onStartRenameGroup: (groupId: Id) => void
  readonly onRenameGroup: (groupId: Id, name: string) => void
  readonly onCloseSession: (id: Id) => void
  readonly onForkSession?: (id: Id) => void
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

export function SessionList(props: SessionListProps): ReactElement {
  // One lookup table per store data, shared by every row: a row used to scan statuses/groups with `find`.
  const statusById = useMemo((): ReadonlyMap<Id, StatusDef> => indexById(props.data.statuses), [props.data.statuses])
  const groupById = useMemo((): ReadonlyMap<Id, Group> => indexById(props.data.groups), [props.data.groups])

  return (
    <div
      role="tree"
      aria-label="Sessions"
      aria-multiselectable={true}
      tabIndex={0}
      onKeyDown={props.onListKeyDown}
      className="flex flex-col gap-0.5 outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
    >
      {props.groupBy === 'groups'
        ? props.groupSections.map((section): ReactElement => (
            <GroupSection
              key={section.group?.id ?? 'ungrouped'}
              group={section.group}
              sessions={section.sessions}
              data={props.data}
              statusById={statusById}
              runtime={props.runtime}
              lastChange={props.lastChange}
              now={props.now}
              activeId={props.activeId}
              renamingGroupId={props.renamingGroupId}
              renamingSessionId={props.renamingSessionId}
              drag={props.drag}
              dropOver={props.dropOver}
              groupBy={props.groupBy}
              draggableSessions={true}
              draggableGroupHeader={section.group !== null}
              showWorkspaces={props.showWorkspaces}
              workspaceCollapsed={props.workspaceCollapsed}
              selectedIds={props.selectedIds}
              onToggleWorkspace={props.onToggleWorkspace}
              onNewSessionInFolder={props.onNewSessionInFolder}
              onToggleCollapsed={props.onToggleGroupCollapsed}
              onSelect={props.onSelect}
              onStartRenameSession={props.onStartRenameSession}
              onRenameSession={props.onRenameSession}
              onCancelRename={props.onCancelRename}
              onStartRenameGroup={props.onStartRenameGroup}
              onRenameGroup={props.onRenameGroup}
              onCloseSession={props.onCloseSession}
              onForkSession={props.onForkSession}
              onMoveToCode={props.onMoveToCode}
              onSetSessionStatus={props.onSetSessionStatus}
              onMoveSession={props.onMoveSession}
              onCreateGroupAndMove={props.onCreateGroupAndMove}
              onRequestRemoveSession={props.onRequestRemoveSession}
              onRemoveGroup={props.onRemoveGroup}
              onNewSession={props.onNewSession}
              onDragStartSession={props.onDragStartSession}
              onDragStartGroup={props.onDragStartGroup}
              onDragOverSession={props.onDragOverSession}
              onDragOverUngrouped={props.onDragOverUngrouped}
              onDropItem={props.onDropItem}
              onDragEnd={props.onDragEnd}
            />
          ))
        : props.statusSections.map((section): ReactElement => (
            <StatusSection
              key={section.key}
              sectionKey={section.key}
              label={section.label}
              statusId={section.statusId}
              color={section.color}
              sessions={section.sessions}
              data={props.data}
              statusById={statusById}
              groupById={groupById}
              runtime={props.runtime}
              lastChange={props.lastChange}
              now={props.now}
              activeId={props.activeId}
              renamingSessionId={props.renamingSessionId}
              drag={props.drag}
              dropOver={props.dropOver}
              collapsed={props.statusCollapsed.get(section.key) ?? false}
              draggableSessions={true}
              selectedIds={props.selectedIds}
              onToggleCollapsed={props.onToggleStatusCollapsed}
              onSelect={props.onSelect}
              onStartRenameSession={props.onStartRenameSession}
              onRenameSession={props.onRenameSession}
              onCancelRename={props.onCancelRename}
              onCloseSession={props.onCloseSession}
              onForkSession={props.onForkSession}
              onMoveToCode={props.onMoveToCode}
              onSetSessionStatus={props.onSetSessionStatus}
              onMoveSession={props.onMoveSession}
              onCreateGroupAndMove={props.onCreateGroupAndMove}
              onRequestRemoveSession={props.onRequestRemoveSession}
              onDragStartSession={props.onDragStartSession}
              onDragOverSession={props.onDragOverSession}
              onDropItem={props.onDropItem}
              onDragEnd={props.onDragEnd}
            />
          ))}
    </div>
  )
}