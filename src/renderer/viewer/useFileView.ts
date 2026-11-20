// D73: loads one file for the side-panel Preview tab through the existing readFileView IPC. Replies for an overtaken
// request (the user clicked another link, or Reload) are dropped by the nonce rule in fileViewState; failures never
// reject the component into a crash.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  beginFileViewLoad,
  failFileViewLoad,
  finishFileViewLoad,
  type FileViewState,
  type PreviewRequest
} from './fileViewState'

export interface FileViewApi {
  /** null while there is no request at all (the Preview tab is empty). */
  readonly state: FileViewState | null
  /** Reads the same link text again (the header's Reload button). */
  readonly reload: () => void
}

export function useFileView(request: PreviewRequest | null): FileViewApi {
  const [state, setState] = useState<FileViewState | null>(null)
  const [reloads, setReloads] = useState(0)
  const counter = useRef(0)
  const sessionId: string | null = request?.sessionId ?? null
  const text: string | null = request?.text ?? null
  // A repeat click on the same link carries a new nonce, so it reads the file again.
  const stamp = request?.nonce ?? 0

  useEffect((): (() => void) | undefined => {
    if (sessionId === null || text === null) {
      setState(null)
      return undefined
    }
    counter.current += 1
    const nonce = counter.current
    let live = true
    setState(beginFileViewLoad(nonce))
    window.api
      .readFileView(sessionId, text)
      .then((result): void => {
        if (!live) return
        setState((previous: FileViewState | null): FileViewState | null =>
          previous === null ? previous : finishFileViewLoad(previous, nonce, result)
        )
      })
      .catch((cause: unknown): void => {
        console.error(`Could not read ${text} of session ${sessionId} for the preview`, cause)
        if (!live) return
        setState((previous: FileViewState | null): FileViewState | null =>
          previous === null ? previous : failFileViewLoad(previous, nonce)
        )
      })
    return (): void => {
      live = false
    }
  }, [sessionId, text, stamp, reloads])

  const reload = useCallback((): void => {
    setReloads((count: number): number => count + 1)
  }, [])

  return { state, reload }
}
