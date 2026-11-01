// Jarvis (D53) rules the renderer needs: which session is Jarvis, the Ctrl+Shift+J shortcut, the state text and the
// panel width.
// Pure: no React, no DOM, no IPC.
import type { RuntimeState, Session, StoreData } from '../../shared/types'
import type { ShortcutKeyEvent } from '../shell/openTabsLogic'

export function isJarvis(session: Pick<Session, 'role'>): boolean {
  return session.role === 'jarvis'
}

export function findJarvis(data: StoreData | null): Session | null {
  return data?.sessions.find(isJarvis) ?? null
}

/** Panel width (px): default, and the limits. The panel never covers more than 75% of the window. */
export const JARVIS_WIDTH_DEFAULT = 520
export const JARVIS_WIDTH_MIN = 340
const JARVIS_WIDTH_MAX_SHARE = 0.75

export function clampJarvisWidth(width: number, windowWidth: number): number {
  const max = Math.max(JARVIS_WIDTH_MIN, Math.floor(windowWidth * JARVIS_WIDTH_MAX_SHARE))
  if (!Number.isFinite(width)) return Math.min(JARVIS_WIDTH_DEFAULT, max)
  return Math.round(Math.min(max, Math.max(JARVIS_WIDTH_MIN, width)))
}

/** The stored width, or the default for a missing or broken value (clamped again against the window later). */
export function parseJarvisWidth(raw: string | null): number {
  const value = raw === null ? NaN : Number(raw)
  return Number.isFinite(value) && value >= JARVIS_WIDTH_MIN ? Math.round(value) : JARVIS_WIDTH_DEFAULT
}

/** Ctrl+Shift+J toggles the panel (any focus, also the terminal: plain Ctrl+J stays a newline for Claude), never over a dialog. */
export function isJarvisShortcut(event: ShortcutKeyEvent, dialogOpen: boolean): boolean {
  return !dialogOpen && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'j'
}

/** The short state shown in the panel header. */
export function jarvisRowState(session: Session | null, state: RuntimeState | undefined): string {
  if (session === null) return 'Not started'
  if (session.closedAt !== undefined) return 'Closed'
  if (state?.sleeping === true) return 'Sleeping'
  if (state === undefined || state.run !== 'running') return 'Stopped'
  if (state.activity === 'working') return 'Working…'
  if (state.activity === 'needs-input') return 'Needs you'
  return 'Ready'
}
