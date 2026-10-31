import { Settings, Tag } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Id, RuntimeState, Session, StoreData } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import {
  countByStatus,
  dropEmptySections,
  filterBySearch,
  filterByStatus,
  filterStatusSectionsBySearch,
  filterStatusSectionsByStatus,
  flatSessionIds,
  groupByStatus,
  groupedSessions,
  isClosed,
  pruneStatusFilter,
  splitClosed
} from '../state/selectors'
import { useMultiSelect } from '../state/useMultiSelect'
import { useBulkActions } from '../state/useBulkActions'
import { computeDrop, type DragItem, type DropOver } from '../state/dropTarget'
import { BulkActionBar } from '../components/BulkActionBar'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Separator } from '../components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { ClosedSection } from './ClosedSection'
import { ConfirmDialog } from './ConfirmDialog'
import { ErrorBanner } from './ErrorBanner'
import { SessionsHeader } from './SessionsHeader'
import { SessionList } from './SessionList'
import { SidebarNav } from './SidebarNav'
import { DEFAULT_GROUP_NAME, toggleStatusFilter } from './uiLogic'
import { ignoreRejection } from './ignoreRejection'
import { useGlobalNewSessionShortcut, useSidebarListKeyDown } from './useSidebarKeyboard'
import { useLastRuntimeChange } from './useLastRuntimeChange'
import {
  RELATIVE_TIME_INTERVAL_MS,
  readClosedCollapsed,
  readGroupBy,
  readShowWorkspaces,
  readStatusCollapsed,
  readWorkspaceCollapsed,
  writeClosedCollapsed,
  writeGroupBy,
  writeShowWorkspaces,
  writeStatusCollapsed,
  writeWorkspaceCollapsed,
  type GroupBy,
  type StatusCollapsedMap
} from './sidebarPrefs'

export interface SidebarProps {
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  /** Optional override for the per-session last runtime change time. When omitted the sidebar derives it from `runtime`. */
  readonly runtimeLastChange?: ReadonlyMap<Id, number>
  readonly activeId: Id | null
  readonly onSelect: (id: Id) => void
  readonly onReopen: (id: Id) => void
  readonly actions: SessionActions
  readonly onNewSession: (groupId?: Id | null, folder?: string) => void
  readonly onEditStatuses: () => void
  readonly onOpenHub?: () => void
  readonly hubActive?: boolean
  readonly onOpenSettings?: () => void
  readonly lastError: string | null
  readonly clearError: () => void
}

interface PendingRemove {
  readonly kind: 'session' | 'group'
  readonly id: Id
  readonly name: string
  /** Only meaningful for sessions: true when the session lives in the Closed section. */
  readonly closed: boolean
}

