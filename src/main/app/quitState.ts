let quitting = false

/** Set once the user really asked to quit (tray menu, IPC quit, Cmd+Q). The window close button checks it. */
export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
