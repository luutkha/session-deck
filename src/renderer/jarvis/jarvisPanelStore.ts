// D53: whether this window's Jarvis panel is open; D54: how wide it is. One small store per window, shared by the
// shortcut, the tab-bar button, the palette and the panel itself (they live in different parts of the tree). Jarvis's
// own window action (windowUi.ts -> jarvisPrefsUi.ts) uses the same setters, so the mounted panel follows at once.
import { useSyncExternalStore } from 'react'
import { JARVIS_WIDTH_DEFAULT, parseJarvisWidth } from './jarvisLogic'

/** D54: localStorage key of the panel width (the drag handle keeps it here). */
const WIDTH_KEY = 'sessiondeck.jarvis.width.v1'

let open = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

export function openJarvisPanel(): void {
  set(true)
}

export function closeJarvisPanel(): void {
  set(false)
}

export function toggleJarvisPanel(): void {
  set(!open)
}

export function isJarvisPanelOpen(): boolean {
  return open
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return (): void => {
    listeners.delete(listener)
  }
}

export function useJarvisPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, isJarvisPanelOpen)
}

function readStoredWidth(): number {
  try {
    return parseJarvisWidth(window.localStorage.getItem(WIDTH_KEY))
  } catch {
    return JARVIS_WIDTH_DEFAULT
  }
}

function writeStoredWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // a remembered width is a convenience only
  }
}

let width = readStoredWidth()
const widthListeners = new Set<() => void>()

/** The width on screen; also read by windowUi.ts for Jarvis's own tool. */
export function readJarvisPanelWidth(): number {
  return width
}

/** Live width while dragging: the screen only (writing storage 60 times a second would be waste). */
export function setJarvisPanelWidthLive(next: number): void {
  if (width === next) return
  width = next
  for (const listener of widthListeners) listener()
}

/** Final width (drag end, reset, Jarvis's tool): the screen and the value kept for the next start. */
export function setJarvisPanelWidth(next: number): void {
  writeStoredWidth(next)
  setJarvisPanelWidthLive(next)
}

function subscribeWidth(listener: () => void): () => void {
  widthListeners.add(listener)
  return (): void => {
    widthListeners.delete(listener)
  }
}

export function useJarvisPanelWidth(): number {
  return useSyncExternalStore(subscribeWidth, readJarvisPanelWidth)
}
