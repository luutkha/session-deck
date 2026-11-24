// D84/E1: the detached Changes window remembers its position and size per worktree, so it comes back on the same
// monitor. A saved rectangle on a monitor that is gone loses its x/y (Electron centers it) but keeps its size.
// All IO comes in through deps; a broken file is never fatal.
import { mkdirSync as fsMkdirSync, readFileSync as fsReadFileSync, renameSync as fsRenameSync, writeFileSync as fsWriteFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isRecord } from '../../shared/guards'

export const CHANGES_BOUNDS_FILE_NAME = 'changes-windows.json'
/** Older worktrees fall out, so the file cannot grow forever. */
export const MAX_SAVED_BOUNDS = 50
/** Smallest complete window: the same minimum the Changes BrowserWindow enforces. */
const MIN_WIDTH = 640
const MIN_HEIGHT = 420
/** A saved window counts as on screen when this much of it overlaps one work area. */
const MIN_VISIBLE_WIDTH = 100
const MIN_VISIBLE_HEIGHT = 60
/** A stored entry must be sane before it is trusted (guards against hand-edited files). */
const STORED_MIN_WIDTH = 200
const STORED_MAX_WIDTH = 10000
const STORED_MIN_HEIGHT = 200
const STORED_MAX_HEIGHT = 10000

export interface SavedBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The part of a display work area fitBounds uses (electron.Rectangle satisfies it). */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface FittedBounds {
  readonly x?: number
  readonly y?: number
  readonly width: number
  readonly height: number
}

export function changesBoundsFilePath(userDataDir: string): string {
  return join(userDataDir, CHANGES_BOUNDS_FILE_NAME)
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function parseSavedBounds(value: unknown): SavedBounds | undefined {
  if (!isRecord(value)) return undefined
  const { x, y, width, height } = value
  if (!isFiniteInt(x) || !isFiniteInt(y) || !isFiniteInt(width) || !isFiniteInt(height)) return undefined
  if (width < STORED_MIN_WIDTH || width > STORED_MAX_WIDTH || height < STORED_MIN_HEIGHT || height > STORED_MAX_HEIGHT) return undefined
  return { x, y, width, height }
}

function trimToCap(map: Record<string, SavedBounds>): Record<string, SavedBounds> {
  const ids = Object.keys(map)
  if (ids.length <= MAX_SAVED_BOUNDS) return map
  for (const id of ids.slice(0, ids.length - MAX_SAVED_BOUNDS)) delete map[id]
  return map
}

/** The stored map, with every bad entry dropped. Never throws. */
export function parseBoundsFile(text: string): Record<string, SavedBounds> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (!isRecord(raw)) return {}
  const entries: Record<string, SavedBounds> = {}
  for (const [worktreeId, value] of Object.entries(raw)) {
    const bounds = parseSavedBounds(value)
    if (bounds !== undefined) entries[worktreeId] = bounds
  }
  return trimToCap(entries)
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function overlap(a: Rect, b: Rect): { readonly width: number; readonly height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/** True when at least MIN_VISIBLE_WIDTH x MIN_VISIBLE_HEIGHT of the window lies inside one work area. */
function isOnScreen(saved: SavedBounds, workAreas: readonly Rect[]): boolean {
  return workAreas.some((area) => {
    const visible = overlap(saved, area)
    return visible.width >= MIN_VISIBLE_WIDTH && visible.height >= MIN_VISIBLE_HEIGHT
  })
}

/** The work area with the most pixels; a size is clamped to it when its monitor is gone. */
function biggestWorkArea(workAreas: readonly Rect[]): Rect | undefined {
  return workAreas.reduce<Rect | undefined>((biggest, area) => {
    if (biggest === undefined) return area
    return area.width * area.height > biggest.width * biggest.height ? area : biggest
  }, undefined)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

/**
 * The bounds a new Changes window gets. Without saved bounds only the fallback size (Electron centers it). A saved
 * window whose monitor is gone drops x/y and keeps its size, clamped to the minimum and to the biggest work area.
 */
export function fitBounds(saved: SavedBounds | undefined, workAreas: readonly Rect[], fallback: { readonly width: number; readonly height: number }): FittedBounds {
  if (saved === undefined) return { width: fallback.width, height: fallback.height }
  if (isOnScreen(saved, workAreas)) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  const biggest = biggestWorkArea(workAreas)
  return {
    width: clamp(saved.width, MIN_WIDTH, biggest?.width ?? saved.width),
    height: clamp(saved.height, MIN_HEIGHT, biggest?.height ?? saved.height)
  }
}

export interface BoundsStoreIo {
  readonly readFileSync: (filePath: string) => string
  readonly writeFileSync: (filePath: string, text: string) => void
  readonly mkdirSync: (dirPath: string) => void
  readonly renameSync: (from: string, to: string) => void
  /** Write problems are logged by the caller; they must never stop a window from opening. */
  readonly onError?: (where: string, error: unknown) => void
}

export interface BoundsStore {
  /** The saved bounds of a worktree, or undefined when none (or a broken file). */
  get(worktreeId: string): SavedBounds | undefined
  /** Remembers the bounds of a worktree. Re-saving a worktree makes it the newest entry. */
  set(worktreeId: string, bounds: SavedBounds): void
}

export function createBoundsStore(filePath: string, io: BoundsStoreIo): BoundsStore {
  function read(): Record<string, SavedBounds> {
    try {
      return parseBoundsFile(io.readFileSync(filePath))
    } catch (error) {
      if (!isNotFound(error)) io.onError?.('changes window bounds: read', error)
      return {}
    }
  }

  function write(map: Record<string, SavedBounds>): void {
    try {
      io.mkdirSync(dirname(filePath))
      const tmp = `${filePath}.tmp`
      io.writeFileSync(tmp, JSON.stringify(map))
      io.renameSync(tmp, filePath)
    } catch (error) {
      io.onError?.('changes window bounds: save', error)
    }
  }

  return {
    get: (worktreeId) => read()[worktreeId],

    set(worktreeId, bounds): void {
      const valid = parseSavedBounds(bounds)
      if (valid === undefined) return
      const map = read()
      // Delete first so a re-saved worktree moves to the newest position instead of keeping its old one.
      delete map[worktreeId]
      map[worktreeId] = valid
      write(trimToCap(map))
    }
  }
}

/** The production IO: node:fs sync, with an injected error reporter. */
export function nodeBoundsStoreIo(onError?: (where: string, error: unknown) => void): BoundsStoreIo {
  return {
    readFileSync: (filePath) => fsReadFileSync(filePath, 'utf-8'),
    writeFileSync: (filePath, text) => fsWriteFileSync(filePath, text, 'utf-8'),
    mkdirSync: (dirPath) => fsMkdirSync(dirPath, { recursive: true }),
    renameSync: (from, to) => fsRenameSync(from, to),
    ...(onError === undefined ? {} : { onError })
  }
}
