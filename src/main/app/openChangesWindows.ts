// G4: which detached Changes windows were open, so the app can reopen them on the next start.
// All IO comes in through deps; a broken file is never fatal.
import { mkdirSync as fsMkdirSync, readFileSync as fsReadFileSync, renameSync as fsRenameSync, writeFileSync as fsWriteFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isRecord } from '../../shared/guards'

export const OPEN_CHANGES_WINDOWS_FILE_NAME = 'changes-windows-open.json'
/** The app caps detached Changes windows at 8, so the saved list can never be longer. */
export const MAX_OPEN_CHANGES_WINDOWS = 8

export function openChangesWindowsFilePath(userDataDir: string): string {
  return join(userDataDir, OPEN_CHANGES_WINDOWS_FILE_NAME)
}

function normalizeIds(ids: readonly unknown[]): readonly string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of ids) {
    // A hand-edited or older file may contain junk; keep only usable ids, once each, in their original order.
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length === MAX_OPEN_CHANGES_WINDOWS) break
  }
  return result
}

/** The stored list, with bad and duplicate entries dropped and capped. Never throws. */
export function parseOpenWindowsFile(text: string): readonly string[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return normalizeIds(raw)
}

/** Worktrees that still exist, in the saved order (the order the windows should come back in). */
export function restorableIds(saved: readonly string[], knownWorktreeIds: ReadonlySet<string>): readonly string[] {
  return normalizeIds(saved.filter((id) => knownWorktreeIds.has(id)))
}

/**
 * On a normal quit Electron closes the detached windows itself, so the app must NOT call `remove` for windows closed
 * because the app is quitting — doing so would leave nothing to reopen on the next start (the lead handles that case
 * in index.ts). Use this in the window close handler: forget only windows the user closed while the app stays open.
 */
export function shouldForgetOnClose(quitting: boolean): boolean {
  return !quitting
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

export interface OpenWindowsStoreIo {
  readonly readFileSync: (filePath: string) => string
  readonly writeFileSync: (filePath: string, text: string) => void
  readonly mkdirSync: (dirPath: string) => void
  readonly renameSync: (from: string, to: string) => void
  /** Write problems are logged by the caller; they must never stop a window from opening. */
  readonly onError?: (where: string, error: unknown) => void
}

export interface OpenWindowsStore {
  /** The saved worktree ids, or [] when none (or a broken file). */
  load(): readonly string[]
  /** Remembers a worktree. Adding an already saved id leaves the list unchanged. */
  add(id: string): void
  /** Forgets a worktree (only for a user-initiated close, see shouldForgetOnClose). */
  remove(id: string): void
  /** Overwrites the list, e.g. with the ids that were actually reopened. */
  replaceAll(ids: readonly string[]): void
}

export function createOpenWindowsStore(filePath: string, io: OpenWindowsStoreIo): OpenWindowsStore {
  function load(): readonly string[] {
    try {
      return parseOpenWindowsFile(io.readFileSync(filePath))
    } catch (error) {
      if (!isNotFound(error)) io.onError?.('open changes windows: read', error)
      return []
    }
  }

  function write(ids: readonly string[]): void {
    try {
      io.mkdirSync(dirname(filePath))
      const tmp = `${filePath}.tmp`
      io.writeFileSync(tmp, JSON.stringify(ids))
      io.renameSync(tmp, filePath)
    } catch (error) {
      io.onError?.('open changes windows: save', error)
    }
  }

  return {
    load,

    add(id): void {
      if (typeof id !== 'string' || id.length === 0) return
      const ids = load()
      if (ids.includes(id)) return
      // When the list is full, drop the oldest rather than the window that just opened.
      const kept = ids.length >= MAX_OPEN_CHANGES_WINDOWS ? ids.slice(ids.length - MAX_OPEN_CHANGES_WINDOWS + 1) : ids
      write(normalizeIds([...kept, id]))
    },

    remove(id): void {
      write(load().filter((existing) => existing !== id))
    },

    replaceAll(ids): void {
      write(normalizeIds(ids))
    }
  }
}

/** The production IO: node:fs sync, with an injected error reporter. */
export function nodeOpenWindowsStoreIo(onError?: (where: string, error: unknown) => void): OpenWindowsStoreIo {
  return {
    readFileSync: (filePath) => fsReadFileSync(filePath, 'utf-8'),
    writeFileSync: (filePath, text) => fsWriteFileSync(filePath, text, 'utf-8'),
    mkdirSync: (dirPath) => fsMkdirSync(dirPath, { recursive: true }),
    renameSync: (from, to) => fsRenameSync(from, to),
    ...(onError === undefined ? {} : { onError })
  }
}