export function Sidebar(props: SidebarProps): ReactElement {
  const { data, runtime, activeId, actions, onSelect, onReopen, onNewSession, onEditStatuses } = props

  const internalLastChange = useLastRuntimeChange(runtime)
  const lastChange: ReadonlyMap<Id, number> = props.runtimeLastChange ?? internalLastChange

  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy)
  const [selectedStatuses, setSelectedStatuses] = useState<ReadonlySet<Id | null>>(
    (): ReadonlySet<Id | null> => new Set()
  )
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState<Id | null>(null)
  const [renamingGroupId, setRenamingGroupId] = useState<Id | null>(null)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [dropOver, setDropOver] = useState<DropOver | null>(null)
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(null)
  const [closedCollapsed, setClosedCollapsed] = useState<boolean>(readClosedCollapsed)
  const [statusCollapsed, setStatusCollapsed] = useState<StatusCollapsedMap>(readStatusCollapsed)
  const [showWorkspaces, setShowWorkspaces] = useState<boolean>(readShowWorkspaces)
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState<StatusCollapsedMap>(readWorkspaceCollapsed)
  const [now, setNow] = useState<number>(Date.now)

  useEffect((): (() => void) => {
    const interval = window.setInterval((): void => setNow(Date.now()), RELATIVE_TIME_INTERVAL_MS)
    return (): void => window.clearInterval(interval)
  }, [])

  useEffect((): void => writeGroupBy(groupBy), [groupBy])
  useEffect((): void => writeClosedCollapsed(closedCollapsed), [closedCollapsed])
  useEffect((): void => writeStatusCollapsed(statusCollapsed), [statusCollapsed])
  useEffect((): void => writeShowWorkspaces(showWorkspaces), [showWorkspaces])
  useEffect((): void => writeWorkspaceCollapsed(workspaceCollapsed), [workspaceCollapsed])

  useGlobalNewSessionShortcut(useCallback((): void => onNewSession(), [onNewSession]), pendingRemove !== null)

  const effectiveStatuses = useMemo(
    (): ReadonlySet<Id | null> => pruneStatusFilter(selectedStatuses, data.statuses),
    [selectedStatuses, data.statuses]
  )
  const filterActive = searchValue.trim().length > 0 || effectiveStatuses.size > 0
  const groupSections = useMemo(
    (): ReturnType<typeof groupedSessions> =>
      dropEmptySections(
        filterBySearch(filterByStatus(groupedSessions(data), effectiveStatuses), searchValue),
        filterActive
      ),
    [data, effectiveStatuses, searchValue, filterActive]
  )
  const statusSections = useMemo(
    (): ReturnType<typeof filterStatusSectionsBySearch> =>
      dropEmptySections(
        filterStatusSectionsBySearch(
          filterStatusSectionsByStatus(groupByStatus(data), effectiveStatuses),
          searchValue
        ),
        filterActive
      ),
    [data, effectiveStatuses, searchValue, filterActive]
  )
  const counts = useMemo(() => countByStatus(data), [data])
  const { open: openSessions, closed: closedSessions } = useMemo(() => splitClosed(data), [data])
  const flatIds = useMemo((): readonly Id[] => {
    if (groupBy === 'groups') return flatSessionIds(groupSections, workspaceCollapsed, showWorkspaces)
    const ids: Id[] = []
    for (const section of statusSections) {
      if (statusCollapsed.get(section.key) ?? false) continue
      for (const session of section.sessions) ids.push(session.id)
    }
    return ids
  }, [groupBy, groupSections, statusSections, statusCollapsed, workspaceCollapsed, showWorkspaces])

  const renameSession = useCallback((id: Id, name: string): void => {
    setRenamingSessionId(null)
    ignoreRejection(actions.renameSession(id, name))
  }, [actions])

  const renameGroup = useCallback((id: Id, name: string): void => {
    setRenamingGroupId(null)
    ignoreRejection(actions.renameGroup(id, name))
  }, [actions])

  const createGroupAndRename = useCallback((): void => {
    ignoreRejection(actions.createGroup(DEFAULT_GROUP_NAME).then((group): void => {
      setRenamingGroupId(group.id)
    }))
  }, [actions])

  const createGroupAndMove = useCallback((sessionId: Id): void => {
    ignoreRejection(actions.createGroup(DEFAULT_GROUP_NAME).then(async (group): Promise<void> => {
      const siblings = data.sessions.filter(
        (session): boolean => session.groupId === group.id && session.id !== sessionId
      )
      await actions.moveSession(sessionId, group.id, siblings.length)
      setRenamingGroupId(group.id)
    }))
  }, [actions, data.sessions])

  const moveToGroupEnd = useCallback((sessionId: Id, groupId: Id | null): void => {
    const index = data.sessions.filter(
      (session): boolean => session.groupId === groupId && session.id !== sessionId
    ).length
    ignoreRejection(actions.moveSession(sessionId, groupId, index))
  }, [actions, data.sessions])

  const requestRemoveSession = useCallback((id: Id): void => {
    const session = openSessions.find((candidate): boolean => candidate.id === id)
    if (session === undefined) return
    setPendingRemove({ kind: 'session', id, name: session.name, closed: false })
  }, [openSessions])

  const requestRemoveClosedSession = useCallback((id: Id): void => {
    const session = closedSessions.find((candidate): boolean => candidate.id === id)
    if (session === undefined) return
    setPendingRemove({ kind: 'session', id, name: session.name, closed: true })
  }, [closedSessions])

  const requestRemoveGroup = useCallback((id: Id): void => {
    const group = data.groups.find((candidate): boolean => candidate.id === id)
    if (group === undefined) return
    setPendingRemove({ kind: 'group', id, name: group.name, closed: false })
  }, [data.groups])

  const confirmRemove = useCallback((): void => {
    const pending = pendingRemove
    if (pending === null) return
    setPendingRemove(null)
    if (pending.kind === 'group') {
      ignoreRejection(actions.removeGroup(pending.id))
    } else {
      ignoreRejection(actions.removeSession(pending.id))
    }
  }, [actions, pendingRemove])

  const closeSession = useCallback((id: Id): void => {
    ignoreRejection(actions.closeSession(id))
  }, [actions])

  const handleSelect = useCallback((id: Id): void => {
    if (closedSessions.some((session): boolean => session.id === id)) return
    onSelect(id)
  }, [closedSessions, onSelect])

  // W4 bulk selection: Ctrl/Cmd+click toggles without opening, Shift+click ranges over flatIds,
  // a plain click opens and clears, Esc clears. Actions always apply in flatIds order.
  const multi = useMultiSelect(flatIds, handleSelect)
  const selectedSessions = useMemo(
    (): readonly Session[] => multi.selectedIds
      .map((id): Session | undefined => data.sessions.find((session): boolean => session.id === id))
      .filter((session): session is Session => session !== undefined && !isClosed(session)),
    [multi.selectedIds, data.sessions]
  )
  const bulk = useBulkActions(multi.selectedIds, data.sessions, runtime, {
    sleep: (id): Promise<void> => window.api.sleepSession(id),
    wake: onSelect,
    setStatus: actions.setSessionStatus,
    move: actions.moveSession,
    setQueue: actions.setSessionQueue
  })

  const handleStartRenameSession = useCallback((id: Id): void => {
    setRenamingSessionId(id)
    setRenamingGroupId(null)
  }, [])

  const handleStartRenameGroup = useCallback((id: Id): void => {
    setRenamingGroupId(id)
    setRenamingSessionId(null)
  }, [])

  const handleCancelRename = useCallback((): void => {
    setRenamingSessionId(null)
    setRenamingGroupId(null)
  }, [])

  const handleDropItem = useCallback((): void => {
    const currentDrag = drag
    const currentOver = dropOver
    setDrag(null)
    setDropOver(null)
    if (currentDrag === null || currentOver === null) return
    const action = computeDrop(currentDrag, currentOver, data)
    if (action === null) return
    if (action.type === 'moveSession') {
      ignoreRejection(actions.moveSession(action.sessionId, action.groupId, action.index))
    } else {
      ignoreRejection(actions.reorderGroups(action.order))
    }
  }, [drag, dropOver, data, actions])

  const handleListKeyDown = useSidebarListKeyDown({
    flatIds,
    activeId,
    onSelect: handleSelect,
    onStartRename: handleStartRenameSession,
    onRequestRemove: requestRemoveSession
  })

  const toggleStatus = useCallback((id: Id | null): void => {
    setSelectedStatuses((previous): ReadonlySet<Id | null> => toggleStatusFilter(previous, id))
  }, [])

  const toggleGroupCollapsed = useCallback((groupId: Id): void => {
    const group = data.groups.find((candidate): boolean => candidate.id === groupId)
    ignoreRejection(actions.setGroupCollapsed(groupId, !(group?.collapsed ?? false)))
  }, [actions, data.groups])

  const toggleStatusCollapsed = useCallback((sectionKey: string, collapsed: boolean): void => {
    setStatusCollapsed((previous): StatusCollapsedMap => {
      const next = new Map(previous)
      next.set(sectionKey, collapsed)
      return next
    })
  }, [])

  const toggleWorkspaceCollapsed = useCallback((collapseKey: string, collapsed: boolean): void => {
    setWorkspaceCollapsed((previous): StatusCollapsedMap => {
      const next = new Map(previous)
      next.set(collapseKey, collapsed)
      return next
    })
  }, [])

  const newSessionInFolder = useCallback((groupId: Id | null, folder: string): void => {
    onNewSession(groupId, folder)
  }, [onNewSession])

  const showEmpty = openSessions.length === 0

  return (
    <aside className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-worktree-sidebar text-worktree-sidebar-foreground">
      {props.lastError !== null && (
        <ErrorBanner message={props.lastError} onDismiss={props.clearError} />
      )}
      <SidebarNav
        searchOpen={searchOpen}
        searchValue={searchValue}
        onToggleSearch={(): void => setSearchOpen((v) => !v)}
        onSearchChange={setSearchValue}
        onClearSearch={(): void => {
          setSearchValue('')
          setSearchOpen(false)
        }}
        onNewSession={onNewSession}
        onOpenHub={props.onOpenHub}
        hubActive={props.hubActive}
      />
      <SessionsHeader
        groupBy={groupBy}
        showWorkspaces={showWorkspaces}
        onShowWorkspacesChange={setShowWorkspaces}
        statuses={data.statuses}
        selectedStatuses={effectiveStatuses}
        counts={counts}
        onGroupByChange={setGroupBy}
        onToggleStatus={toggleStatus}
        onNewGroup={createGroupAndRename}
        onNewSession={(): void => onNewSession()}
      />
      <Separator className="my-1 bg-sidebar-border" />
      <ScrollArea className="min-h-0 flex-1" viewportClassName="scrollbar-sleek py-1" viewportTabIndex={-1}>
        <SessionList
          groupBy={groupBy}
          data={data}
          runtime={runtime}
          lastChange={lastChange}
          now={now}
          activeId={activeId}
          renamingSessionId={renamingSessionId}
          renamingGroupId={renamingGroupId}
          drag={drag}
          dropOver={dropOver}
          statusCollapsed={statusCollapsed}
          showWorkspaces={showWorkspaces}
          workspaceCollapsed={workspaceCollapsed}
          selectedIds={multi.selection.ids}
          onToggleWorkspace={toggleWorkspaceCollapsed}
          onNewSessionInFolder={newSessionInFolder}
          groupSections={groupSections}
          statusSections={statusSections}
          onListKeyDown={handleListKeyDown}
          onToggleGroupCollapsed={toggleGroupCollapsed}
          onToggleStatusCollapsed={toggleStatusCollapsed}
          onSelect={multi.handleClick}
          onStartRenameSession={handleStartRenameSession}
          onRenameSession={renameSession}
          onCancelRename={handleCancelRename}
          onStartRenameGroup={handleStartRenameGroup}
          onRenameGroup={renameGroup}
          onCloseSession={closeSession}
          onSetSessionStatus={(id, statusId): void => ignoreRejection(actions.setSessionStatus(id, statusId))}
          onMoveSession={moveToGroupEnd}
          onCreateGroupAndMove={createGroupAndMove}
          onRequestRemoveSession={requestRemoveSession}
          onRemoveGroup={requestRemoveGroup}
          onNewSession={onNewSession}
          onDragStartSession={(id): void => setDrag({ kind: 'session', id })}
          onDragStartGroup={(id): void => setDrag({ kind: 'group', id })}
          onDragOverSession={setDropOver}
          onDragOverUngrouped={(): void => setDropOver({ kind: 'ungrouped', position: 'inside' })}
          onDropItem={handleDropItem}
          onDragEnd={(): void => { setDrag(null); setDropOver(null) }}
        />
        {showEmpty && (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-[12px] text-muted-foreground/70">
            {data.sessions.length === 0
              ? 'No sessions yet. Create one to get started.'
              : filterActive
                ? 'No sessions match the filter.'
                : 'No open sessions. Resume one from Closed.'}
          </div>
        )}
      </ScrollArea>
      {closedSessions.length > 0 && (
        <ClosedSection
          sessions={closedSessions}
          collapsed={closedCollapsed}
          onToggle={(): void => setClosedCollapsed((v) => !v)}
          onResume={onReopen}
          onRequestDelete={requestRemoveClosedSession}
        />
      )}
      {selectedSessions.length > 0 && (
        <div className="shrink-0 px-2 pb-1">
          <BulkActionBar
            count={selectedSessions.length}
            sleepCount={bulk.sleepIds.length}
            wakeCount={bulk.wakeIds.length}
            statuses={data.statuses}
            groups={data.groups}
            busy={bulk.busy}
            onSleep={bulk.sleep}
            onWake={bulk.wake}
            onSetStatus={bulk.setStatus}
            onMoveToGroup={bulk.moveToGroup}
            promptPlan={bulk.promptPlan}
            onSendPrompt={bulk.sendPrompt}
            onClear={multi.clear}
          />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Edit statuses"
              onClick={onEditStatuses}
              className="text-muted-foreground"
            >
              <Tag className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Statuses</TooltipContent>
        </Tooltip>
        {props.onOpenSettings !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Settings"
                onClick={props.onOpenSettings}
                className="text-muted-foreground"
              >
                <Settings className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>Settings</TooltipContent>
          </Tooltip>
        )}
      </div>
      {pendingRemove !== null && (
        <ConfirmDialog
          title={
            pendingRemove.kind === 'group'
              ? 'Delete group'
              : pendingRemove.closed
                ? 'Delete session'
                : 'Remove session'
          }
          message={
            pendingRemove.kind === 'group'
              ? `Delete group “${pendingRemove.name}”? Its sessions become ungrouped.`
              : pendingRemove.closed
                ? `Permanently delete session “${pendingRemove.name}”? This cannot be undone.`
                : `Remove session “${pendingRemove.name}”?`
          }
          confirmLabel={pendingRemove.kind === 'group' ? 'Delete' : pendingRemove.closed ? 'Delete' : 'Remove'}
          onConfirm={confirmRemove}
          onCancel={(): void => setPendingRemove(null)}
        />
      )}
    </aside>
  )
}