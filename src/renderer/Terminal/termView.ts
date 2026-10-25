// Pure terminal view preferences (zoom + scrollback), renderer-only like the split layout.
// No React, no DOM, no IPC: localStorage access goes through guarded helpers like shellPrefs.
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'

export interface TermView {
  /** 50..200; 100 = the base font size. */
  readonly zoomPercent: number
  /** 1000..100000 lines of scrollback per pane. */
  readonly scrollbackLines: number
}

export const TERM_VIEW_STORAGE_KEY = 'sessiondeck.termview.v1'
export const BASE_FONT_SIZE = 14
export const MIN_FONT_SIZE = 7
export const MAX_FONT_SIZE = 32
export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
export const ZOOM_STEP = 10
export const SCROLLBACK_MIN = 1_000
export const SCROLLBACK_MAX = 100_000
export const DEFAULT_TERM_VIEW: TermView = { zoomPercent: 100, scrollbackLines: 10_000 }

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampZoom(percent: number): number {
  return clampInt(percent, ZOOM_MIN, ZOOM_MAX)
}

export function clampScrollback(lines: number): number {
  return clampInt(lines, SCROLLBACK_MIN, SCROLLBACK_MAX)
}

/** One shortcut/wheel step from the current zoom, clamped. */
export function nextZoom(current: number, delta: number): number {
  return clampZoom(clampZoom(current) + delta)
}

/** The xterm font size for a zoom percentage (7..32 px keeps rendering sane). */
export function fontSizeFor(zoomPercent: number): number {
  const scaled = Math.round((BASE_FONT_SIZE * clampZoom(zoomPercent)) / 100)
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, scaled))
}

export function normalizeTermView(view: TermView): TermView {
  return { zoomPercent: clampZoom(view.zoomPercent), scrollbackLines: clampScrollback(view.scrollbackLines) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses a stored record; malformed JSON or wrong shapes → null (caller falls back to defaults). */
export function parseTermView(raw: string | null): TermView | null {
  if (raw === null || raw.trim().length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const zoomPercent = parsed['zoomPercent']
  const scrollbackLines = parsed['scrollbackLines']
  if (typeof zoomPercent !== 'number' || typeof scrollbackLines !== 'number') return null
  return normalizeTermView({ zoomPercent, scrollbackLines })
}

export function serializeTermView(view: TermView): string {
  return JSON.stringify(normalizeTermView(view))
}

/** The app-wide terminal profile (both windows read the same key). Missing/garbage → defaults. */
export function readTermView(): TermView {
  return parseTermView(readStorageItem(TERM_VIEW_STORAGE_KEY)) ?? DEFAULT_TERM_VIEW
}

export function storeTermView(view: TermView): void {
  writeStorageItem(TERM_VIEW_STORAGE_KEY, serializeTermView(view))
}
