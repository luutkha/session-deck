// D83: detached Changes windows. One per worktree (a second request focuses it) and capped, so a script or a stuck
// key cannot open hundreds of windows.
import type { BrowserWindow } from 'electron'

export const MAX_CHANGES_WINDOWS = 8

export interface ChangesWindowSet {
  /**
   * Opens the Changes window of `worktreeId` through `create`, or focuses the existing window of that worktree.
   * At the cap the oldest window is focused instead. Returns whether a new window opened.
   */
  readonly request: (worktreeId: string, create: () => BrowserWindow) => boolean
  /** D84: closes the detached window of a worktree. False when it was not open. */
  readonly close: (worktreeId: string) => boolean
}

interface OpenChangesWindow {
  readonly worktreeId: string
  readonly win: BrowserWindow
}

export function createChangesWindowSet(max: number = MAX_CHANGES_WINDOWS): ChangesWindowSet {
  const open: OpenChangesWindow[] = []

  const focus = (win: BrowserWindow): void => {
    if (win.isMinimized()) win.restore()
    win.focus()
  }

  return {
    request: (worktreeId, create): boolean => {
      // A window destroyed without its 'closed' event must not hold a slot or block its worktree forever.
      for (let i = open.length - 1; i >= 0; i--) if (open[i].win.isDestroyed()) open.splice(i, 1)
      const existing = open.find((entry) => entry.worktreeId === worktreeId)
      if (existing !== undefined) {
        focus(existing.win)
        return false
      }
      if (open.length >= max) {
        const oldest = open[0]
        if (oldest !== undefined) focus(oldest.win)
        return false
      }
      const win = create()
      const entry: OpenChangesWindow = { worktreeId, win }
      open.push(entry)
      win.once('closed', (): void => {
        const at = open.indexOf(entry)
        if (at >= 0) open.splice(at, 1)
      })
      return true
    },

    close: (worktreeId): boolean => {
      for (let i = open.length - 1; i >= 0; i--) if (open[i].win.isDestroyed()) open.splice(i, 1)
      const entry = open.find((candidate) => candidate.worktreeId === worktreeId)
      if (entry === undefined) return false
      const at = open.indexOf(entry)
      if (at >= 0) open.splice(at, 1)
      entry.win.close()
      return true
    }
  }
}

/** The fields pickSessionForChanges needs; a full Session satisfies them. */
export interface ChangesSession {
  readonly id: string
  readonly worktreeId?: string
  readonly closedAt?: number
}

/**
 * D84: the session that shows a worktree's Changes tab when its detached window docks back. Only open sessions of
 * that worktree count: the one already on screen first, else a running one, else the first.
 */
export function pickSessionForChanges<T extends ChangesSession>(
  sessions: readonly T[],
  worktreeId: string,
  activeId: string | null,
  isRunning: (id: string) => boolean = () => false
): T | undefined {
  const candidates = sessions.filter((session) => session.worktreeId === worktreeId && session.closedAt === undefined)
  return candidates.find((session) => session.id === activeId) ?? candidates.find((session) => isRunning(session.id)) ?? candidates[0]
}
