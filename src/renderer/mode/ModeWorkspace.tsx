// One mode's workspace (D31): sidebar, tab bar, terminals, Hub, worker view, side panel, status bar, dialogs and palette.
// Ops and Code each get their own instance (App mounts one at a time, keyed by mode) with mode-scoped storage keys.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Sidebar } from '../Sidebar'
import { useLastRuntimeChange } from '../Sidebar/useLastRuntimeChange'
import { CodeSidebar } from '../code/sidebar/CodeSidebar'
import { useTerminalPanes } from '../Terminal/useTerminalPanes'
import { useTerminalSearch } from '../Terminal/useTerminalSearch'
import { TerminalSearchBar } from '../Terminal/TerminalSearchBar'
import { TerminalContextMenu } from '../Terminal/TerminalContextMenu'
import { useTerminalMenu } from '../Terminal/useTerminalMenu'
import { useTermView } from '../Terminal/useTermView'
import { applyTerminalFontSize } from '../Terminal/paneFactory'
import type { GridPreset } from '../grid/gridLogic'
import { HubView } from '../hub/HubView'
import { NotesPanel } from '../notes'
import { progress } from '../notes/checklistLogic'
import { CommandPalette } from '../palette/CommandPalette'
import { CostDialog } from '../costs/CostDialog'
import { ConversationSearchDialog } from '../search/ConversationSearchDialog'
import { TerminalWorkspace } from '../Terminal/TerminalWorkspace'
import type { TerminalGridMode } from '../grid/GridCells'
import { WorkerView } from '../workers/WorkerView'
import { needsYouItems } from '../attention/needsYou'
import { useAttentionShortcuts } from '../attention/useAttentionShortcuts'
import { SidebarResizeHandle } from '../shell/SidebarResizeHandle'
import { SIDEBAR_KEEP_FOR_MAIN } from '../shell/sidebarWidth'
import { useViewportWidth } from '../shell/useViewportWidth'
import { useSidebarWidth } from '../shell/useSidebarWidth'
import { SIDE_PANEL_WIDTH_DEFAULT, SIDE_PANEL_WIDTH_PREVIEW, maxSidePanelWidth } from '../shell/sidePanelWidth'
import { useSidePanelWidth } from '../shell/useSidePanelWidth'
import { EmptyState } from '../shell/EmptyState'
import { StatusBar } from '../shell/StatusBar'
import { TabBar } from '../shell/TabBar'
import { projectTabIds } from '../shell/projectTabs'
import { SIDEBAR_STORAGE_KEY } from '../shell/shellPrefs'
import { usePersistedBoolean } from '../shell/usePersistedBoolean'
import { useSoundEnabled } from '../shell/useSoundEnabled'
import { useTabShortcuts } from '../shell/useTabShortcuts'
import { buildTabModels } from '../shell/tabStatus'
import { cn } from '../lib/utils'
import type { ChangesTarget } from '../code/changes'
import type { UseSessionStoreResult } from '../state/useSessionStore'
import type { UseUsageResult } from '../usage/useUsage'
import { resolveSettings, type Id, type RuntimeState, type Session, type SessionUsage, type StoreData, type UiMode } from '../../shared/types'
import { dataForMode, modeStorageKeys } from './modeLogic'
import { useSessionSort } from '../state/useSessionSort'
import { ModeTitleBar, type ModeChrome } from './ModeTitleBar'
import { useWorkspaceCommands } from './useWorkspaceCommands'
import { useWorkspaceNav, type FocusRequest } from './useWorkspaceNav'
import { planViewChangesPanel } from './viewChangesLogic'
import { WorkspaceDialogs } from './WorkspaceDialogs'
import { registerWorkspaceUi } from '../jarvis/jarvisUiBridge'
import { runWorkspaceAction, type WorkspaceUiContext } from '../jarvis/workspaceUi'
import { sidebarViewControl } from '../jarvis/sidebarView'
import { requestChangesFile } from '../code/changes/changesRequest'
import { readSidePanelTab, resolveSidePanelTab, storeSidePanelTab, type SidePanelTab } from '../timeline/sidePanelTab'
import { onFileViewRequest } from '../viewer/previewBus'
import type { PreviewRequest } from '../viewer/fileViewState'

