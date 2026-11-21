// D73/D74: the side panel's Preview tab. A thin header names the file and offers the file actions (Copy path,
// Open in app, Show in Explorer), Reload, Detach (its own window) and Close; the body is a loading line, a
// destructive error, or the existing FileViewPane, which does no IPC. The header also carries the live-reload notice.
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'
import { FileViewPane } from '../preview/FileViewPane'
import { FileActions } from './FileActions'
import { fileNameFromText, type PreviewRequest } from './fileViewState'
import { useFileView } from './useFileView'

const EMPTY_MESSAGE = 'Click a file link in a terminal to preview it here.'
const LOADING_MESSAGE = 'Loading file…'
const NOTICE_CLASS = { missing: 'text-amber-500', updated: 'text-muted-foreground' } as const

export interface PreviewTabProps {
  readonly request: PreviewRequest | null
  /** Clears the request and goes back to Notes. */
  readonly onClose: () => void
}

export function PreviewTab({ request, onClose }: PreviewTabProps): ReactElement {
  const { state, notice, reload } = useFileView(request)
  const view = state !== null && state.status === 'ready' ? state.view : null

  if (request === null) {
    return (
      <p data-preview-empty="" className="px-3 py-3 text-xs text-muted-foreground">
        {EMPTY_MESSAGE}
      </p>
    )
  }

  function detach(): void {
    if (request === null) return
    void window.api.detachFileView(request.sessionId, request.text).catch((cause: unknown): void => {
      console.error('Could not open the preview in its own window', cause)
    })
  }

  return (
    <div data-preview-tab="" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-sidebar-border pl-2 pr-1">
        <span data-preview-name="" className="min-w-0 flex-1 truncate text-[12px] font-medium" title={request.text}>
          {view?.name ?? fileNameFromText(request.text)}
        </span>
        {notice !== null && (
          <span
            data-preview-notice={notice.kind}
            className={`shrink-0 text-[11px] ${NOTICE_CLASS[notice.kind]}`}
            title={notice.text}
          >
            {notice.text}
          </span>
        )}
        {/* Also after a failed read: a file the viewer refuses (too big, not a real PDF...) must stay reachable. */}
        {(view !== null || state?.status === 'error') && (
          <FileActions sessionId={request.sessionId} text={request.text} path={view?.path ?? request.text} />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Reload preview"
          title="Reload"
          data-preview-reload=""
          className="shrink-0 text-muted-foreground"
          onClick={reload}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Detach preview to its own window"
          title="Detach"
          data-preview-detach=""
          className="shrink-0 text-muted-foreground"
          onClick={detach}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close preview"
          title="Close preview"
          data-preview-close=""
          className="shrink-0 text-muted-foreground"
          onClick={onClose}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </header>

      {state === null || state.status === 'loading' ? (
        <p role="status" data-preview-loading="" className="px-3 py-3 text-xs text-muted-foreground">
          {LOADING_MESSAGE}
        </p>
      ) : state.status === 'error' ? (
        <div className="px-3 py-2 text-xs">
          <p role="alert" data-preview-error="" className="text-destructive">
            {state.error}
          </p>
          <p data-preview-error-hint="" className="mt-1 text-muted-foreground">
            You can still open it with the buttons above: Open in default app, Show in Explorer or Copy path.
          </p>
        </div>
      ) : (
        <FileViewPane view={state.view} sessionId={request.sessionId} className="min-h-0 flex-1" />
      )}
    </div>
  )
}
