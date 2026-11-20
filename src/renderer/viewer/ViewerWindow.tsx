// D73: the renderer of a detached file-viewer window. Its request arrives in the launch argument
// (window.api.viewerRequest is non-null only here); main re-resolves the link text and reads the file,
// and the same FileViewPane the side panel uses draws it. Nothing else from the app shell is mounted.
import { useEffect, useState, type ReactElement } from 'react'
import type { FileView, Id } from '../../shared/types'
import { Button } from '../components/ui/button'
import { FileViewPane } from '../preview/FileViewPane'
import { viewerTitle } from './viewerTitle'

type ViewerState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly view: FileView }
  | { readonly status: 'error'; readonly error: string }

const NO_REQUEST = 'This window has no file to show.'
const LOAD_ERROR = 'Could not load the file.'

function failureText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return LOAD_ERROR
}

export function ViewerWindow(): ReactElement {
  const request = window.api?.viewerRequest ?? null
  const sessionId: Id | null = request?.sessionId ?? null
  const text = request?.text ?? ''
  const [state, setState] = useState<ViewerState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect((): (() => void) | void => {
    if (sessionId === null) {
      setState({ status: 'error', error: NO_REQUEST })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    window.api
      .readFileView(sessionId, text)
      .then((result) => {
        if (cancelled) return
        setState(result.ok ? { status: 'ready', view: result.view } : { status: 'error', error: result.error })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({ status: 'error', error: failureText(error) })
      })
    return (): void => {
      cancelled = true
    }
  }, [sessionId, text, reloadKey])

  function reload(): void {
    setReloadKey((previous) => previous + 1)
  }

  function body(): ReactElement {
    if (state.status === 'loading') {
      return <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
    }
    if (state.status === 'error') {
      return (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      )
    }
    if (sessionId === null) {
      return (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {NO_REQUEST}
        </p>
      )
    }
    return <FileViewPane view={state.view} sessionId={sessionId} className="min-h-0 flex-1" />
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
            title={text}
          >
            {viewerTitle(text)}
          </span>
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
