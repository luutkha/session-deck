// The app-wide terminal profile (zoom + scrollback) as React state. One localStorage key shared by both
// windows: the other window hears it through the 'storage' event, this one through a local event.
import { useCallback, useEffect, useState } from 'react'
import { ZOOM_STEP, nextZoom, normalizeTermView, readTermView, storeTermView, type TermView } from './termView'
import type { ZoomAction } from './paneFactory'

const TERM_VIEW_EVENT = 'sessiondeck:termview'

export interface TermViewApi {
  readonly termView: TermView
  /** Sets (clamped) and persists the profile; the terminal workspace applies it live. */
  readonly setTermView: (view: TermView) => void
  /** Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+wheel step. */
  readonly zoom: (action: ZoomAction) => void
}

export function useTermView(): TermViewApi {
  const [termView, setState] = useState<TermView>((): TermView => readTermView())

  useEffect((): (() => void) => {
    const reread = (): void => setState(readTermView())
    window.addEventListener('storage', reread)
    window.addEventListener(TERM_VIEW_EVENT, reread)
    return (): void => {
      window.removeEventListener('storage', reread)
      window.removeEventListener(TERM_VIEW_EVENT, reread)
    }
  }, [])

  const setTermView = useCallback((view: TermView): void => {
    const next = normalizeTermView(view)
    storeTermView(next)
    window.dispatchEvent(new Event(TERM_VIEW_EVENT))
    setState(next)
  }, [])

  const zoom = useCallback((action: ZoomAction): void => {
    setState((current: TermView): TermView => {
      const zoomPercent = action === 'reset' ? 100 : nextZoom(current.zoomPercent, action === 'in' ? ZOOM_STEP : -ZOOM_STEP)
      if (zoomPercent === current.zoomPercent) return current
      const next = { ...current, zoomPercent }
      storeTermView(next)
      return next
    })
  }, [])

  return { termView, setTermView, zoom }
}
