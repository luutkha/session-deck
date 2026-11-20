// What the side-panel Preview tab shows for the newest file request (D73). Pure, so the stale-reply rule is unit-tested;
// useFileView owns the IPC call and PreviewTab only renders this state.
import type { FileView, FileViewResult } from '../../shared/types'
import type { FileViewRequest } from './previewBus'

/** One file request as the workspace remembers it; the nonce grows per request so the same link reads again. */
export interface PreviewRequest extends FileViewRequest {
  readonly nonce: number
}

export type FileViewState =
  | { readonly status: 'loading'; readonly nonce: number }
  | { readonly status: 'ready'; readonly nonce: number; readonly view: FileView }
  | { readonly status: 'error'; readonly nonce: number; readonly error: string }

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
