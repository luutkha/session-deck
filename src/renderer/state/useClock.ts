// One process-wide clock per tick period. Relative-time labels used to start one setInterval per component
// (sidebar, code tree, Hub); with 30 sessions each tick re-rendered every owner. Now every consumer with the
// same period subscribes to one timer, started by the first subscriber and stopped by the last.
import { useSyncExternalStore } from 'react'

/** Timers and the wall clock come in through deps so the store can be unit-tested without React or timers. */
export interface ClockDeps {
  readonly now: () => number
  readonly setInterval: (handler: () => void, ms: number) => number
  readonly clearInterval: (id: number) => void
}

export interface ClockStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => number
}

/**
 * A single interval shared by every subscriber. The snapshot only changes on a tick (or when the first
 * subscriber joins, so a newly mounted label never starts from a stale value). Pure apart from `deps`.
 */
export function createClock(intervalMs: number, deps: ClockDeps): ClockStore {
  const listeners = new Set<() => void>()
  let timer: number | null = null
  let now = deps.now()

  const tick = (): void => {
    now = deps.now()
    for (const listener of [...listeners]) listener()
  }

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        now = deps.now()
        timer = deps.setInterval(tick, intervalMs)
      }
      return (): void => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== null) {
          deps.clearInterval(timer)
          timer = null
        }
      }
    },
    getSnapshot: (): number => now
  }
}

const clocks = new Map<number, ClockStore>()

function clockFor(intervalMs: number): ClockStore {
  const existing = clocks.get(intervalMs)
  if (existing !== undefined) return existing
  const created = createClock(intervalMs, {
    now: (): number => Date.now(),
    setInterval: (handler: () => void, ms: number): number => window.setInterval(handler, ms),
    clearInterval: (id: number): void => window.clearInterval(id)
  })
  clocks.set(intervalMs, created)
  return created
}

/**
 * The shared wall clock for this cadence: `intervalMs` is the tick period (callers pass their historical
 * 30 s constant), so all relative-time labels of the app refresh together on one timer.
 */
export function useSharedNow(intervalMs: number): number {
  const clock = clockFor(intervalMs)
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot)
}
