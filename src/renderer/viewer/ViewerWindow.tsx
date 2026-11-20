// D73/D74: the renderer of a detached file-viewer window. Its request arrives in the launch argument
// (window.api.viewerRequest is non-null only here); the same useFileView hook, header actions and FileViewPane
// as the side panel draw it and keep it live. Nothing else from the app shell is mounted.
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'
import { FileViewPane } from '../preview/FileViewPane'
import { FileActions } from './FileActions'
import type { PreviewRequest } from './fileViewState'
import { useFileView } from './useFileView'
import { viewerTitle } from './viewerTitle'

const NO_REQUEST = 'This window has no file to show.'
const NOTICE_CLASS = { missing: 'text-amber-500', updated: 'text-muted-foreground' } as const

export function ViewerWindow(): ReactElement {
  const launch = window.api?.viewerRequest ?? null
  // Stable by value: the hook keys on sessionId/text, so a new object per render never reloads the file.
  const request: PreviewRequest | null =
    launch === null ? null : { sessionId: launch.sessionId, text: launch.text, nonce: 0 }
  const { state, notice, reload } = useFileView(request)
  const view = state !== null && state.status === 'ready' ? state.view : null

  function body(): ReactElement {
    if (launch === null) {
      return (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {NO_REQUEST}
        </p>
      )
    }
    if (state === null || state.status === 'loading') {
      return (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          Loading…
        </p>
      )
    }
    if (state.status === 'error') {
      return (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      )
    }
    return <FileViewPane view={state.view} sessionId={launch.sessionId} className="min-h-0 flex-1" />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-foreground">
      {/* The window uses the hidden native title bar (36px overlay): this strip is the drag area and keeps
          the native min/max/close buttons clear of the header content. */}
      <header className="app-drag flex shrink-0 flex-col border-b border-sidebar-border">
        <div className="h-9" aria-hidden="true" />
        <div className="flex items-center gap-2 px-3 pb-2">
          <span
            data-viewer-title=""
            className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90"
            title={launch?.text ?? ''}
          >
            {viewerTitle(launch?.text ?? '')}
          </span>
          {notice !== null && (
            <span
              data-viewer-notice={notice.kind}
              className={`shrink-0 text-[11px] ${NOTICE_CLASS[notice.kind]}`}
              title={notice.text}
            >
              {notice.text}
            </span>
          )}
          {view !== null && request !== null && (
            <FileActions sessionId={request.sessionId} text={request.text} path={view.path} />
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="app-no-drag text-[11px]"
            aria-label="Reload the file"
            onClick={reload}
          >
            Reload
          </Button>
        </div>
      </header>
      {body()}
    </div>
  )
}