const EMPTY_STORE: StoreData = { version: 1, sessions: [], groups: [], statuses: [], groupOrder: [] }
const CODE_EMPTY = {
  title: 'No open sessions',
  description: 'Add a repository, then create a worktree.',
  buttonLabel: 'New worktree'
} as const

/** Where diff comments get sent: the open session's pty, when its agent can receive typing right now. */
function changesTarget(session: Session, state: RuntimeState | undefined): ChangesTarget {
  return {
    sessionId: session.id,
    agent: session.agent ?? 'claude',
    active: state?.run === 'running' && state.sleeping !== true
  }
}

export interface ModeWorkspaceProps {
  readonly mode: UiMode
  readonly store: UseSessionStoreResult
  readonly usage: UseUsageResult
  readonly chrome: ModeChrome
  readonly focusRequest: FocusRequest | null
  readonly onFocusHandled: () => void
  readonly onShowAwaySummary: () => void
}

export function ModeWorkspace(props: ModeWorkspaceProps): ReactElement {
  const { mode, store, usage, chrome } = props
  const { runtime, actions } = store
  const data = useMemo((): StoreData | null => (store.data === null ? null : dataForMode(store.data, mode)), [store.data, mode])
  const keys = useMemo(() => modeStorageKeys(mode), [mode])
  const [sort, setSort] = useSessionSort(mode)
  const sessions = data?.sessions ?? null
  const nav = useWorkspaceNav({ keys, sessions, actions, focusRequest: props.focusRequest, onFocusHandled: props.onFocusHandled })
  const { tabs, split, workers, view } = nav
  const { activeId, ids } = tabs
  const activeSession = sessions?.find((s: Session): boolean => s.id === activeId) ?? null
  const commands = useWorkspaceCommands({
    mode, role: chrome.role, codePoppedOut: chrome.codePoppedOut, data, runtime, actions, nav, activeSession,
    onSwitchMode: chrome.onSwitch, onPopOutCode: chrome.onPopOutCode, onDockCode: chrome.onDockCode,
    onShowAwaySummary: props.onShowAwaySummary,
    // G10: the callback is read when the command runs, after this render has defined it below.
    onViewChanges: (id: Id): void => viewChanges(id)
  })
  const [sidebarOpen, setSidebarOpen] = usePersistedBoolean(SIDEBAR_STORAGE_KEY, true)
  // D70: the sidebar's edge is draggable; no width transition while the pointer is moving it.
  const sidebarWidth = useSidebarWidth()
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [soundEnabled, setSoundEnabled] = useSoundEnabled()
  const lastChange = useLastRuntimeChange(runtime)
  useTabShortcuts({ closeActive: tabs.closeActive, cycle: tabs.cycle })
  useAttentionShortcuts(commands.stepAttention)

  const settings = useMemo(() => resolveSettings(data?.settings), [data?.settings])
  const sessionUsage = useMemo(
    (): ReadonlyMap<Id, SessionUsage> => new Map(usage.state.sessions.map((s): [Id, SessionUsage] => [s.sessionId, s])),
    [usage.state.sessions]
  )
  const paneNames = useMemo(
    (): ReadonlyMap<Id, string> => new Map((sessions ?? []).map((s: Session): [Id, string] => [s.id, s.name])),
    [sessions]
  )
  const visibleIds = useMemo((): ReadonlySet<Id> => new Set(split.layout.paneIds), [split.layout.paneIds])
  const barIds = useMemo(() => projectTabIds(ids, sessions ?? [], activeId, runtime), [ids, sessions, activeId, runtime])
  const tabModels = useMemo(() => buildTabModels(barIds, sessions ?? [], runtime), [barIds, sessions, runtime])
  const needsYou = useMemo(() => needsYouItems(sessions ?? [], runtime), [sessions, runtime])
  // Stable tab callbacks (the memoized Tab skips a render when nothing about it changed): they read the latest tab ids from a ref.
  const barIdsRef = useRef<readonly Id[]>(barIds)
  barIdsRef.current = barIds
  const closeTab = tabs.close
  const closeOtherTabs = useCallback((keepId: Id): void => { barIdsRef.current.filter((id: Id): boolean => id !== keepId).forEach(closeTab) }, [closeTab])
  const closeAllTabs = useCallback((): void => { barIdsRef.current.forEach(closeTab) }, [closeTab])
  const openToSide = split.openToSide
  const openTabToSide = useCallback((id: Id): void => { openToSide(id) }, [openToSide])
  const activeState = activeId === null ? undefined : runtime.get(activeId)
  // Terminal comfort: the app-wide zoom/scrollback profile; zoom changes apply live to every mounted pane.
  const termViewApi = useTermView()
  // Ctrl+Shift+F inside an xterm pane goes through the pane's key handler; the ref bridges it to the hook below
  // (the hook needs the pane registry, which is created here).
  const openSearchRef = useRef<() => void>(() => undefined)
  // D59: a right-click in a pane opens the terminal menu; the ref bridges the pane to the menu hook below.
  const openMenuRef = useRef<(id: Id, point: { readonly x: number; readonly y: number }) => void>(() => undefined)
  const panes = useTerminalPanes(
    view === 'grid'
      ? nav.grid.layout.cells.filter((id): id is Id => id !== null)
      : split.layout.paneIds,
    ids,
    runtime,
    {
      termView: termViewApi.termView,
      onZoom: termViewApi.zoom,
      onSearch: (): void => openSearchRef.current(),
      onContextMenu: (id, point): void => openMenuRef.current(id, point)
    }
  )
  // Grid view: the workspace itself draws the cells (one host per xterm); a worker overlay hides it as before.
  const gridMode = useMemo(
    (): TerminalGridMode | undefined =>
      view === 'grid' && data !== null && workers.selected === null
        ? {
            layout: nav.grid.layout,
            sessions: (sessions ?? []).map((s: Session) => ({ id: s.id, name: s.name })),
            onFocusCell: nav.grid.focusCell,
            // Picking a session shows it: its tab opens too (cells only hold live sessions).
            onPickCell: (index: number, id: Id | null): void => {
              if (id !== null) tabs.open(id)
              nav.grid.setCell(index, id)
            }
          }
        : undefined,
    [view, data, workers.selected, nav.grid, sessions, tabs]
  )
  // Search belongs to the terminal and grid views, and not to the worker overlay.
  const searchEnabled = (view === 'terminal' || view === 'grid') && workers.selected === null
  const search = useTerminalSearch(panes, activeId, searchEnabled)
  useEffect((): void => {
    openSearchRef.current = search.open
  }, [search.open])
  const terminalMenu = useTerminalMenu({
    panes,
    sessions: sessions ?? [],
    focusSession: nav.activateTab,
    openSearch: search.open,
    split: view === 'terminal' && split.canSplit ? { splitRight: split.splitRight, splitDown: split.splitDown } : null,
    splitPaneIds: view === 'terminal' ? split.layout.paneIds : [],
    removePane: split.removePane,
    forkSession: commands.forkSession
  })
  openMenuRef.current = terminalMenu.open
  useEffect((): void => {
    for (const pane of panes.panesRef.current.values()) {
      if (pane.opened) {
        applyTerminalFontSize(pane.view, termViewApi.termView.zoomPercent)
      }
    }
  }, [termViewApi.termView.zoomPercent, panes.panesRef])
  // D55: Jarvis changes the screen through the same hooks as the buttons. A new side-panel tab remounts the panel.
  const [sidePanelEpoch, setSidePanelEpoch] = useState(0)
  // D73: a terminal file link asks this workspace to show its file in the side panel's Preview tab. The request stays
  // (also while the terminal view is away); a nonce makes the same link read again.
  const sidePanelWidth = useSidePanelWidth()
  // How wide the panel can really be: the window, minus the sidebar as DRAWN (it is capped by the window too), minus the terminal's room.
  const viewportWidth = useViewportWidth()
  const sidebarShown = sidebarOpen ? Math.min(sidebarWidth.width, viewportWidth - SIDEBAR_KEEP_FOR_MAIN) : 0
  const sidePanelMax = maxSidePanelWidth(viewportWidth, sidebarShown)
  const [sidePanelResizing, setSidePanelResizing] = useState(false)
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null)
  const previewNonce = useRef(0)
  const previewWidened = useRef(false)
  // "View changes" widens the panel once too (a diff is unreadable at the default width).
  const changesWidened = useRef(false)
  useEffect((): (() => void) => onFileViewRequest((request): void => {
    previewNonce.current += 1
    setPreviewRequest({ sessionId: request.sessionId, text: request.text, nonce: previewNonce.current })
    // Opens the panel when it is closed; an open panel is left as it is (it would toggle shut).
    if (!nav.notesOpen) nav.toggleNotes()
    storeSidePanelTab('preview', keys.sidePanel)
    setSidePanelEpoch((n: number): number => n + 1)
    // A table is unreadable at the default width: widen once, and only when the user never chose a width.
    if (!previewWidened.current) {
      previewWidened.current = true
      if (sidePanelWidth.width === SIDE_PANEL_WIDTH_DEFAULT) sidePanelWidth.commit(SIDE_PANEL_WIDTH_PREVIEW)
    }
  }), [keys.sidePanel, nav.notesOpen, nav.toggleNotes, sidePanelWidth.width, sidePanelWidth.commit])
  const closePreview = useCallback((): void => {
    setPreviewRequest(null)
    storeSidePanelTab('notes', keys.sidePanel)
    setSidePanelEpoch((n: number): number => n + 1)
  }, [keys.sidePanel])
  // The tab menu's "View changes" (Code mode): show that session in the terminal view with the panel on Changes.
  const viewChanges = useCallback((id: Id): void => {
    // The panel exists only in the terminal view, and in the grid activating a tab only focuses a cell: leave first.
    if (view !== 'terminal') nav.setView('terminal')
    // From the sidebar the session may have no tab yet: open it (opening never wakes a sleeping session), then show it.
    tabs.open(id)
    nav.activateTab(id)
    const plan = planViewChangesPanel({ notesOpen: nav.notesOpen, width: sidePanelWidth.width, widened: changesWidened.current })
    changesWidened.current = true
    if (plan.open) nav.toggleNotes()
    // The panel mounts (or remounts, via the epoch) on a tab it reads from storage, so the stored tab is set first.
    storeSidePanelTab('changes', keys.sidePanel)
    setSidePanelEpoch((n: number): number => n + 1)
    if (plan.width !== null) sidePanelWidth.commit(plan.width)
  }, [view, tabs.open, nav.setView, nav.activateTab, nav.notesOpen, nav.toggleNotes, keys.sidePanel, sidePanelWidth.width, sidePanelWidth.commit])
  // A preview belongs to the session whose folder resolved it: once that session is removed the request can only fail
  // (Reload keeps erroring), so it is dropped. `sessions` is null until the store arrives: nothing to decide yet.
  const previewSessionId = previewRequest?.sessionId ?? null
  const previewSessionGone = previewSessionId !== null && sessions !== null && !sessions.some((s: Session): boolean => s.id === previewSessionId)
  useEffect((): void => {
    if (previewSessionGone) closePreview()
  }, [previewSessionGone, closePreview])
  const jarvisUi = useRef<WorkspaceUiContext | null>(null)
  jarvisUi.current = {
    mode,
    view,
    setView: nav.setView,
    exitGrid: nav.exitGrid,
    names: paneNames,
    activeId,
    barIds,
    openTab: tabs.open,
    grid: nav.grid,
    split: {
      paneIds: split.layout.paneIds,
      canSplit: split.canSplit,
      splitRight: split.splitRight,
      splitDown: split.splitDown,
      unsplit: split.unsplit,
      openToSide: (id: Id, direction: 'right' | 'down'): void => { split.openToSide(id, direction === 'down' ? 'column' : 'row') }
    },
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth: { value: sidebarWidth.width, set: sidebarWidth.commit, reset: sidebarWidth.reset },
    sidePanel: {
      open: nav.notesOpen,
      tab: resolveSidePanelTab(readSidePanelTab(keys.sidePanel), activeSession?.worktreeId !== undefined, previewRequest !== null),
      hasChanges: activeSession?.worktreeId !== undefined,
      setOpen: (open: boolean): void => {
        if (!open) nav.closeNotes()
        else if (!nav.notesOpen) nav.toggleNotes()
      },
      setTab: (tab: SidePanelTab): void => {
        storeSidePanelTab(tab, keys.sidePanel)
        setSidePanelEpoch((n: number): number => n + 1)
      }
    },
    dialogs: {
      settings: commands.settingsSection,
      costs: commands.costsOpen,
      search: commands.searchOpen,
      palette: commands.paletteOpen,
      openSettings: commands.setSettingsSection,
      setCosts: commands.setCostsOpen,
      setSearch: commands.setSearchOpen,
      setPalette: commands.setPaletteOpen,
      showAway: props.onShowAwaySummary,
      openNew: (): void => { if (mode === 'code') commands.openNewWorktree(); else commands.openNew() }
    },
    zoom: { percent: termViewApi.termView.zoomPercent, step: termViewApi.zoom },
    workers: {
      visible: workers.visible.map((w) => ({ id: w.id, name: w.name })),
      selectedId: workers.selected?.id ?? null,
      select: workers.select,
      dismiss: workers.dismiss
    },
    sidebarView: sidebarViewControl,
    search: {
      active: search.active,
      query: search.query,
      label: search.label,
      open: search.open,
      close: search.close,
      setQuery: search.setQuery,
      step: search.step
    },
    tabs: { cycle: tabs.cycle, close: tabs.close },
    requestChangesFile
  }
  useEffect(() => registerWorkspaceUi(mode, (action) => {
    if (jarvisUi.current === null) throw new Error('The window is still loading.')
    return runWorkspaceAction(action, jarvisUi.current)
  }), [mode])

  const checklist = progress(activeSession?.checklist ?? [])
  const notesBadge = checklist.total > 0 ? `${checklist.done}/${checklist.total}` : null
  const loaded = data !== null
  const openSettings = (): void => commands.setSettingsSection('general')
  const editStatuses = (): void => commands.setSettingsSection('statuses')

  return (
    <>
      <div className="app-shell flex h-full min-h-0 w-full overflow-hidden bg-background font-sans text-foreground" data-ui-mode={mode}>
        <aside
          className={cn(
            'flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-worktree-sidebar',
            !sidebarResizing && 'transition-[width] duration-200',
            sidebarOpen ? 'border-r border-sidebar-border' : 'w-0'
          )}
          // The terminal area always keeps SIDEBAR_KEEP_FOR_MAIN px, so a small window never loses it to a wide sidebar.
          style={sidebarOpen ? { width: sidebarWidth.width, maxWidth: `calc(100vw - ${String(SIDEBAR_KEEP_FOR_MAIN)}px)` } : undefined}
        >
          <div className="flex h-full min-h-0 flex-col" style={{ width: sidebarWidth.width }}>
            <ModeTitleBar chrome={chrome} mode={mode} needsYou={needsYou} onOpenSession={nav.selectSession} onHideSidebar={(): void => setSidebarOpen(false)} />
            <div className="flex min-h-0 flex-1 flex-col">
              {mode === 'code' ? (
                <CodeSidebar
                  data={data ?? EMPTY_STORE}
                  runtime={runtime}
                  runtimeLastChange={lastChange}
                  activeId={activeId}
                  onSelect={nav.selectSession}
                  onReopen={nav.reopenSession}
                  onForkSession={commands.forkSession}
                  onViewChanges={viewChanges}
                  actions={actions}
                  onNewWorktree={commands.openNewWorktree}
                  onNewSessionInWorktree={commands.openNewInWorktree}
                  sort={sort}
                  onSortChange={setSort}
                  onEditStatuses={editStatuses}
                  onOpenHub={(): void => nav.setView('hub')}
                  hubActive={view === 'hub'}
                  onOpenSettings={openSettings}
                  lastError={store.lastError}
                  clearError={store.clearError}
                />
              ) : (
                <Sidebar
                  data={data ?? EMPTY_STORE}
                  runtime={runtime}
                  activeId={activeId}
                  onSelect={nav.selectSession}
                  onReopen={nav.reopenSession}
                  onForkSession={commands.forkSession}
                  onMoveToCode={(id): void => commands.openNewWorktree(undefined, id)}
                  onMoveSessionsToCode={commands.openMoveSessionsToCode}
                  actions={actions}
                  onNewSession={commands.openNew}
                  sort={sort}
                  onSortChange={setSort}
                  onEditStatuses={editStatuses}
                  onOpenHub={(): void => nav.setView('hub')}
                  hubActive={view === 'hub'}
                  onOpenSettings={openSettings}
                  runtimeLastChange={lastChange}
                  lastError={store.lastError}
                  clearError={store.clearError}
                />
              )}
            </div>
          </div>
        </aside>
        {sidebarOpen ? (
          <div className="relative z-30 w-0 shrink-0">
            <SidebarResizeHandle
              width={sidebarWidth.width}
              onDrag={sidebarWidth.setLive}
              onCommit={sidebarWidth.commit}
              onReset={sidebarWidth.reset}
              onDraggingChange={setSidebarResizing}
            />
          </div>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabBar
            tabs={tabModels}
            activeId={view === 'hub' || workers.selected !== null ? null : activeId}
            sidebarCollapsed={!sidebarOpen}
            onShowSidebar={(): void => setSidebarOpen(true)}
            onActivate={nav.activateTab}
            onClose={tabs.close}
            onCloseOthers={closeOtherTabs}
            onCloseAll={closeAllTabs}
            onViewChanges={viewChanges}
            onNewSession={(): void => commands.openNew()}
            hubActive={view === 'hub'}
            onOpenHub={(): void => nav.setView('hub')}
            onToggleNotes={activeSession !== null && view === 'terminal' ? nav.toggleNotes : undefined}
            notesOpen={nav.notesOpen}
            notesBadge={notesBadge}
            workers={{ workers: workers.visible, selectedId: workers.selected?.id ?? null, onSelect: workers.select, onDismiss: workers.dismiss }}
            grid={{
              active: view === 'grid',
              preset: view === 'grid' ? nav.grid.layout.preset : null,
              onOpenGrid: (preset: string): void => {
                nav.grid.setPreset(preset as GridPreset)
                nav.setView('grid')
              },
              onExitGrid: nav.exitGrid
            }}
            split={{
              active: split.split,
              canSplit: split.canSplit,
              visibleIds,
              onSplitRight: split.splitRight,
              onSplitDown: split.splitDown,
              onUnsplit: split.unsplit,
              onOpenToSide: openTabToSide
            }}
          />
          <div className="flex min-h-0 flex-1">
            <div className="relative min-h-0 min-w-0 flex-1 bg-black">
              {loaded ? (
                <TerminalWorkspace
                  sessionIds={ids}
                  layout={split.layout}
                  activeId={view === 'hub' ? null : activeId}
                  runtime={runtime}
                  names={paneNames}
                  panes={panes}
                  grid={gridMode}
                  onFocusPane={nav.activateTab}
                  onClosePane={split.removePane}
                  onResize={split.resize}
                  onResizeEnd={split.commitLayout}
                  onEqualize={split.equalize}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
              )}
              {loaded && view === 'hub' && data !== null ? (
                <div className="absolute inset-0 z-10 bg-background">
                  <HubView
                    data={data}
                    runtime={runtime}
                    lastChange={lastChange}
                    activeId={activeId}
                    sort={sort}
                    onOpenSession={nav.selectSession}
                    onSetStatus={(id, statusId): void => { void actions.setSessionStatus(id, statusId) }}
                    onSleepSession={(id): Promise<void> => window.api.sleepSession(id)}
                    onMoveSession={(id, groupId, index): Promise<void> => actions.moveSession(id, groupId, index)}
                    onSetQueue={actions.setSessionQueue}
                    onNewSession={commands.openNewInStatus}
                    onEditStatuses={editStatuses}
                    onReopen={nav.reopenSession}
                    sessionUsage={sessionUsage}
                    scrollToBusiest={settings.hub.scrollToBusiest}
                    onShowCosts={(): void => commands.setCostsOpen(true)}
                  />
                </div>
              ) : null}
              {loaded && view === 'terminal' && workers.selected !== null ? (
                <div className="absolute inset-0 z-10 bg-black">
                  <WorkerView key={workers.selected.id} worker={workers.selected} />
                </div>
              ) : null}
              {loaded && ids.length === 0 && view !== 'hub' ? (
                <div className="absolute inset-0 bg-black">
                  {mode === 'code'
                    ? <EmptyState onNewSession={(): void => commands.openNewWorktree()} {...CODE_EMPTY} />
                    : <EmptyState onNewSession={(): void => commands.openNew()} />}
                </div>
              ) : null}
              <TerminalContextMenu {...terminalMenu.menu} />
              {search.active ? (
                <TerminalSearchBar
                  query={search.query}
                  label={search.label}
                  inputRef={search.inputRef}
                  onQueryChange={search.setQuery}
                  onKeyDown={search.handleKeyDown}
                  onClose={search.close}
                />
              ) : null}
            </div>
            {nav.notesOpen && view === 'terminal' && activeSession !== null ? (
              <NotesPanel
                key={`${activeSession.id}:${String(sidePanelEpoch)}`}
                session={activeSession}
                actions={actions}
                onClose={nav.closeNotes}
                storageKey={keys.sidePanel}
                changesTarget={changesTarget(activeSession, activeState)}
                runtimeState={activeState}
                previewRequest={previewRequest}
                onClosePreview={closePreview}
                width={sidePanelWidth.width}
                maxWidth={sidePanelMax}
                resizing={sidePanelResizing}
                onResizeDrag={sidePanelWidth.setLive}
                onResizeCommit={sidePanelWidth.commit}
                onResizeReset={sidePanelWidth.reset}
                onResizingChange={setSidePanelResizing}
              />
            ) : null}
          </div>
          <StatusBar
            cwd={activeSession?.cwd ?? null}
            run={activeState?.run ?? null}
            exitCode={activeState?.exitCode ?? null}
            needsYou={needsYou}
            onOpenSession={nav.selectSession}
            soundEnabled={soundEnabled}
            onToggleSound={setSoundEnabled}
            usage={{
              state: usage.state,
              stale: usage.stale,
              now: usage.now,
              onRefresh: usage.refresh,
              refreshing: usage.refreshing,
              refreshError: usage.refreshError,
              consented: usage.consented,
              grantConsent: usage.grantConsent,
              pace: usage.pace,
              showOpencodeGo: settings.quota.showOpencodeGo
            }}
            activeSessionId={view === 'hub' ? null : activeId}
          />
        </main>
      </div>
      <WorkspaceDialogs
        data={data}
        actions={actions}
        newDialog={commands.newDialog}
        onCloseNew={commands.closeNew}
        onCreated={commands.handleCreated}
        settingsSection={commands.settingsSection}
        onSettingsSectionChange={commands.setSettingsSection}
        onCloseSettings={(): void => commands.setSettingsSection(null)}
      />
      {commands.searchOpen ? (
        <ConversationSearchDialog
          open
          sessions={store.data?.sessions ?? []}
          onOpenChange={commands.setSearchOpen}
          onOpenSession={nav.selectSession}
        />
      ) : null}
      {commands.costsOpen ? (
        <CostDialog
          open
          sessions={store.data?.sessions ?? []}
          onOpenChange={commands.setCostsOpen}
          onOpenSession={nav.selectSession}
        />
      ) : null}
      <CommandPalette open={commands.paletteOpen} onOpenChange={commands.setPaletteOpen} items={commands.paletteItems} onRun={commands.runPalette} />
    </>
  )
}
