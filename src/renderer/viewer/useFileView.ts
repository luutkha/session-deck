// D73/D74: loads one file for the Preview tab (side panel and detached window) and keeps it live. The load,
// stale-reply and notice rules are pure in fileViewState; this hook owns the IPC, the 2 s stat poll and the flash.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileView } from '../../shared/types'
import {
  beginFileViewLive,
  beginFileViewLoad,
  clearFileViewUpdated,
  failFileViewLoad,
  fileViewNotice,
  fileViewRequestKey,
  FILE_VIEW_LIVE_IDLE,
  FILE_VIEW_UPDATED_MS,
  finishFileViewLoad,
  noteFileViewStat,
  noteFileViewUpdated,
  shouldReload,
  shownFileViewState,
  type FileViewLiveState,
  type FileViewNotice,
  type FileViewState,
  type LoadedFileView,
  type PreviewRequest
} from './fileViewState'

/** How often a shown preview asks main whether its file changed on disk (D74). */
export const FILE_VIEW_POLL_MS = 2000

export interface FileViewApi {
  /** null while there is no request at all (the Preview tab is empty). */
  readonly state: FileViewState | null
  /** Reads the same link text again (the header's Reload button). */
  readonly reload: () => void
  /** 'File no longer exists' or the short 'Updated' flash; null when the header says nothing extra. */
  readonly notice: FileViewNotice | null
}

/** Live state tagged with the request it belongs to, so a new file never inherits the old file's notices. */
interface KeyedLiveState {
  readonly key: string
  readonly live: FileViewLiveState
}

export function useFileView(request: PreviewRequest | null): FileViewApi {
  const [loaded, setLoaded] = useState<LoadedFileView | null>(null)
  const [live, setLive] = useState<KeyedLiveState | null>(null)
  const [reloads, setReloads] = useState(0)
  const counter = useRef(0)
  const viewRef = useRef<FileView | null>(null)
  const sessionId: string | null = request?.sessionId ?? null
  const text: string | null = request?.text ?? null
  // A repeat click on the same link carries a new nonce, so it reads the file again.
  const key = fileViewRequestKey(sessionId, text, request?.nonce ?? 0, reloads)
  const state = shownFileViewState(loaded, key)
  const currentLive = live !== null && live.key === key ? live.live : FILE_VIEW_LIVE_IDLE
  const readyView: FileView | null = state !== null && state.status === 'ready' ? state.view : null

  const updateLive = useCallback(
    (targetKey: string, update: (live: FileViewLiveState) => FileViewLiveState): void => {
      setLive((previous) => {
        const same = previous !== null && previous.key === targetKey
        const before = same ? previous.live : beginFileViewLive()
        const after = update(before)
        if (same && after === before) return previous
        return { key: targetKey, live: after }
      })
    },
    []
  )

  // The read that follows a click (or Reload). PreviewTab draws a loading state from the request key during render,
  // so the previous file never appears for the frame between a new request and this effect.
  useEffect((): (() => void) | undefined => {
    if (sessionId === null || text === null) return undefined
    const session = sessionId
    const linkText = text
    const loadKey = key
    let active = true
    counter.current += 1
    const nonce = counter.current
    setLoaded({ key: loadKey, state: beginFileViewLoad(nonce) })
    window.api.readFileView(session, linkText).then(
      (result): void => {
        if (!active) return
        setLoaded((previous) =>
          previous !== null && previous.key === loadKey
            ? { key: loadKey, state: finishFileViewLoad(previous.state, nonce, result) }
            : previous
        )
      },
      (cause: unknown): void => {
        console.error(`Could not read ${linkText} of session ${session} for the preview`, cause)
        if (!active) return
        setLoaded((previous) =>
          previous !== null && previous.key === loadKey
            ? { key: loadKey, state: failFileViewLoad(previous.state, nonce) }
            : previous
        )
      }
    )
    return (): void => {
      active = false
    }
  }, [key])

  // Polling reads the newest ready view; a silent update replaces it without restarting the poll.
  useEffect((): void => {
    viewRef.current = readyView
  }, [readyView])

  useEffect((): (() => void) | undefined => {
    if (sessionId === null || text === null || !readyView) return undefined
    const session = sessionId
    const linkText = text
    const pollKey = key
    let disposed = false
    let inFlight = false
    let timer: number | null = null

    function schedule(): void {
      if (disposed) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout((): void => {
        void check()
      }, FILE_VIEW_POLL_MS)
    }

    async function check(): Promise<void> {
      // A visibility change can check early: drop the pending tick so timers never stack up.
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      if (disposed || inFlight) return
      // A hidden document does no IPC; becoming visible checks right away instead of waiting for the next tick.
      if (document.visibilityState !== 'visible') {
        schedule()
        return
      }
      inFlight = true
      try {
        const stat = await window.api.statFileView(session, linkText)
        if (disposed) return
        updateLive(pollKey, (previous) => noteFileViewStat(previous, stat))
        const shown = viewRef.current
        if (shown === null || !shouldReload(shown, stat)) return
        const result = await window.api.readFileView(session, linkText)
        if (disposed || !result.ok) return
        // Silent: the old content stays until this reply replaces it. FileViewPane is keyed by path, so scroll stays.
        setLoaded((previous) =>
          previous !== null && previous.key === pollKey
            ? { key: pollKey, state: finishFileViewLoad(previous.state, previous.state.nonce, result) }
            : previous
        )
        updateLive(pollKey, () => noteFileViewUpdated(Date.now()))
      } catch (cause: unknown) {
        console.error(`Could not check ${linkText} of session ${session} for changes`, cause)
      } finally {
        inFlight = false
        schedule()
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState !== 'visible' || disposed) return
      void check()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()
    return (): void => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [sessionId, text, key, readyView, updateLive])

  const flashAt = currentLive.updatedAt
  useEffect((): (() => void) | undefined => {
    if (flashAt === null) return undefined
    const timer = window.setTimeout((): void => {
      updateLive(key, (previous) => clearFileViewUpdated(previous, flashAt))
    }, FILE_VIEW_UPDATED_MS)
    return (): void => {
      window.clearTimeout(timer)
    }
  }, [flashAt, key, updateLive])

  const reload = useCallback((): void => {
    setReloads((count: number): number => count + 1)
  }, [])

  return { state, reload, notice: fileViewNotice(currentLive) }
}
