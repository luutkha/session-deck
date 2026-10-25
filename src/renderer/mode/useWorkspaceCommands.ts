// New-session dialogs, Settings, the command palette and the Ctrl+Shift+N shortcut for one mode's workspace.
import { useCallback, useMemo, useState } from 'react'
import type { Id, RuntimeState, Session, StoreData, UiMode, WindowRole } from '../../shared/types'
import { buildPaletteItems, type PaletteCommand, type PaletteItem } from '../palette/paletteItems'
import { runPaletteCommand } from '../palette/runCommand'
import { usePaletteShortcut } from '../palette/usePaletteShortcut'
import type { SettingsSection } from '../settings/SettingsDialog'
import type { SessionActions } from '../state/useSessionStore'
import { useGlobalNewSessionShortcut } from '../Sidebar/useSidebarKeyboard'
import { codeNewDialog, opsNewDialog, worktreeSessionDialog, type NewDialog } from './newSessionTarget'
import type { WorkspaceNav } from './useWorkspaceNav'

export interface WorkspaceCommandsInput {
  readonly mode: UiMode
  readonly role: WindowRole
  readonly codePoppedOut: boolean
  /** This mode's store data (sessions of this mode only). */
  readonly data: StoreData | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly actions: SessionActions
  readonly nav: WorkspaceNav
  readonly activeSession: Session | null
  readonly onSwitchMode: (mode: UiMode) => void
  readonly onPopOutCode: () => void
  readonly onDockCode: () => void
  readonly onShowAwaySummary: () => void
}

export interface WorkspaceCommands {
  readonly newDialog: NewDialog | null
  readonly closeNew: () => void
  /** Ops: New session (optionally in a group/folder). Code: New session in the active worktree, else New worktree. */
  readonly openNew: (groupId?: Id | null, folder?: string) => void
  readonly openNewInStatus: (statusId: Id | null) => void
  readonly openNewWorktree: (repoId?: Id) => void
  readonly openNewInWorktree: (worktreeId: Id) => void
  readonly handleCreated: (sessionId: Id) => void
  readonly settingsSection: SettingsSection | null
  readonly setSettingsSection: (section: SettingsSection | null) => void
  readonly paletteOpen: boolean
  readonly setPaletteOpen: (open: boolean) => void
  readonly paletteItems: readonly PaletteItem[]
  readonly runPalette: (command: PaletteCommand) => void
}

export function useWorkspaceCommands(input: WorkspaceCommandsInput): WorkspaceCommands {
  const { mode, data, actions, nav, activeSession } = input
  const [newDialog, setNewDialog] = useState<NewDialog | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const worktrees = data?.worktrees ?? []

  const openNew = useCallback((groupId?: Id | null, folder?: string): void => {
    setNewDialog(mode === 'code' ? codeNewDialog(activeSession, worktrees) : opsNewDialog(groupId ?? null, null, folder))
  }, [mode, activeSession, worktrees])
  const openNewInStatus = useCallback((statusId: Id | null): void => {
    setNewDialog(mode === 'code' ? codeNewDialog(activeSession, worktrees) : opsNewDialog(null, statusId))
  }, [mode, activeSession, worktrees])
  const openNewWorktree = useCallback((repoId?: Id): void => setNewDialog({ kind: 'worktree', repoId }), [])
  const openNewInWorktree = useCallback((worktreeId: Id): void => {
    setNewDialog(worktreeSessionDialog(worktreeId, worktrees))
  }, [worktrees])
  const closeNew = useCallback((): void => setNewDialog(null), [])

  const handleCreated = useCallback((sessionId: Id): void => {
    nav.openCreated(sessionId)
    const wanted = newDialog?.kind === 'ops' ? newDialog.statusId : null
    if (wanted !== null) void actions.setSessionStatus(sessionId, wanted)
  }, [nav.openCreated, newDialog, actions])

  // The Ops sidebar registers Ctrl+Shift+N itself; Code mode needs its own.
  useGlobalNewSessionShortcut(useCallback((): void => openNew(), [openNew]), mode !== 'code' || newDialog !== null)
  usePaletteShortcut(useCallback((): void => setPaletteOpen(true), []))

  const activeId = nav.view === 'hub' ? null : nav.tabs.activeId
  const paletteItems = useMemo(() => buildPaletteItems({
    sessions: data?.sessions ?? [],
    statuses: data?.statuses ?? [],
    runtime: input.runtime,
    activeId,
    view: nav.view,
    mode,
    windowRole: input.role,
    codePoppedOut: input.codePoppedOut
  }), [data?.sessions, data?.statuses, input.runtime, activeId, nav.view, mode, input.role, input.codePoppedOut])

  const runPalette = useCallback((command: PaletteCommand): void => {
    runPaletteCommand(command, {
      openSession: nav.selectSession,
      reopenSession: nav.reopenSession,
      newSession: () => openNew(),
      openHub: (): void => nav.setView('hub'),
      openGrid: (): void => nav.setView('grid'),
      openSettings: (): void => setSettingsSection('general'),
      showAwaySummary: input.onShowAwaySummary,
      setStatus: (id, statusId): void | Promise<void> => actions.setSessionStatus(id, statusId),
      switchMode: input.onSwitchMode,
      popOutCode: input.onPopOutCode,
      dockCode: input.onDockCode,
      newWorktree: () => openNewWorktree()
    })
  }, [nav.selectSession, nav.reopenSession, nav.setView, openNew, openNewWorktree, input.onShowAwaySummary, input.onSwitchMode, input.onPopOutCode, input.onDockCode, actions])

  return {
    newDialog, closeNew, openNew, openNewInStatus, openNewWorktree, openNewInWorktree, handleCreated,
    settingsSection, setSettingsSection, paletteOpen, setPaletteOpen, paletteItems, runPalette
  }
}
