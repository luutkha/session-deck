// Pure logic for the Code-mode "viewed" marks (D31 scope): a mark means the user reviewed a file's
// CURRENT state, so it is tied to a signature of that state and quietly disappears when the file
// changes again. No React, no IPC (same discipline as annotations.ts); localStorage is guarded.
import { CHANGES_MAX_FILES, type ChangedFile } from '../../../shared/types'

/** path -> signature of the file state the user last reviewed. */
export type ViewedMap = Readonly<Record<string, string>>

/** Same cap as the changes list itself: no point storing marks for files we never show. */
export const VIEWED_MAX_ENTRIES = CHANGES_MAX_FILES

const STORAGE_PREFIX = 'sessiondeck.changes.viewed.'

/** localStorage key of one worktree's viewed marks. */
export function viewedStorageKey(worktreeId: string): string {
  return STORAGE_PREFIX + worktreeId
}

/**
 * Kind + old path + line counts pin a mark to one state of a file. Counts are nullable (binary /
 * oversized untracked files), so a missing count has a stable representation instead of 'null'.
 */
export function fileSignature(file: ChangedFile): string {
  return `${file.kind}|${file.oldPath ?? ''}|${file.additions ?? 'n'}|${file.deletions ?? 'n'}`
}

/** True only when this exact state of the file has been reviewed. */
export function isViewed(map: ViewedMap, file: ChangedFile): boolean {
  return map[file.path] === fileSignature(file)
}

/** Adds (or refreshes) one mark without mutating the input. */
export function markViewed(map: ViewedMap, file: ChangedFile): ViewedMap {
  return { ...map, [file.path]: fileSignature(file) }
}

/** Drops one path's mark; other paths are untouched. */
export function unmarkViewed(map: ViewedMap, path: string): ViewedMap {
  const next: Record<string, string> = { ...map }
  delete next[path]
  return next
}

/** Marks the whole current file list as reviewed (bulk "mark all viewed" action). */
export function markAllViewed(map: ViewedMap, files: readonly ChangedFile[]): ViewedMap {
  let next: ViewedMap = map
  for (const file of files) next = markViewed(next, file)
  return next
}

/** Drops marks for paths no longer changed, and marks whose file signature has since changed. */
export function pruneViewed(map: ViewedMap, files: readonly ChangedFile[]): ViewedMap {
  const current = new Map<string, string>()
  for (const file of files) current.set(file.path, fileSignature(file))
  const kept: Record<string, string> = {}
  for (const [path, signature] of Object.entries(map)) {
    if (current.get(path) === signature) kept[path] = signature
  }
  return kept
}

/** The files that still need review, in the given order. */
export function unviewedFiles(files: readonly ChangedFile[], map: ViewedMap): readonly ChangedFile[] {
  return files.filter((file) => !isViewed(map, file))
}

/** Badge input: how many of the current files have not been reviewed. */
export function unviewedCount(files: readonly ChangedFile[], map: ViewedMap): number {
  return unviewedFiles(files, map).length
}

/** Malformed stored JSON / non-string values / oversized maps degrade to an empty map. */
export function readViewed(worktreeId: string): ViewedMap {
  if (typeof localStorage === 'undefined') return {}
  let raw: string | null = null
  try {
    raw = localStorage.getItem(viewedStorageKey(worktreeId))
  } catch {
    return {}
  }
  if (raw === null) return {}
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .slice(0, VIEWED_MAX_ENTRIES)
  return Object.fromEntries(entries)
}

type ViewedListener = (worktreeId: string) => void

const listeners = new Set<ViewedListener>()

/** Subscribe to mark changes so the panel and the tab badge refresh together. Returns an unsubscribe. */
export function subscribeViewed(listener: ViewedListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Persists one worktree's marks and notifies subscribers; storage failures never escape. */
export function writeViewed(worktreeId: string, map: ViewedMap): void {
  if (typeof localStorage !== 'undefined') {
    try {
      const capped = Object.fromEntries(Object.entries(map).slice(0, VIEWED_MAX_ENTRIES))
      localStorage.setItem(viewedStorageKey(worktreeId), JSON.stringify(capped))
    } catch {
      // Ignore: marks are a convenience, never a source of truth. Subscribers still refresh.
    }
  }
  // Copy so a listener that unsubscribes itself cannot skip the next one.
  for (const listener of [...listeners]) {
    try {
      listener(worktreeId)
    } catch {
      // A broken subscriber must not make the write throw.
    }
  }
}
