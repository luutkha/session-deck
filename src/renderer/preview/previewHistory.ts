// D89: per-session file-preview history. Pure on purpose: a preview belongs to the session that opened it, not
// to the window, and a session switch must show that session's last file (or none). The workspace owns the state
// and dispatches these actions; no IPC, React or DOM lives here.
import type { Id } from '../../shared/types'

/** A session keeps at most this many files, like a browser's back/forward list. */
export const PREVIEW_HISTORY_MAX = 20

/** One session's remembered previews. `index` is -1 when the session has nothing on screen. */
export interface SessionPreviewHistory {
  readonly paths: readonly string[]
  readonly index: number
}

/** session id -> that session's own list. A missing key means "no preview for this session". */
export type PreviewHistoryState = Readonly<Record<string, SessionPreviewHistory>>

export const EMPTY_SESSION_PREVIEW: SessionPreviewHistory = { paths: [], index: -1 }
export const EMPTY_PREVIEW_HISTORY: PreviewHistoryState = {}

export type PreviewHistoryAction =
  /** A file was opened (link click, palette, drop, Changes row, Jarvis). */
  | { readonly type: 'push'; readonly sessionId: Id; readonly path: string }
  | { readonly type: 'back'; readonly sessionId: Id }
  | { readonly type: 'forward'; readonly sessionId: Id }
  /** The session was removed: its history can no longer be shown. */
  | { readonly type: 'forgetSession'; readonly sessionId: Id }

export type PreviewHistoryStep = -1 | 1

/**
 * The path at the cursor, or null. The caller turns it into a fresh PreviewRequest (with a new nonce),
 * so going back to an earlier file re-reads it instead of reusing a stale load.
 */
export function currentPreviewPath(state: PreviewHistoryState, sessionId: Id): string | null {
  const history = state[sessionId]
  if (history === undefined || history.index < 0) return null
  return history.paths[history.index] ?? null
}

/** Whether a header button / Alt+Arrow has somewhere to go. */
export function canPreviewStep(state: PreviewHistoryState, sessionId: Id, direction: PreviewHistoryStep): boolean {
  const history = state[sessionId]
  if (history === undefined) return false
  const target = history.index + direction
  return target >= 0 && target < history.paths.length
}

export function canPreviewBack(state: PreviewHistoryState, sessionId: Id): boolean {
  return canPreviewStep(state, sessionId, -1)
}

export function canPreviewForward(state: PreviewHistoryState, sessionId: Id): boolean {
  return canPreviewStep(state, sessionId, 1)
}

/**
 * Adds a file to a session's history. Clicking the file already on screen is a no-op for the list
 * (the fresh request nonce still re-reads it) and keeps any forward entries. A new file after going
 * back drops the forward tail, like a browser. The oldest entry is dropped past 20.
 */
export function pushPreviewPath(state: PreviewHistoryState, sessionId: Id, path: string): PreviewHistoryState {
  if (path.trim() === '') return state
  const history = state[sessionId] ?? EMPTY_SESSION_PREVIEW
  if (currentPreviewPath(state, sessionId) === path) return state
  let paths = [...history.paths.slice(0, history.index + 1), path]
  let index = paths.length - 1
  if (paths.length > PREVIEW_HISTORY_MAX) {
    paths = paths.slice(paths.length - PREVIEW_HISTORY_MAX)
    index = paths.length - 1
  }
  return { ...state, [sessionId]: { paths, index } }
}

/** Moves the cursor inside one session; an impossible move returns the very same state object. */
export function stepPreviewPath(
  state: PreviewHistoryState,
  sessionId: Id,
  direction: PreviewHistoryStep
): PreviewHistoryState {
  if (!canPreviewStep(state, sessionId, direction)) return state
  const history = state[sessionId] as SessionPreviewHistory
  return { ...state, [sessionId]: { ...history, index: history.index + direction } }
}

/** Drops one session's whole list when that session is removed. */
export function forgetPreviewSession(state: PreviewHistoryState, sessionId: Id): PreviewHistoryState {
  if (!Object.prototype.hasOwnProperty.call(state, sessionId)) return state
  const next: Record<string, SessionPreviewHistory> = { ...state }
  delete next[sessionId]
  return next
}

/** The one reducer the workspace dispatches to. Immutable: no-op actions keep the input reference. */
export function previewHistoryReducer(state: PreviewHistoryState, action: PreviewHistoryAction): PreviewHistoryState {
  switch (action.type) {
    case 'push':
      return pushPreviewPath(state, action.sessionId, action.path)
    case 'back':
      return stepPreviewPath(state, action.sessionId, -1)
    case 'forward':
      return stepPreviewPath(state, action.sessionId, 1)
    case 'forgetSession':
      return forgetPreviewSession(state, action.sessionId)
  }
}

/** Alt+Left / Alt+Right only while the preview has focus; every other modifier combination belongs to the app. */
export interface PreviewKeyLike {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly shiftKey?: boolean
}

export function previewHistoryShortcut(event: PreviewKeyLike): PreviewHistoryStep | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.key === 'ArrowLeft') return -1
  if (event.key === 'ArrowRight') return 1
  return null
}
