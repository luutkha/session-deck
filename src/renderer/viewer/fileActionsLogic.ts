// D74: the pure rules of the Preview header's file actions (Copy path / Open / Show in Explorer), so the copy
// check-flash and the header error line are unit-tested without React. FileActions owns the clipboard and IPC calls.
import type { OpenLinkResult } from '../../shared/types'

/** How long the Copy path button shows a check instead of the copy icon. */
export const COPY_FEEDBACK_MS = 1500

/** What the copy button shows; `copiedAt` is also the token of the latest copy, so a newer copy resets the timer. */
export interface CopyFeedback {
  readonly copiedAt: number | null
}

export const COPY_FEEDBACK_IDLE: CopyFeedback = { copiedAt: null }

export function noteCopySuccess(now: number): CopyFeedback {
  return { copiedAt: now }
}

/** The copy timer fired: only the copy it was started for ends; a newer copy keeps its check. */
export function clearCopyFeedback(feedback: CopyFeedback, copiedAt: number): CopyFeedback {
  if (feedback.copiedAt !== copiedAt) return feedback
  return COPY_FEEDBACK_IDLE
}

export function isCopyConfirmed(feedback: CopyFeedback): boolean {
  return feedback.copiedAt !== null
}

/** The accessible name and tooltip of the copy button: it says what just happened. */
export function copyPathLabel(copied: boolean): string {
  return copied ? 'Path copied' : 'Copy path'
}

export type FileAction = 'open' | 'reveal'

export const OPEN_FAILED_TEXT = 'Could not open the file.'
export const REVEAL_FAILED_TEXT = 'Could not show the file in Explorer.'

/** A failed OpenLinkResult becomes the short header line; a success says nothing. */
export function openLinkMessage(result: OpenLinkResult, action: FileAction): string | null {
  if (result.ok) return null
  const error = result.error?.trim() ?? ''
  if (error.length > 0) return error
  return action === 'reveal' ? REVEAL_FAILED_TEXT : OPEN_FAILED_TEXT
}
