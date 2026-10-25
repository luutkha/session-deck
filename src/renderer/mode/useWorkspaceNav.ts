// Tabs, split layout, grid view, Hub/terminal view, worker tabs and notes for one mode's workspace.
// Every key is mode-scoped (modeStorageKeys), so Ops and Code keep separate tabs and layouts.
import { useCallback, useEffect, useState } from 'react'
import type { Id, Session } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { useOpenTabs, type OpenTabsApi } from '../shell/useOpenTabs'
import { usePersistedBoolean } from '../shell/usePersistedBoolean'
import { useSplitLayout, type SplitLayoutApi } from '../split/useSplitLayout'
import { useGridLayout, type GridLayoutApi } from '../grid/useGridLayout'
import { cellIndexFor } from '../grid/gridLogic'
import { useWorkers, type WorkersApi } from '../workers/useWorkers'
import type { ModeStorageKeys } from './modeLogic'
import { readStoredView, storeView, type MainView } from './viewPref'

/** A request from outside the workspace (tray, notification, away summary) to show a session. */
export interface FocusRequest {
  readonly id: Id
}

export interface WorkspaceNavOptions {
  readonly keys: ModeStorageKeys
  /** The sessions of this mode; null until the store has loaded. */
  readonly sessions: readonly Session[] | null
  readonly actions: Pick<SessionActions, 'closeSession' | 'reopenSession'>
  readonly focusRequest: FocusRequest | null
  readonly onFocusHandled: () => void
}

export interface WorkspaceNav {
  readonly tabs: OpenTabsApi
  readonly split: SplitLayoutApi
  /** The mode's grid (D32): preset + cell assignments, remembered per mode. */
  readonly grid: GridLayoutApi
  readonly workers: WorkersApi
  readonly view: MainView
  readonly setView: (view: MainView) => void
  /** Anything that targets a terminal brings the terminal view back from the Hub. */
  readonly selectSession: (id: Id) => void
  readonly reopenSession: (id: Id) => void
  readonly activateTab: (id: Id) => void
  /** A session was created: open and activate its tab. */
  readonly openCreated: (sessionId: Id) => void
  readonly notesOpen: boolean
  readonly toggleNotes: () => void
  readonly closeNotes: () => void
}

function useFocusRequest(
  request: FocusRequest | null,
  sessions: readonly Session[] | null,
  selectSession: (id: Id) => void,
  onHandled: () => void
): void {
  useEffect((): void => {
    if (request === null || sessions === null) {
      return
    }
    // A request for a session that is not in this mode is dropped; the caller only sends known ones.
    if (sessions.some((session: Session): boolean => session.id === request.id)) {
      selectSession(request.id)
    }
    onHandled()
  }, [request, sessions, selectSession, onHandled])
}

export function useWorkspaceNav(options: WorkspaceNavOptions): WorkspaceNav {
  const { keys, sessions, actions, focusRequest, onFocusHandled } = options
  const tabs = useOpenTabs(sessions, actions, keys.tabs)
  const { activeId, ids } = tabs
  const split = useSplitLayout(ids, activeId, keys.split)
  const grid = useGridLayout(ids, activeId, keys.grid)
  const workers = useWorkers(activeId)
  const [view, setViewState] = useState<MainView>((): MainView => readStoredView(keys.view))
  const [notesOpen, setNotesOpen] = usePersistedBoolean(keys.notes, false)

  const setView = useCallback((next: MainView): void => {
    setViewState(next)
    storeView(keys.view, next)
    workers.select(null) // every other target (a session, the Hub) leaves the worker view
  }, [keys.view, workers.select])

  // Selecting/activating a session behaves per view: from the grid it focuses the session's cell
  // (and only records activeId) instead of forcing the terminal view; everywhere else the terminal
  // view comes back (Hub behaviour unchanged).
  const selectSession = useCallback((id: Id): void => {
    setViewState((current: MainView): MainView => {
      if (current === 'grid') {
        const index = cellIndexFor(grid.layout, id)
        if (index !== null) grid.focusCell(index)
        return current
      }
      storeView(keys.view, 'terminal')
      workers.select(null)
      return 'terminal'
    })
    tabs.select(id)
  }, [grid, keys.view, tabs.select, workers.select])

  const reopenSession = useCallback((id: Id): void => {
    setView('terminal')
    tabs.reopen(id)
  }, [setView, tabs.reopen])

  const activateTab = useCallback((id: Id): void => {
    setViewState((current: MainView): MainView => {
      if (current === 'grid') {
        const index = cellIndexFor(grid.layout, id)
        if (index !== null) grid.focusCell(index)
        return current
      }
      split.showInPane(id)
      storeView(keys.view, 'terminal')
      workers.select(null)
      return 'terminal'
    })
    tabs.activate(id)
  }, [grid, keys.view, split, tabs.activate, workers.select])

  const openCreated = useCallback((sessionId: Id): void => {
    setView('terminal')
    tabs.open(sessionId)
  }, [setView, tabs.open])

  const toggleNotes = useCallback((): void => setNotesOpen(!notesOpen), [notesOpen, setNotesOpen])
  const closeNotes = useCallback((): void => setNotesOpen(false), [setNotesOpen])

  useFocusRequest(focusRequest, sessions, selectSession, onFocusHandled)

  return {
    tabs,
    split,
    grid,
    workers,
    view,
    setView,
    selectSession,
    reopenSession,
    activateTab,
    openCreated,
    notesOpen,
    toggleNotes,
    closeNotes
  }
}
