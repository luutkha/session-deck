import { useCallback, useState } from 'react'
import { readStorageItem, writeStorageItem } from './shellPrefs'
import {
  clampSidebarWidth,
  parseSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_STORAGE_KEY
} from './sidebarWidth'

export interface SidebarWidthApi {
  readonly width: number
  /** Live width while dragging: updates the screen only (writing storage 60 times a second would be waste). */
  readonly setLive: (width: number) => void
  /** Final width (drag end, key press): updates the screen and keeps it for the next start. */
  readonly commit: (width: number) => void
  /** Back to the default width (double-click on the handle). */
  readonly reset: () => void
}

/** The sessions sidebar's width: read once from localStorage, kept there when the user lets go of the handle (D70). */
export function useSidebarWidth(): SidebarWidthApi {
  const [width, setWidth] = useState<number>((): number => parseSidebarWidth(readStorageItem(SIDEBAR_WIDTH_STORAGE_KEY)))

  const setLive = useCallback((next: number): void => {
    setWidth(clampSidebarWidth(next))
  }, [])

  const commit = useCallback((next: number): void => {
    const value = clampSidebarWidth(next)
    setWidth(value)
    writeStorageItem(SIDEBAR_WIDTH_STORAGE_KEY, String(value))
  }, [])

  const reset = useCallback((): void => {
    setWidth(SIDEBAR_WIDTH_DEFAULT)
    writeStorageItem(SIDEBAR_WIDTH_STORAGE_KEY, String(SIDEBAR_WIDTH_DEFAULT))
  }, [])

  return { width, setLive, commit, reset }
}
