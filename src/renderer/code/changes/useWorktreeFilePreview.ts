// React hook over the file-preview IPC (rich previews, Code mode). Replies for an overtaken request or
// another file are dropped; failures never reject the component into a crash.
import { useEffect, useState } from 'react'
import type { FilePreview, Id } from '../../../shared/types'
import { createRequestGate, type RequestGate } from './changesLoad'

export interface WorktreeFilePreviewResult {
  readonly preview: FilePreview | null
  readonly loading: boolean
  readonly error: string | null
}

const PREVIEW_LOAD_FAILED = 'Could not load this preview.'
const NO_FILE: WorktreeFilePreviewResult = { preview: null, loading: false, error: null }

/**
 * The preview of the selected file, loaded only when the Preview view is shown (`enabled`).
 * `stamp` is the CONTENT key of the changes list: a poll that found the same files does not reload the same file.
 */
export function useWorktreeFilePreview(
  worktreeId: Id,
  path: string | null,
  enabled: boolean,
  stamp: string | null
): WorktreeFilePreviewResult {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gate] = useState<RequestGate>(createRequestGate)

  useEffect((): (() => void) | undefined => {
    if (path === null || !enabled) return undefined
    const file: string = path
    const ticket = gate.begin()
    setLoading(true)
    setError(null)
    window.api
      .getWorktreeFilePreview(worktreeId, file)
      .then((result): void => {
        if (!gate.isCurrent(ticket)) return
        setPreview(result)
        setLoading(false)
      })
      .catch((cause: unknown): void => {
        console.error(`Could not load the preview of ${file} in worktree ${worktreeId}`, cause)
        if (!gate.isCurrent(ticket)) return
        setPreview(null)
        setError(PREVIEW_LOAD_FAILED)
        setLoading(false)
      })
    return (): void => gate.cancel()
  }, [worktreeId, path, enabled, stamp, gate])

  if (path === null || !enabled) return NO_FILE
  return { preview, loading, error }
}
