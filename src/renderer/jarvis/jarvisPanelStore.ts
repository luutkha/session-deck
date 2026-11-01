// D53: whether this window's Jarvis panel is open. One small store per window, shared by the shortcut, the tab-bar
// button, the palette and the panel itself (they live in different parts of the tree).
import { useSyncExternalStore } from 'react'

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
