// Code mode sidebar (D31): repo > worktree > sessions, in Orca's look. Reuses the Ops nav, error banner, Closed
// section, confirm dialog and keyboard hook; see CodeSessionCard for the one local equivalent.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { registerSidebarView, type SidebarViewControl } from '../../jarvis/sidebarView'
import type { Id, RuntimeState, StoreData } from '../../../shared/types'
import type { SessionActions } from '../../state/useSessionStore'
import { ClosedSection } from '../../Sidebar/ClosedSection'
import { ConfirmDialog } from '../../Sidebar/ConfirmDialog'
import { ErrorBanner } from '../../Sidebar/ErrorBanner'
import { SidebarNav } from '../../Sidebar/SidebarNav'
import { useSidebarListKeyDown } from '../../Sidebar/useSidebarKeyboard'
import { Separator } from '../../components/ui/separator'
import { ScrollArea } from '../../components/ui/scroll-area'
import { AddRepositoryButton, CodeSidebarFooter, NoMatchesHint, NoRepositoriesHint } from './CodeSidebarParts'
import { CodeTreeList } from './CodeTreeList'
import { useCodeSidebar } from './useCodeSidebar'
import { useCodeTreeModel } from './useCodeTreeModel'
import type { CodeTreeView } from './codeTreeView'
import { SortMenu } from '../../Sidebar/SortMenu'
import { RemoveWorktreeDialog } from './RemoveWorktreeDialog'
import { worktreeSessionCount } from './codeTree'
import { DEFAULT_SESSION_SORT, type SessionSort } from '../../state/sessionSort'
import { useSortFreeze } from '../../state/useSessionSort'

export interface CodeSidebarProps {
  /** Store data whose `sessions` are ONLY Code mode sessions (worktreeId present); repos/worktrees/statuses as stored. */
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly runtimeLastChange?: ReadonlyMap<Id, number>
  readonly activeId: Id | null
  readonly onSelect: (id: Id) => void
  readonly onReopen: (id: Id) => void
  /** D52: forks a Claude session and opens the fork. Absent = no menu item. */
  readonly onForkSession?: (id: Id) => void
  /** D82: shows the session's Changes tab in the side panel. Absent = no menu item. */
  readonly onViewChanges?: (id: Id) => void
  readonly actions: SessionActions
  /** "New worktree" (repo header button / empty state). repoId undefined = let the dialog pick the first repo. */
  readonly onNewWorktree: (repoId?: Id) => void
  /** "New session in this worktree" (worktree row button / menu). */
  readonly onNewSessionInWorktree: (worktreeId: Id) => void
  readonly onEditStatuses: () => void
  /** D61: how sessions are ordered inside each worktree (absent = Manual, no sort menu). */
  readonly sort?: SessionSort
  readonly onSortChange?: (sort: SessionSort) => void
  readonly onOpenHub?: () => void
  readonly hubActive?: boolean
  readonly onOpenSettings?: () => void
  readonly lastError: string | null
  readonly clearError: () => void
}

