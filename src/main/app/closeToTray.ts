export interface CloseDecisionInput {
  /** True once the user asked to quit (tray Quit, IPC quit, Ctrl+Q). */
  readonly quitting: boolean
  readonly closeToTray: boolean
  /** False when the tray could not be created; then closing must quit, or the app would be unreachable. */
  readonly trayAvailable: boolean
}

/** Whether the window close button should hide the window to the tray instead of closing it. */
export function shouldHideOnClose(input: CloseDecisionInput): boolean {
  return !input.quitting && input.closeToTray && input.trayAvailable
}
