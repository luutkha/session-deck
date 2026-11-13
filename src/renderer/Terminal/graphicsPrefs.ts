// The window's graphics preferences (renderer + visual effects) as React state (no-GPU support, D62).
// Renderer-only, one localStorage key per preference, shared by both windows: the other window hears it through
// the 'storage' event, this one through a module-level subscription (useSyncExternalStore).
import { useSyncExternalStore } from 'react'
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'
import {
  parseEffectsPref,
  parseRendererPref,
  type EffectsPref,
  type RendererPref
} from './terminalRenderer'

export const RENDERER_STORAGE_KEY = 'sessiondeck.renderer.v1'
export const EFFECTS_STORAGE_KEY = 'sessiondeck.effects.v1'

export interface GraphicsPrefs {
  readonly renderer: RendererPref
  readonly effects: EffectsPref
}

export interface GraphicsPrefsApi extends GraphicsPrefs {
  readonly setRenderer: (pref: RendererPref) => void
  readonly setEffects: (pref: EffectsPref) => void
}

function readPrefs(): GraphicsPrefs {
  return {
    renderer: parseRendererPref(readStorageItem(RENDERER_STORAGE_KEY)),
    effects: parseEffectsPref(readStorageItem(EFFECTS_STORAGE_KEY))
  }
}

// The same object identity is returned until a value changes, as useSyncExternalStore requires.
let snapshot: GraphicsPrefs | null = null
const listeners = new Set<() => void>()
let storageBound = false

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function bindStorage(): void {
  if (storageBound || typeof window === 'undefined') {
    return
  }
  storageBound = true
  // Another window (the popped-out Code window) saved a preference: re-read on the next snapshot.
  window.addEventListener('storage', (): void => {
    snapshot = null
    notify()
  })
}

export function getGraphicsPrefs(): GraphicsPrefs {
  snapshot ??= readPrefs()
  return snapshot
}

function save(next: GraphicsPrefs, changed: 'renderer' | 'effects'): void {
  if (changed === 'renderer') {
    writeStorageItem(RENDERER_STORAGE_KEY, next.renderer)
  } else {
    writeStorageItem(EFFECTS_STORAGE_KEY, next.effects)
  }
  snapshot = next
  notify()
}

export function setRendererPref(renderer: RendererPref): void {
  const current = getGraphicsPrefs()
  if (current.renderer === renderer) {
    return
  }
  save({ ...current, renderer }, 'renderer')
}

export function setEffectsPref(effects: EffectsPref): void {
  const current = getGraphicsPrefs()
  if (current.effects === effects) {
    return
  }
  save({ ...current, effects }, 'effects')
}

function subscribe(listener: () => void): () => void {
  bindStorage()
  listeners.add(listener)
  return (): void => {
    listeners.delete(listener)
  }
}

/** The graphics preferences of this window plus setters that persist and notify every mounted component. */
export function useGraphicsPrefs(): GraphicsPrefsApi {
  const prefs = useSyncExternalStore(subscribe, getGraphicsPrefs, getGraphicsPrefs)
  return {
    renderer: prefs.renderer,
    effects: prefs.effects,
    setRenderer: setRendererPref,
    setEffects: setEffectsPref
  }
}
