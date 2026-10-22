// Runs a palette command. App supplies the navigation handlers; the session actions go through the preload API.
// Never throws: a failed command is logged and the palette closes as usual.
import type { Id, UiMode } from '../../shared/types'
import type { Api } from '../../shared/ipc'
import type { PaletteCommand } from './paletteItems'

export interface PaletteHandlers {
  readonly openSession: (id: Id) => void
  readonly reopenSession: (id: Id) => void
  readonly newSession: () => void
  readonly openHub: () => void
  readonly openSettings: () => void
  readonly showAwaySummary: () => void
  readonly setStatus: (id: Id, statusId: Id) => void | Promise<void>
  /** Mode switch (main window). */
  readonly switchMode: (mode: UiMode) => void
  /** Opens the Code window, or focuses it. */
  readonly popOutCode: () => void
  /** Closes the Code window (Code returns to the main window). */
  readonly dockCode: () => void
  readonly newWorktree: () => void
}

export type PaletteApi = Pick<Api, 'sleepSession' | 'setKeepAwake' | 'clearAttention' | 'markUnread'>

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
    case 'open-hub':
      return attempt(command, () => handlers.openHub())
    case 'open-settings':
      return attempt(command, () => handlers.openSettings())
    case 'show-away-summary':
      return attempt(command, () => handlers.showAwaySummary())
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
    case 'sleep':
      return attempt(command, () => api.sleepSession(command.id))
    case 'set-keep-awake':
      return attempt(command, () => api.setKeepAwake(command.id, command.keepAwake))
    case 'mark-read':
      return attempt(command, () => api.clearAttention(command.id))
    case 'mark-unread':
      return attempt(command, () => api.markUnread(command.id))
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
