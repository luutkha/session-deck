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
    }
  }
}
