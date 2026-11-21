// D78: detached file-viewer windows are capped so a script or a stuck key cannot open hundreds of windows.
import type { BrowserWindow } from 'electron'

export const MAX_VIEWER_WINDOWS = 8

export interface ViewerWindowSet {
  /** Opens a viewer through `open`, or focuses the oldest open one when the cap is reached. Returns whether a new window opened. */
  readonly request: (open: () => BrowserWindow) => boolean
}

export function createViewerWindowSet(max: number = MAX_VIEWER_WINDOWS): ViewerWindowSet {
  const open: BrowserWindow[] = []
  return {
    request: (create): boolean => {
      for (let i = open.length - 1; i >= 0; i--) if (open[i].isDestroyed()) open.splice(i, 1)
      if (open.length >= max) {
        const oldest = open[0]
        if (oldest.isMinimized()) oldest.restore()
        oldest.focus()
        return false
      }
      const win = create()
      open.push(win)
      win.once('closed', (): void => {
        const at = open.indexOf(win)
        if (at >= 0) open.splice(at, 1)
      })
      return true
    }
  }
}
