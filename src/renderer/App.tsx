import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { PanelLeft } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { NewSessionDialog } from './Sidebar/NewSessionDialog'
import { useLastRuntimeChange } from './Sidebar/useLastRuntimeChange'
import { HubView } from './hub/HubView'
import { SettingsDialog, type SettingsSection } from './settings/SettingsDialog'
import { useAttentionSound } from './sound'
import { NotesPanel } from './notes'
import { progress } from './notes/checklistLogic'
import { useUsage } from './usage/useUsage'
import { QuotaToast } from './usage/QuotaToast'
import { TerminalWorkspace } from './Terminal/TerminalWorkspace'
import { useWorkers } from './workers/useWorkers'
import { WorkerView } from './workers/WorkerView'
import { useSplitLayout } from './split/useSplitLayout'
import { Button } from './components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { cn } from './lib/utils'
import { useSessionStore } from './state/useSessionStore'
import { resolveSettings, type Id, type RuntimeState, type Session, type SessionUsage, type StoreData } from '../shared/types'
import { EmptyState } from './shell/EmptyState'
import { StatusBar } from './shell/StatusBar'
import { TabBar } from './shell/TabBar'
import { projectTabIds } from './shell/projectTabs'
import { TitleBarRegion } from './shell/TitleBarRegion'
import { SIDEBAR_STORAGE_KEY } from './shell/shellPrefs'
import { useOpenTabs } from './shell/useOpenTabs'
import { useSoundEnabled } from './shell/useSoundEnabled'
import { useTabShortcuts } from './shell/useTabShortcuts'
import { usePersistedBoolean } from './shell/usePersistedBoolean'
import { useUserActivityReporter } from './shell/useUserActivityReporter'
import { buildTabModels } from './shell/tabStatus'
import { needsYouItems } from './attention/needsYou'
import { NeedsYouButton } from './attention/NeedsYouButton'
import './styles.css'

const SIDEBAR_WIDTH_CLASS = 'w-[300px]'
const VIEW_STORAGE_KEY = 'sessiondeck.view.v1'
const NOTES_STORAGE_KEY = 'sessiondeck.notes.open.v1'
type MainView = 'terminal' | 'hub'

function readStoredView(): MainView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'hub' ? 'hub' : 'terminal'
  } catch {
    return 'terminal' // storage blocked: the view is a convenience, never required
  }
}

function storeView(view: MainView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // storage blocked: nothing to persist to
  }
}
const EMPTY_STORE: StoreData = { version: 1, sessions: [], groups: [], statuses: [], groupOrder: [] }

function activeRuntime(
  runtime: ReadonlyMap<Id, RuntimeState>,
  activeId: Id | null
): RuntimeState | undefined {
  return activeId === null ? undefined : runtime.get(activeId)
}