export function CodeSidebar(props: CodeSidebarProps): ReactElement | null {
  const { data, runtime, activeId, onSelect, onReopen, onNewWorktree, onNewSessionInWorktree, actions } = props
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [closedCollapsed, setClosedCollapsed] = useState(true)
  const sort = props.sort ?? DEFAULT_SESSION_SORT
  const sortFreeze = useSortFreeze(data.sessions, sort, runtime)

  // D58: Jarvis sets the search and the Closed section like the header buttons (repo/worktree collapse is stored).
  const viewControl = useRef<SidebarViewControl | null>(null)
  viewControl.current = {
    state: () => ({ groupBy: null, showWorkspaces: null, search: searchValue, statusFilter: null, closedCollapsed, sort: props.onSortChange !== undefined ? sort : null }),
    statusNames: () => new Map(),
    setSearch: (value: string): void => {
      setSearchValue(value)
      if (value.length > 0) setSearchOpen(true)
    },
    setClosedCollapsed,
    setSort: props.onSortChange
  }
  useEffect(() => registerSidebarView({
    state: () => viewControl.current!.state(),
    statusNames: () => viewControl.current!.statusNames(),
    setSearch: (v) => viewControl.current!.setSearch(v),
    setClosedCollapsed: (v) => viewControl.current!.setClosedCollapsed(v),
    setSort: (v) => viewControl.current!.setSort?.(v)
  }), [])

  const controller = useCodeSidebar({ data, actions, onSelect, onNewWorktree, onNewSessionInWorktree })
  const model = useCodeTreeModel({ data, searchValue, runtime, runtimeLastChange: props.runtimeLastChange, sort, frozen: sortFreeze.frozen })
  const handleListKeyDown = useSidebarListKeyDown({
    flatIds: model.flatIds,
    activeId,
    onSelect,
    onStartRename: controller.handlers.onStartRename,
    onRequestRemove: controller.handlers.onRequestRemoveSession
  })

  // One object per real input change: a runtime batch still rebuilds it (rows compare the field they show), but a
  // parent re-render with unchanged inputs no longer hands every row a fresh view.
  const view: CodeTreeView = useMemo(
    (): CodeTreeView => ({
      data,
      runtime,
      lastChange: model.lastChange,
      now: model.now,
      activeId,
      renamingId: controller.renamingId,
      searching: model.searching,
      changeCounts: model.changeCounts,
      actions,
      commands: controller.commands,
      handlers: controller.handlers,
      onForkSession: props.onForkSession,
      onViewChanges: props.onViewChanges
    }),
    [
      data, runtime, model.lastChange, model.now, activeId, controller.renamingId, model.searching,
      model.changeCounts, actions, controller.commands, controller.handlers, props.onForkSession, props.onViewChanges
    ]
  )

  const bannerMessage = controller.localError ?? props.lastError
  const hasRepos = model.tree.repos.length > 0
  const noMatches = model.searching && model.shown.repos.length === 0 && model.shown.closed.length === 0

  return (
    <aside className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-worktree-sidebar text-worktree-sidebar-foreground">
      {bannerMessage !== null && (
        <ErrorBanner
          message={bannerMessage}
          onDismiss={controller.localError !== null ? controller.dismissLocalError : props.clearError}
        />
      )}
      <SidebarNav
        searchOpen={searchOpen}
        searchValue={searchValue}
        onToggleSearch={(): void => setSearchOpen((open) => !open)}
        onSearchChange={setSearchValue}
        onClearSearch={(): void => {
          setSearchValue('')
          setSearchOpen(false)
        }}
        onNewSession={(): void => onNewWorktree()}
        onOpenHub={props.onOpenHub}
        hubActive={props.hubActive}
      />
      <div className="flex items-start pr-2">
        <div className="min-w-0 flex-1">
          <AddRepositoryButton onClick={(): void => void controller.commands.addRepository()} />
        </div>
        {props.onSortChange !== undefined && <SortMenu sort={sort} onSortChange={props.onSortChange} />}
      </div>
      <Separator className="my-1 bg-sidebar-border" />
      <ScrollArea
        className="min-h-0 flex-1"
        viewportClassName="scrollbar-sleek py-1"
        viewportTabIndex={-1}
        onPointerEnter={sortFreeze.onPointerEnter}
        onPointerLeave={sortFreeze.onPointerLeave}
      >
        {hasRepos ? (
          <CodeTreeList tree={model.shown} view={view} onListKeyDown={handleListKeyDown} />
        ) : (
          <NoRepositoriesHint />
        )}
        {noMatches && <NoMatchesHint />}
      </ScrollArea>
      {model.shown.closed.length > 0 && (
        <ClosedSection
          sessions={model.shown.closed}
          collapsed={closedCollapsed}
          onToggle={(): void => setClosedCollapsed((collapsed) => !collapsed)}
          onResume={onReopen}
          onRequestDelete={controller.handlers.onRequestRemoveSession}
        />
      )}
      <CodeSidebarFooter onEditStatuses={props.onEditStatuses} onOpenSettings={props.onOpenSettings} />
      {controller.pendingWorktree !== null && (
        <RemoveWorktreeDialog
          worktree={controller.pendingWorktree}
          sessionCount={worktreeSessionCount(data, controller.pendingWorktree.id)}
          onConfirm={controller.confirmRemoveWorktree}
          onCancel={controller.cancelPending}
        />
      )}
      {controller.pending !== null && (
        <ConfirmDialog
          title={controller.pending.title}
          message={controller.pending.message}
          confirmLabel={controller.pending.confirmLabel}
          onConfirm={controller.pending.onConfirm}
          onCancel={controller.cancelPending}
        />
      )}
    </aside>
  )
}
