import { nextTimerDelay, resetFireAt } from './autopilotPolicy'
import type { TimerHandle } from './autopilotTypes'

export interface ResetTimerDeps {
  /** Epoch milliseconds. */
  readonly now: () => number
  readonly setTimeout: (callback: () => void, ms: number) => TimerHandle
  readonly clearTimeout: (handle: TimerHandle) => void
  readonly onFire: () => void
  readonly onError: (where: string, error: unknown) => void
}

export interface ResetTimer {
  /** Schedules onFire for the reset (epoch seconds; null = nothing to wait for). Replaces an earlier schedule. */
  arm(resetsAt: number | null): void
  disarm(): void
}

/**
 * One timer that fires at the 5-hour reset. The browser timer cannot wait longer than MAX_TIMEOUT_MS, so the wait is
 * chunked: each chunk re-checks the clock. A failing onFire is reported, never thrown out of the timer.
 */
export function createResetTimer(deps: ResetTimerDeps): ResetTimer {
  let handle: TimerHandle | null = null

  function disarm(): void {
    if (handle !== null) {
      deps.clearTimeout(handle)
      handle = null
    }
  }

  function schedule(fireAt: number): void {
    handle = deps.setTimeout(() => {
      handle = null
      if (deps.now() < fireAt) {
        schedule(fireAt)
        return
      }
      try {
        deps.onFire()
      } catch (error) {
        deps.onError('quota autopilot reset', error)
      }
    }, nextTimerDelay(deps.now(), fireAt))
  }

  return {
    arm(resetsAt: number | null): void {
      disarm()
      if (resetsAt !== null) schedule(resetFireAt(resetsAt))
    },
    disarm
  }
}
