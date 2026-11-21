// What the side-panel Preview tab shows for the newest file request (D73/D74). Pure, so the stale-reply rule, the
// derived loading state and the live-reload notices are unit-tested; useFileView owns the IPC calls and PreviewTab
// only renders this state.
import type { FileView, FileViewResult, FileViewStat } from '../../shared/types'
import type { FileViewRequest } from './previewBus'

/** One file request as the workspace remembers it; the nonce grows per request so the same link reads again. */
export interface PreviewRequest extends FileViewRequest {
  readonly nonce: number
}

export type FileViewState =
  | { readonly status: 'loading'; readonly nonce: number }
  | { readonly status: 'ready'; readonly nonce: number; readonly view: FileView }
  | { readonly status: 'error'; readonly nonce: number; readonly error: string }

/** A load result plus the request it belongs to, so a new request never draws the previous file for one frame. */
export interface LoadedFileView {
  readonly key: string
  readonly state: FileViewState
}

export const FILE_VIEW_LOAD_FAILED = 'Could not read this file.'

/** A load started. Its nonce is what the reply must carry to be shown. */
export function beginFileViewLoad(nonce: number): FileViewState {
  return { status: 'loading', nonce }
}

/** A reply is shown only for the newest load: a slower reply to an older request (or one after Close) is dropped. */
export function finishFileViewLoad(state: FileViewState, nonce: number, result: FileViewResult): FileViewState {
  if (state.nonce !== nonce) return state
  if (!result.ok) return { status: 'error', nonce, error: result.error }
  return { status: 'ready', nonce, view: result.view }
}

/** The IPC call itself failed (main gone, channel error). Same stale rule as finishFileViewLoad. */
export function failFileViewLoad(state: FileViewState, nonce: number, message = FILE_VIEW_LOAD_FAILED): FileViewState {
  if (state.nonce !== nonce) return state
  return { status: 'error', nonce, error: message }
}

/** The name to show while the file is still loading: the last segment of the link text, without a ":12:5" suffix. */
export function fileNameFromText(text: string): string {
  const withoutSuffix = text.trim().replace(/:\d+(?::\d+)?$/, '')
  const withoutTrailingSlash = withoutSuffix.replace(/[\\/]+$/, '')
  const parts = withoutTrailingSlash.split(/[\\/]/)
  return parts[parts.length - 1] ?? text
}

/** Identity of one load: the request (nonce) plus the Reload counter, so a reload is a new load of the same file. */
export function fileViewRequestKey(
  sessionId: string | null,
  text: string | null,
  nonce: number,
  reloads: number
): string {
  return `${sessionId ?? ''}\u0000${text ?? ''}\u0000${String(nonce)}:${String(reloads)}`
}

/**
 * The state to draw right now. A stored state from another request is drawn as loading, never as its old file:
 * setting loading in an effect would paint the previous file for one frame after a new link click (D74).
 */
export function shownFileViewState(loaded: LoadedFileView | null, key: string): FileViewState | null {
  if (loaded === null) return null
  if (loaded.key === key) return loaded.state
  return { status: 'loading', nonce: loaded.state.nonce }
}

/** What live reload learned about the file on disk; pure so the header notice rules are unit-tested. */
export interface FileViewLiveState {
  /** The last stat said the file is gone: the last content stays on screen (D74). */
  readonly missing: boolean
  /** When a silent reload replaced the content; null when there is no "Updated" flash to show. */
  readonly updatedAt: number | null
}

export type FileViewNoticeKind = 'missing' | 'updated'

/** The small line the header shows next to the file name (D74). */
export interface FileViewNotice {
  readonly kind: FileViewNoticeKind
  readonly text: string
}

export const FILE_VIEW_LIVE_IDLE: FileViewLiveState = { missing: false, updatedAt: null }
/** How long "Updated" stays in the header after a silent reload. */
export const FILE_VIEW_UPDATED_MS = 2000
export const FILE_VIEW_MISSING_TEXT = 'File no longer exists'
export const FILE_VIEW_UPDATED_TEXT = 'Updated'

/** A new request starts clean: nothing is known about the file on disk yet. */
export function beginFileViewLive(): FileViewLiveState {
  return FILE_VIEW_LIVE_IDLE
}

/** A stat came back: a missing file keeps the shown content and shows the notice until the file is back. */
export function noteFileViewStat(live: FileViewLiveState, stat: FileViewStat): FileViewLiveState {
  // Only a stat that says the file is GONE counts: a locked or briefly unreadable file keeps its content and no notice.
  const missing = !stat.ok && stat.gone === true
  if (missing === live.missing) return live
  return { ...live, missing }
}

/** The file changed and a silent reload replaced the content: flash "Updated" for a moment. */
export function noteFileViewUpdated(at: number): FileViewLiveState {
  return { missing: false, updatedAt: at }
}

/** A flash timer fired. Only the flash it was started for is cleared; a newer update keeps its own time. */
export function clearFileViewUpdated(live: FileViewLiveState, at: number): FileViewLiveState {
  if (live.updatedAt !== at) return live
  return { ...live, updatedAt: null }
}

/** The header notice to draw now: "gone" wins over the "Updated" flash. */
export function fileViewNotice(live: FileViewLiveState): FileViewNotice | null {
  if (live.missing) return { kind: 'missing', text: FILE_VIEW_MISSING_TEXT }
  if (live.updatedAt !== null) return { kind: 'updated', text: FILE_VIEW_UPDATED_TEXT }
  return null
}

/** D74: a cheap stat says whether the shown copy is out of date (mtime or size differ). */
export function shouldReload(view: FileView, stat: FileViewStat): boolean {
  if (!stat.ok) return false
  return stat.mtimeMs !== view.mtimeMs || stat.size !== view.size
}
