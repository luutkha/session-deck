// D73: the side panel's Preview tab. A thin header names the file and offers Reload, Detach (its own window) and Close
// (back to Notes); the body is a loading line, a destructive error, or the existing FileViewPane, which does no IPC.
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'
import { FileViewPane } from '../preview/FileViewPane'
import { fileNameFromText, type PreviewRequest } from './fileViewState'
import { useFileView } from './useFileView'

const EMPTY_MESSAGE = 'Click a file link in a terminal to preview it here.'
const LOADING_MESSAGE = 'Loading file…'

export interface PreviewTabProps {
  readonly request: PreviewRequest | null
  /** Clears the request and goes back to Notes. */
  readonly onClose: () => void
}

export function PreviewTab({ request, onClose }: PreviewTabProps): ReactElement {
  const { state, reload } = useFileView(request)

  if (request === null) {
    return (
      <p data-preview-empty="" className="px-3 py-3 text-xs text-muted-foreground">
        {EMPTY_MESSAGE}
      </p>
    )
  }

  const name = state !== null && state.status === 'ready' ? state.view.name : fileNameFromText(request.text)

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
          {name}
        </span>
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
        <p data-preview-loading="" className="px-3 py-3 text-xs text-muted-foreground">
          {LOADING_MESSAGE}
        </p>
      ) : state.status === 'error' ? (
        <p role="alert" data-preview-error="" className="px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      ) : (
        <FileViewPane view={state.view} sessionId={request.sessionId} className="min-h-0 flex-1" />
      )}
    </div>
  )
}
