// One mode's workspace (D31): sidebar, tab bar, terminals, Hub, worker view, side panel, status bar, dialogs and palette.
// Ops and Code each get their own instance (App mounts one at a time, keyed by mode) with mode-scoped storage keys.
import { useEffect, useMemo, type ReactElement } from 'react'
import { Sidebar } from '../Sidebar'
import { useLastRuntimeChange } from '../Sidebar/useLastRuntimeChange'
import { CodeSidebar } from '../code/sidebar/CodeSidebar'
import { GridView } from '../grid/GridView'
import { useTerminalPanes } from '../Terminal/useTerminalPanes'
import { useTermView } from '../Terminal/useTermView'
import { applyTerminalFontSize } from '../Terminal/paneFactory'
import type { GridPreset } from '../grid/gridLogic'
import { HubView } from '../hub/HubView'
import { NotesPanel } from '../notes'
import { progress } from '../notes/checklistLogic'
import { CommandPalette } from '../palette/CommandPalette'
import { TerminalWorkspace } from '../Terminal/TerminalWorkspace'
import { WorkerView } from '../workers/WorkerView'
import { needsYouItems } from '../attention/needsYou'
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
import { ModeTitleBar, type ModeChrome } from './ModeTitleBar'
import { useWorkspaceCommands } from './useWorkspaceCommands'
import { useWorkspaceNav, type FocusRequest } from './useWorkspaceNav'
import { WorkspaceDialogs } from './WorkspaceDialogs'

const SIDEBAR_WIDTH_CLASS = 'w-[300px]'
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
  const sessions = data?.sessions ?? null
  const nav = useWorkspaceNav({ keys, sessions, actions, focusRequest: props.focusRequest, onFocusHandled: props.onFocusHandled })
  const { tabs, split, workers, view } = nav
  const { activeId, ids } = tabs
  const activeSession = sessions?.find((s: Session): boolean => s.id === activeId) ?? null
  const commands = useWorkspaceCommands({
    mode, role: chrome.role, codePoppedOut: chrome.codePoppedOut, data, runtime, actions, nav, activeSession,
    onSwitchMode: chrome.onSwitch, onPopOutCode: chrome.onPopOutCode, onDockCode: chrome.onDockCode,
    onShowAwaySummary: props.onShowAwaySummary
  })
  const [sidebarOpen, setSidebarOpen] = usePersistedBoolean(SIDEBAR_STORAGE_KEY, true)
  const [soundEnabled, setSoundEnabled] = useSoundEnabled()
  const lastChange = useLastRuntimeChange(runtime)
  useTabShortcuts({ closeActive: tabs.closeActive, cycle: tabs.cycle })

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
  const barIds = useMemo(() => projectTabIds(ids, sessions ?? [], activeId), [ids, sessions, activeId])
  const tabModels = useMemo(() => buildTabModels(barIds, sessions ?? [], runtime), [barIds, sessions, runtime])
  const needsYou = useMemo(() => needsYouItems(sessions ?? [], runtime), [sessions, runtime])
  const activeState = activeId === null ? undefined : runtime.get(activeId)
  // Terminal comfort: the app-wide zoom/scrollback profile; zoom changes apply live to every mounted pane.
  const termViewApi = useTermView()
  const panes = useTerminalPanes(
    view === 'grid'
      ? nav.grid.layout.cells.filter((id): id is Id => id !== null)
      : split.layout.paneIds,
    ids,
    runtime,
    { termView: termViewApi.termView, onZoom: termViewApi.zoom }
  )
  useEffect((): void => {
    for (const pane of panes.panesRef.current.values()) {
      if (pane.opened) {
        applyTerminalFontSize(pane.view, termViewApi.termView.zoomPercent)
      }
    }
  }, [termViewApi.termView.zoomPercent, panes.panesRef])
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
            'flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-worktree-sidebar transition-[width] duration-200',
            sidebarOpen ? `${SIDEBAR_WIDTH_CLASS} border-r border-sidebar-border` : 'w-0'
          )}
        >
          <div className={cn('flex h-full min-h-0 flex-col', SIDEBAR_WIDTH_CLASS)}>
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
                  actions={actions}
                  onNewWorktree={commands.openNewWorktree}
                  onNewSessionInWorktree={commands.openNewInWorktree}
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
                  actions={actions}
                  onNewSession={commands.openNew}
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

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabBar
            tabs={tabModels}
            activeId={view === 'hub' || workers.selected !== null ? null : activeId}
            sidebarCollapsed={!sidebarOpen}
            onShowSidebar={(): void => setSidebarOpen(true)}
            onActivate={nav.activateTab}
            onClose={tabs.close}
            onCloseOthers={(keepId: Id): void => { barIds.filter((id: Id): boolean => id !== keepId).forEach(tabs.close) }}
            onCloseAll={(): void => { barIds.forEach(tabs.close) }}
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
              }
            }}
            split={{
              active: split.split,
              canSplit: split.canSplit,
              visibleIds,
              onSplitRight: split.splitRight,
              onSplitDown: split.splitDown,
              onUnsplit: split.unsplit,
              onOpenToSide: (id: Id): void => { split.openToSide(id) }
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
                  onFocusPane={nav.activateTab}
                  onClosePane={split.removePane}
                  onResize={split.resize}
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
                    onOpenSession={nav.selectSession}
                    onSetStatus={(id, statusId): void => { void actions.setSessionStatus(id, statusId) }}
                    onNewSession={commands.openNewInStatus}
                    onEditStatuses={editStatuses}
                    onReopen={nav.reopenSession}
                    sessionUsage={sessionUsage}
                    scrollToBusiest={settings.hub.scrollToBusiest}
                  />
                </div>
              ) : null}
              {loaded && view === 'grid' && data !== null && workers.selected === null ? (
                <div className="absolute inset-0 z-10 bg-black">
                  <GridView
                    grid={nav.grid.layout}
                    sessions={sessions ?? []}
                    activeId={activeId}
                    runtime={runtime}
                    names={paneNames}
                    panes={panes}
                    onFocusCell={nav.grid.focusCell}
                    onPickCell={(index: number, id: Id | null): void => {
                      // Picking a session shows it: its tab opens too (cells only hold live sessions).
                      if (id !== null) tabs.open(id)
                      nav.grid.setCell(index, id)
                    }}
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
            </div>
            {nav.notesOpen && view === 'terminal' && activeSession !== null ? (
              <NotesPanel
                key={activeSession.id}
                session={activeSession}
                actions={actions}
                onClose={nav.closeNotes}
                storageKey={keys.sidePanel}
                changesTarget={changesTarget(activeSession, activeState)}
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
      <CommandPalette open={commands.paletteOpen} onOpenChange={commands.setPaletteOpen} items={commands.paletteItems} onRun={commands.runPalette} />
    </>
  )
}
