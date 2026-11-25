// New-session dialogs, Settings, the command palette and the Ctrl+Shift+N shortcut for one mode's workspace.
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Id, RuntimeState, Session, StoreData, UiMode, WindowRole } from '../../shared/types'
import { buildPaletteItems, type PaletteCommand, type PaletteItem } from '../palette/paletteItems'
import { runPaletteCommand } from '../palette/runCommand'
import { openJarvisPanel } from '../jarvis/jarvisPanelStore'
import { needsYouItems } from '../attention/needsYou'
import { pickAttentionTarget } from '../attention/attentionNav'
import { usePaletteShortcut } from '../palette/usePaletteShortcut'
import type { SettingsSection } from '../settings/SettingsDialog'
import type { SessionActions } from '../state/useSessionStore'
import { useGlobalNewSessionShortcut } from '../Sidebar/useSidebarKeyboard'
import { createInputFromPreset } from '../presets/presetLogic'
import { requestFileView } from '../viewer/previewBus'
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
  /** G10: the tab menu's Changes handler, reused by the palette for the active worktree session. */
  readonly onViewChanges: (id: Id) => void
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
  readonly costsOpen: boolean
  readonly setCostsOpen: (open: boolean) => void
  readonly searchOpen: boolean
  readonly forkSession: (id: Id) => void
  readonly setSearchOpen: (open: boolean) => void
  readonly paletteItems: readonly PaletteItem[]
  readonly runPalette: (command: PaletteCommand) => void
  /** D69: shows the next (1) / previous (-1) session that needs the user (Ctrl+Shift+Down / Up, palette). */
  readonly stepAttention: (delta: 1 | -1) => void
}

export function useWorkspaceCommands(input: WorkspaceCommandsInput): WorkspaceCommands {
  const { mode, data, actions, nav, activeSession } = input
  const [newDialog, setNewDialog] = useState<NewDialog | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // D51: the cost report dialog (palette "Show cost report", Hub header total).
  const [costsOpen, setCostsOpen] = useState(false)
  // D52: conversation search dialog (palette "Search conversations").
  const [searchOpen, setSearchOpen] = useState(false)
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
    codePoppedOut: input.codePoppedOut,
    presets: data?.presets
  }), [data?.sessions, data?.statuses, data?.presets, input.runtime, activeId, nav.view, mode, input.role, input.codePoppedOut])

  // D69: keyboard triage. Reads the latest sessions / runtime / active tab at call time, so the callback never changes.
  const triageRef = useRef({ sessions: data?.sessions ?? [], runtime: input.runtime, activeId })
  triageRef.current = { sessions: data?.sessions ?? [], runtime: input.runtime, activeId }
  // D74: the palette asks the window for a file, then needs the session on screen at answer time.
  const activeSessionRef = useRef<Session | null>(activeSession)
  activeSessionRef.current = activeSession
  /** D74: the open-file dialog, then the file in the side panel's viewer for the session on screen. */
  const previewFile = useCallback(async (): Promise<void> => {
    const path = await window.api.pickViewFile()
    const session = activeSessionRef.current
    if (path === null || path.trim() === '' || session === null) return
    if (!requestFileView({ sessionId: session.id, text: path })) {
      throw new Error('No workspace is ready to show the file.')
    }
  }, [])
  const selectSession = nav.selectSession
  const stepAttention = useCallback((delta: 1 | -1): void => {
    const { sessions, runtime, activeId: current } = triageRef.current
    const target = pickAttentionTarget(needsYouItems(sessions, runtime), current, delta)
    if (target !== null) selectSession(target)
  }, [selectSession])

  // D52: fork and open the fork in a tab (a just-created session has no tab yet, so openCreated, not selectSession).
  // A refusal (no conversation yet, not Claude) is shown in the store banner by the action wrapper.
  const forkSession = useCallback((id: Id): void => {
    actions.forkSession(id).then((fork): void => nav.openCreated(fork.id), (): void => undefined)
  }, [actions, nav.openCreated])

  const runPalette = useCallback((command: PaletteCommand): void => {
    runPaletteCommand(command, {
      openSession: nav.selectSession,
      reopenSession: nav.reopenSession,
      newSession: () => openNew(),
      newFromPreset: async (presetId: Id): Promise<void> => {
        const preset = data?.presets?.find((p) => p.id === presetId)
        if (preset === undefined || data === null) return
        // A failure is shown in the store banner by the action wrapper.
        const session = await actions.createSession(createInputFromPreset(preset, data))
        nav.openCreated(session.id)
      },
      openHub: (): void => nav.setView('hub'),
      openGrid: (): void => nav.setView('grid'),
      exitGrid: nav.exitGrid,
      openSettings: (): void => setSettingsSection('general'),
      openSettingsDiagnostics: (): void => setSettingsSection('diagnostics'),
      showAwaySummary: input.onShowAwaySummary,
      showCosts: (): void => setCostsOpen(true),
      searchConversations: (): void => setSearchOpen(true),
      // D74: "Preview file..." picks a file and shows it in the side panel's viewer.
      previewFile,
      // D53: Jarvis lives in this window's right-side panel.
      openJarvis: openJarvisPanel,
      resetJarvis: async (): Promise<void> => {
        openJarvisPanel()
        await window.api.resetJarvis()
      },
      forkSession,
      setStatus: (id, statusId): void | Promise<void> => actions.setSessionStatus(id, statusId),
      switchMode: input.onSwitchMode,
      popOutCode: input.onPopOutCode,
      dockCode: input.onDockCode,
      newWorktree: () => openNewWorktree(),
      viewChanges: input.onViewChanges,
      stepAttention
    })
  }, [data, forkSession, stepAttention, nav.openCreated, nav.selectSession, nav.reopenSession, nav.setView, openNew, openNewWorktree, input.onShowAwaySummary, input.onViewChanges, input.onSwitchMode, input.onPopOutCode, input.onDockCode, actions, previewFile])

  return {
    newDialog, closeNew, openNew, openNewInStatus, openNewWorktree, openNewInWorktree, handleCreated,
    settingsSection, setSettingsSection, paletteOpen, setPaletteOpen, paletteItems, runPalette, costsOpen, setCostsOpen, searchOpen, setSearchOpen, forkSession, stepAttention
  }
}
