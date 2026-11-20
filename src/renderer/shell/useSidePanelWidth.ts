import { useCallback, useState } from 'react'
import { readStorageItem, writeStorageItem } from './shellPrefs'
import {
  clampSidePanelWidth,
  parseSidePanelWidth,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_STORAGE_KEY
} from './sidePanelWidth'

export interface SidePanelWidthApi {
  readonly width: number
  /** Live width while dragging: updates the screen only (writing storage 60 times a second would be waste). */
  readonly setLive: (width: number) => void
  /** Final width (drag end, key press): updates the screen and keeps it for the next start. */
  readonly commit: (width: number) => void
  /** Back to the default width (double-click on the handle). */
  readonly reset: () => void
}

/** The right side panel's width: read once from localStorage, kept there when the user lets go of the handle (D73). */
export function useSidePanelWidth(): SidePanelWidthApi {
  const [width, setWidth] = useState<number>((): number => parseSidePanelWidth(readStorageItem(SIDE_PANEL_WIDTH_STORAGE_KEY)))

  const setLive = useCallback((next: number): void => {
    setWidth(clampSidePanelWidth(next))
  }, [])

  const commit = useCallback((next: number): void => {
    const value = clampSidePanelWidth(next)
    setWidth(value)
    writeStorageItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(value))
  }, [])

  const reset = useCallback((): void => {
    setWidth(SIDE_PANEL_WIDTH_DEFAULT)
    writeStorageItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(SIDE_PANEL_WIDTH_DEFAULT))
  }, [])

  return { width, setLive, commit, reset }
}
