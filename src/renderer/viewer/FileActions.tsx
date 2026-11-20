// D74: Copy path / Open in default app / Show in Explorer for the file the preview shows. Used by the side-panel
// Preview tab and the detached window, only once a view is ready (the buttons need main's resolved `view.path`).
import { Check, Copy, FolderOpen, SquareArrowOutUpRight } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { Id, OpenLinkResult } from '../../shared/types'
import { Button } from '../components/ui/button'
import {
  clearCopyFeedback,
  COPY_FEEDBACK_IDLE,
  COPY_FEEDBACK_MS,
  copyPathLabel,
  isCopyConfirmed,
  noteCopySuccess,
  openLinkMessage,
  type CopyFeedback,
  type FileAction
} from './fileActionsLogic'

export interface FileActionsProps {
  readonly sessionId: Id
  /** The link text as the request showed it: main re-resolves it (the renderer's path is never trusted). */
  readonly text: string
  /** The absolute path main resolved; what Copy path copies. */
  readonly path: string
}

const BUTTON_CLASS = 'app-no-drag shrink-0 text-muted-foreground'
const ERROR_CLASS = 'min-w-0 max-w-48 truncate text-[11px] text-destructive'

export function FileActions({ sessionId, text, path }: FileActionsProps): ReactElement {
  const [feedback, setFeedback] = useState<CopyFeedback>(COPY_FEEDBACK_IDLE)
  const [error, setError] = useState<string | null>(null)
  const copied = isCopyConfirmed(feedback)

  useEffect((): (() => void) | undefined => {
    if (feedback.copiedAt === null) return undefined
    const copiedAt = feedback.copiedAt
    const timer = window.setTimeout((): void => {
      setFeedback((previous) => clearCopyFeedback(previous, copiedAt))
    }, COPY_FEEDBACK_MS)
    return (): void => {
      window.clearTimeout(timer)
    }
  }, [feedback.copiedAt])

  function copyPath(): void {
    navigator.clipboard.writeText(path).then(
      (): void => setFeedback(noteCopySuccess(Date.now())),
      (cause: unknown): void => {
        // No check icon on failure: a copy that did not happen must not look like it did.
        console.error('Could not copy the previewed file path', cause)
      }
    )
  }

  function open(action: FileAction, reveal: boolean): void {
    setError(null)
    window.api.openLink(sessionId, text, reveal).then(
      (result: OpenLinkResult): void => setError(openLinkMessage(result, action)),
      (cause: unknown): void => {
        console.error(`Could not ${action === 'reveal' ? 'show' : 'open'} the previewed file`, cause)
        setError(openLinkMessage({ ok: false }, action))
      }
    )
  }

  const label = copyPathLabel(copied)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={BUTTON_CLASS}
        aria-label={label}
        title={label}
        data-file-action="copy"
        onClick={copyPath}
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={BUTTON_CLASS}
        aria-label="Open in default app"
        title="Open in default app"
        data-file-action="open"
        onClick={(): void => open('open', false)}
      >
        <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={BUTTON_CLASS}
        aria-label="Show in Explorer"
        title="Show in Explorer"
        data-file-action="reveal"
        onClick={(): void => open('reveal', true)}
      >
        <FolderOpen className="size-3.5" aria-hidden="true" />
      </Button>
      {error !== null && (
        <span role="alert" data-file-action-error="" className={ERROR_CLASS} title={error}>
          {error}
        </span>
      )}
    </>
  )
}
