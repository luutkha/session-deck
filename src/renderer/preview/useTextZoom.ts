// Remembers the preview pane's text zoom (D74 #6). localStorage can throw, so both accesses go
// through the guarded shell helpers; a missing or broken value falls back to 100.
import { useCallback, useEffect, useState } from 'react'
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'
import {
  FILE_VIEW_ZOOM_STORAGE_KEY,
  TEXT_ZOOM_STEPS,
  nextZoomStep,
  parseTextZoom,
  serializeTextZoom,
  type ZoomDirection
} from './fileViewZoom'

export type TextZoomControls = readonly [number, (direction: ZoomDirection) => void]

export function useTextZoom(): TextZoomControls {
  const [zoom, setZoom] = useState<number>((): number =>
    parseTextZoom(readStorageItem(FILE_VIEW_ZOOM_STORAGE_KEY))
  )

  useEffect((): void => {
    writeStorageItem(FILE_VIEW_ZOOM_STORAGE_KEY, serializeTextZoom(zoom))
  }, [zoom])

  const step = useCallback((direction: ZoomDirection): void => {
    setZoom((current: number): number => nextZoomStep(current, direction, TEXT_ZOOM_STEPS))
  }, [])

  return [zoom, step]
}
