// D73: how "show this file" travels inside one window. The terminal link provider (and later any other place that
// shows a path) calls requestFileView; the workspace listens, opens the side panel on its Preview tab and loads the file.
// Module-local on purpose: every window (main, Code) has its own renderer, so a click is answered by its own window.
import type { Id } from '../../shared/types'

/** The link text exactly as the terminal showed it: main re-resolves it against the session's cwd (never trusts the renderer). */
export interface FileViewRequest {
  readonly sessionId: Id
  readonly text: string
}

type Listener = (request: FileViewRequest) => void

const listeners = new Set<Listener>()

/** Asks the window to show a file. Returns false when nobody listens (no workspace mounted yet). */
export function requestFileView(request: FileViewRequest): boolean {
  if (listeners.size === 0) return false
  for (const listener of [...listeners]) listener(request)
  return true
}

/** Subscribes to requests; the returned function unsubscribes. */
export function onFileViewRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