export function App(): ReactElement {
  useUserActivityReporter()
  const { data, runtime, lastError, clearError, actions } = useSessionStore()
  const [sidebarOpen, setSidebarOpen] = usePersistedBoolean(SIDEBAR_STORAGE_KEY, true)
  const [soundEnabled, setSoundEnabled] = useSoundEnabled()
  const loaded = data !== null
  const sessions = data?.sessions ?? null
  const tabs = useOpenTabs(sessions, actions)
  const { activeId, ids } = tabs
  const split = useSplitLayout(ids, activeId)
  const workers = useWorkers(activeId)

  // New session / Statuses open Orca-style dialogs (they own validation, Browse and error display).
  const [newSession, setNewSession] = useState<{ readonly groupId: Id | null; readonly statusId: Id | null; readonly folder?: string } | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [view, setViewState] = useState<MainView>(readStoredView)
  const setView = useCallback((next: MainView): void => {
    setViewState(next)
    storeView(next)
    workers.select(null) // every other target (a session, the Hub) leaves the worker view
  }, [workers.select])

  // Plays the user's configured notification sound when main reports a session needing attention (mount ONCE).
  useAttentionSound()
  const usage = useUsage()
  const [notesOpen, setNotesOpenState] = usePersistedBoolean(NOTES_STORAGE_KEY, false)
  const toggleNotes = useCallback((): void => setNotesOpenState(!notesOpen), [notesOpen, setNotesOpenState])
  const lastChange = useLastRuntimeChange(runtime)

  const handleNewSession = useCallback((groupId?: Id | null, folder?: string): void => {
    setNewSession({ groupId: groupId ?? null, statusId: null, folder })
  }, [])

  const handleNewInStatus = useCallback((statusId: Id | null): void => {
    setNewSession({ groupId: null, statusId })
  }, [])

  const handleNewTab = useCallback((): void => {
    handleNewSession(null)
  }, [handleNewSession])

  const handleEditStatuses = useCallback((): void => setSettingsSection('statuses'), [])
  const handleOpenSettings = useCallback((): void => setSettingsSection('general'), [])
  const closeNewSession = useCallback((): void => setNewSession(null), [])
  const closeSettings = useCallback((): void => setSettingsSection(null), [])

  // Anything that targets a terminal brings the terminal view back from the Hub.
  const selectSession = useCallback((id: Id): void => { setView('terminal'); tabs.select(id) }, [setView, tabs.select])
  const reopenSession = useCallback((id: Id): void => { setView('terminal'); tabs.reopen(id) }, [setView, tabs.reopen])
  const activateTab = useCallback((id: Id): void => {
    setView('terminal')
    split.showInPane(id)
    tabs.activate(id)
  }, [setView, split.showInPane, tabs.activate])
  const handleCreated = useCallback((sessionId: Id): void => {
    setView('terminal')
    tabs.open(sessionId)
    const wanted = newSession?.statusId ?? null
    if (wanted !== null) {
      void actions.setSessionStatus(sessionId, wanted)
    }
  }, [setView, tabs.open, newSession, actions])

  // Tray menu and desktop notification clicks ask the renderer to show a session.
  useEffect(() => {
    const off = window.api?.onFocusSession?.((id: Id): void => { setView('terminal'); tabs.select(id) })
    return off
  }, [setView, tabs.select])

  const settings = useMemo(() => resolveSettings(data?.settings), [data?.settings])
  const sessionUsage = useMemo(
    (): ReadonlyMap<Id, SessionUsage> => new Map(usage.state.sessions.map((s): [Id, SessionUsage] => [s.sessionId, s])),
    [usage.state.sessions]
  )

  useTabShortcuts({ closeActive: tabs.closeActive, cycle: tabs.cycle })

  const paneNames = useMemo(
    (): ReadonlyMap<Id, string> => new Map((sessions ?? []).map((s: Session): [Id, string] => [s.id, s.name])),
    [sessions]
  )
  const visibleIds = useMemo((): ReadonlySet<Id> => new Set(split.layout.paneIds), [split.layout.paneIds])

  const barIds = useMemo(() => projectTabIds(ids, sessions ?? [], activeId), [ids, sessions, activeId])
  const tabModels = useMemo(
    () => buildTabModels(barIds, sessions ?? [], runtime),
    [barIds, sessions, runtime]
  )
  // Close others / all only touch the tabs shown in the bar (the active folder), not other projects.
  const closeOtherTabs = useCallback((keepId: Id): void => {
    barIds.filter((id: Id): boolean => id !== keepId).forEach(tabs.close)
  }, [barIds, tabs.close])
  const closeBarTabs = useCallback((): void => { barIds.forEach(tabs.close) }, [barIds, tabs.close])
  const needsYou = useMemo(() => needsYouItems(sessions ?? [], runtime), [sessions, runtime])
  const activeSession = sessions?.find((session: Session): boolean => session.id === activeId) ?? null
  const activeState = activeRuntime(runtime, activeId)
  const checklistProgress = progress(activeSession?.checklist ?? [])
  const notesBadge = checklistProgress.total > 0 ? `${checklistProgress.done}/${checklistProgress.total}` : null

  return (
    <TooltipProvider delayDuration={300}>
      <div className="app-shell flex h-full min-h-0 w-full overflow-hidden bg-background font-sans text-foreground">
        <aside
          className={cn(
            'flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-worktree-sidebar transition-[width] duration-200',
            sidebarOpen ? `${SIDEBAR_WIDTH_CLASS} border-r border-sidebar-border` : 'w-0'
          )}
        >
          <div className={cn('flex h-full min-h-0 flex-col', SIDEBAR_WIDTH_CLASS)}>
            <TitleBarRegion className="flex h-9 shrink-0 items-center justify-between border-b border-sidebar-border pl-3 pr-1.5">
              <span className="text-[13px] font-medium text-muted-foreground">SessionDeck</span>
              <div className="flex items-center gap-0.5">
              <NeedsYouButton items={needsYou} onOpenSession={selectSession} className="app-no-drag" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="app-no-drag text-muted-foreground"
                    aria-label="Hide sidebar"
                    onClick={(): void => setSidebarOpen(false)}
                  >
                    <PanelLeft size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  Hide sidebar
                </TooltipContent>
              </Tooltip>
              </div>
            </TitleBarRegion>
            <div className="flex min-h-0 flex-1 flex-col">
              <Sidebar
                data={data ?? EMPTY_STORE}
                runtime={runtime}
                activeId={activeId}
                onSelect={selectSession}
                onReopen={reopenSession}
                actions={actions}
                onNewSession={handleNewSession}
                onEditStatuses={handleEditStatuses}
                onOpenHub={(): void => setView('hub')}
                hubActive={view === 'hub'}
                onOpenSettings={handleOpenSettings}
                runtimeLastChange={lastChange}
                lastError={lastError}
                clearError={clearError}
              />
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabBar
            tabs={tabModels}
            activeId={view === 'hub' || workers.selected !== null ? null : activeId}
            sidebarCollapsed={!sidebarOpen}
            onShowSidebar={(): void => setSidebarOpen(true)}
            onActivate={activateTab}
            onClose={tabs.close}
            onCloseOthers={closeOtherTabs}
            onCloseAll={closeBarTabs}
            onNewSession={handleNewTab}
            hubActive={view === 'hub'}
            onOpenHub={(): void => setView('hub')}
            onToggleNotes={activeSession !== null && view === 'terminal' ? toggleNotes : undefined}
            notesOpen={notesOpen}
            notesBadge={notesBadge}
            workers={{ workers: workers.visible, selectedId: workers.selected?.id ?? null, onSelect: workers.select, onDismiss: workers.dismiss }}
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
                onFocusPane={activateTab}
                onClosePane={split.removePane}
                onResize={split.resize}
                onEqualize={split.equalize}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            )}
            {loaded && view === 'hub' && data !== null ? (
              <div className="absolute inset-0 z-10 bg-background">
                <HubView
                  data={data}
                  runtime={runtime}
                  lastChange={lastChange}
                  activeId={activeId}
                  onOpenSession={selectSession}
                  onSetStatus={(id, statusId): void => { void actions.setSessionStatus(id, statusId) }}
                  onNewSession={handleNewInStatus}
                  onEditStatuses={handleEditStatuses}
                  onReopen={reopenSession}
                  sessionUsage={sessionUsage}
                  scrollToBusiest={settings.hub.scrollToBusiest}
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
                <EmptyState onNewSession={handleNewTab} />
              </div>
            ) : null}
          </div>
          {notesOpen && view === 'terminal' && activeSession !== null ? (
            <NotesPanel
              key={activeSession.id}
              session={activeSession}
              actions={actions}
              onClose={(): void => setNotesOpenState(false)}
            />
          ) : null}
          </div>
          <StatusBar
            cwd={activeSession?.cwd ?? null}
            run={activeState?.run ?? null}
            exitCode={activeState?.exitCode ?? null}
            needsYou={needsYou}
            onOpenSession={selectSession}
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
              pace: usage.pace
            }}
            activeSessionId={view === 'hub' ? null : activeId}
          />
        </main>
      </div>
      {data !== null && newSession !== null && (
        <NewSessionDialog
          data={data}
          defaultGroupId={newSession.groupId}
          defaultFolder={newSession.folder}
          actions={actions}
          onClose={closeNewSession}
          onCreated={handleCreated}
        />
      )}
      {data !== null && settingsSection !== null && (
        <SettingsDialog
          section={settingsSection}
          onSectionChange={setSettingsSection}
          settings={settings}
          statuses={data.statuses}
          actions={actions}
          onClose={closeSettings}
        />
      )}
      <QuotaToast />
    </TooltipProvider>
  )
}
