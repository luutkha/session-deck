// Runs a palette command. App supplies the navigation handlers; the session actions go through the preload API.
// Never throws: a failed command is logged and the palette closes as usual.
import type { Id, UiMode } from '../../shared/types'
import type { Api } from '../../shared/ipc'
import type { PaletteCommand } from './paletteItems'

export interface PaletteHandlers {
  readonly openSession: (id: Id) => void
  readonly reopenSession: (id: Id) => void
  readonly newSession: () => void
  /** D49: starts a session from a saved preset in one step. */
  readonly newFromPreset: (presetId: Id) => void | Promise<void>
  readonly openHub: () => void
  readonly openGrid: () => void
  /** D55: leaves the grid view. */
  readonly exitGrid: () => void
  readonly openSettings: () => void
  /** G10: opens Settings on the diagnostics section. */
  readonly openSettingsDiagnostics: () => void
  readonly showAwaySummary: () => void
  /** D51: opens the cost report. */
  readonly showCosts: () => void
  /** D52: forks a Claude session and opens the fork. */
  readonly forkSession: (id: Id) => void | Promise<void>
  /** D52: opens the conversation search. */
  readonly searchConversations: () => void
  /** D74: picks a file and shows it in the side panel viewer for the session on screen. */
  readonly previewFile: () => void | Promise<void>
  /** D53: opens Jarvis (created on first use), or starts it over with a new conversation. */
  readonly openJarvis: () => void | Promise<void>
  readonly resetJarvis: () => void | Promise<void>
  readonly setStatus: (id: Id, statusId: Id) => void | Promise<void>
  /** Mode switch (main window). */
  readonly switchMode: (mode: UiMode) => void
  /** Opens the Code window, or focuses it. */
  readonly popOutCode: () => void
  /** Closes the Code window (Code returns to the main window). */
  readonly dockCode: () => void
  readonly newWorktree: () => void
  /** D69: shows the next (1) / previous (-1) session that needs the user. */
  readonly stepAttention: (delta: 1 | -1) => void
  /** G10: opens the Changes tab for the given worktree session. */
  readonly viewChanges: (id: Id) => void
}

export type PaletteApi = Pick<Api, 'sleepSession' | 'setKeepAwake' | 'clearAttention' | 'markUnread' | 'detachChanges'>

type MaybePromise = void | Promise<void>

function logFailure(command: PaletteCommand, error: unknown): void {
  console.error(`Palette command "${command.kind}" failed`, error)
}

/** Runs one action; a sync throw or a rejected promise is logged, never propagated. */
function attempt(command: PaletteCommand, action: () => MaybePromise): void {
  try {
    const result = action()
    if (result instanceof Promise) {
      result.catch((error: unknown): void => logFailure(command, error))
    }
  } catch (error) {
    logFailure(command, error)
  }
}

function runSessionCommand(
  command: PaletteCommand,
  handlers: PaletteHandlers,
  api: PaletteApi
): void {
  switch (command.kind) {
    case 'open-session':
      return attempt(command, () => handlers.openSession(command.id))
    case 'reopen-session':
      return attempt(command, () => handlers.reopenSession(command.id))
    case 'new-session':
      return attempt(command, () => handlers.newSession())
    case 'new-from-preset':
      return attempt(command, () => handlers.newFromPreset(command.presetId))
    case 'open-hub':
      return attempt(command, () => handlers.openHub())
    case 'open-grid':
      return attempt(command, () => handlers.openGrid())
    case 'exit-grid':
      return attempt(command, () => handlers.exitGrid())
    case 'open-settings':
      return attempt(command, () => handlers.openSettings())
    case 'open-settings-diagnostics':
      return attempt(command, () => handlers.openSettingsDiagnostics())
    case 'show-away-summary':
      return attempt(command, () => handlers.showAwaySummary())
    case 'show-costs':
      return attempt(command, () => handlers.showCosts())
    case 'fork-session':
      return attempt(command, () => handlers.forkSession(command.id))
    case 'search-conversations':
      return attempt(command, () => handlers.searchConversations())
    case 'preview-file':
      return attempt(command, () => handlers.previewFile())
    case 'open-jarvis':
      return attempt(command, () => handlers.openJarvis())
    case 'reset-jarvis':
      return attempt(command, () => handlers.resetJarvis())
    case 'set-status':
      return attempt(command, () => handlers.setStatus(command.id, command.statusId))
    case 'switch-mode':
      return attempt(command, () => handlers.switchMode(command.mode))
    case 'pop-out-code':
      return attempt(command, () => handlers.popOutCode())
    case 'dock-code':
      return attempt(command, () => handlers.dockCode())
    case 'new-worktree':
      return attempt(command, () => handlers.newWorktree())
    case 'view-changes':
      return attempt(command, () => handlers.viewChanges(command.id))
    case 'step-attention':
      return attempt(command, () => handlers.stepAttention(command.delta))
    case 'sleep':
      return attempt(command, () => api.sleepSession(command.id))
    case 'set-keep-awake':
      return attempt(command, () => api.setKeepAwake(command.id, command.keepAwake))
    case 'mark-read':
      return attempt(command, () => api.clearAttention(command.id))
    case 'mark-unread':
      return attempt(command, () => api.markUnread(command.id))
    case 'detach-changes':
      return attempt(command, () => api.detachChanges(command.worktreeId))
    default:
      return console.error('Unknown palette command', JSON.stringify(command))
  }
}

/** Runs the command. `api` defaults to the preload bridge; tests pass a fake. */
export function runPaletteCommand(
  command: PaletteCommand,
  handlers: PaletteHandlers,
  api: PaletteApi = window.api
): void {
  runSessionCommand(command, handlers, api)
}
