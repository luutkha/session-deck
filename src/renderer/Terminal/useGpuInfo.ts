// How this run renders (one app-wide fact, measured once by main) as React state (no-GPU support, D62).
// A module-level store keeps one fetch shared by every component; a failed call leaves the info null, which the
// renderer rules read as "not known yet" (DOM renderer until it arrives).
import { useEffect, useSyncExternalStore } from 'react'
import type { GpuInfo, GpuPref } from '../../shared/types'

export type GpuInfoWithPref = GpuInfo & { readonly pref: GpuPref }

export interface GpuInfoApi {
  readonly info: GpuInfoWithPref | null
}

let info: GpuInfoWithPref | null = null
let pending: Promise<GpuInfoWithPref | null> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function load(): Promise<GpuInfoWithPref | null> {
  if (pending !== null) {
    return pending
  }
  const request = window.api
    .getGpuInfo()
    .then((value: GpuInfoWithPref): GpuInfoWithPref => {
      info = value
      notify()
      return value
    })
    .catch((error: unknown): null => {
      console.error('SessionDeck: reading the GPU info failed; using the default renderer', error)
      return null
    })
    .finally((): void => {
      pending = null
    })
  pending = request
  return request
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return (): void => {
    listeners.delete(listener)
  }
}

function getSnapshot(): GpuInfoWithPref | null {
  return info
}

/** Re-measures nothing: re-reads the IPC answer (cheap, cached in main) after the saved preference changed. */
export function refreshGpuInfo(): Promise<GpuInfoWithPref | null> {
  pending = null
  return load()
}

/** The GPU info of this run; null until main answers or when the call fails. */
export function useGpuInfo(): GpuInfoApi {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect((): void => {
    void load()
  }, [])
  return { info: current }
}
