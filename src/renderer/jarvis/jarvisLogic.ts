// Jarvis (D53) rules the renderer needs: which session is Jarvis, the Ctrl+Shift+J shortcut, and the row text.
// Pure: no React, no DOM, no IPC.
import type { RuntimeState, Session, StoreData } from '../../shared/types'
import type { ShortcutKeyEvent } from '../shell/openTabsLogic'

export function isJarvis(session: Pick<Session, 'role'>): boolean {
  return session.role === 'jarvis'
}

export function findJarvis(data: StoreData | null): Session | null {
  return data?.sessions.find(isJarvis) ?? null
}

/** The store without Jarvis: it has its own pinned row, so lists, groups and the Hub board leave it out. */
export function withoutJarvis(data: StoreData): StoreData {
  return data.sessions.some(isJarvis) ? { ...data, sessions: data.sessions.filter((s) => !isJarvis(s)) } : data
}

/** Ctrl+Shift+J (any focus, also the terminal: plain Ctrl+J stays a newline for Claude), never over a dialog. */
export function isJarvisShortcut(event: ShortcutKeyEvent, dialogOpen: boolean): boolean {
  return !dialogOpen && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'j'
}

/** The short state shown on the pinned row. */
export function jarvisRowState(session: Session | null, state: RuntimeState | undefined): string {
  if (session === null) return 'Not started'
  if (session.closedAt !== undefined) return 'Closed'
  if (state?.sleeping === true) return 'Sleeping'
  if (state === undefined || state.run !== 'running') return 'Stopped'
  if (state.activity === 'working') return 'Working…'
  if (state.activity === 'needs-input') return 'Needs you'
  return 'Ready'
}
