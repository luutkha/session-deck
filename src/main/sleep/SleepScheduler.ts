import type { Id, RuntimeState, SleepSettings } from '../../shared/types'
import { pickSessionsToSleep } from './sleepPolicy'

/** Opaque interval handle; the real one is Node's Timeout. */
export type SleepTimer = ReturnType<typeof setInterval>

export type SleepSetInterval = (callback: () => void, ms: number) => SleepTimer
export type SleepClearInterval = (handle: SleepTimer) => void

/** The store's Session is assignable to this shape. */
export interface SleepSchedulerSession {
  readonly id: Id
  readonly closedAt?: number
  readonly keepAwake?: boolean
}

export interface SleepSchedulerDeps {
  readonly getSettings: () => SleepSettings
  readonly getSessions: () => readonly SleepSchedulerSession[]
  readonly getRuntime: () => ReadonlyMap<Id, RuntimeState>
  readonly getActiveSessionId: () => Id | null
  /** Puts one session to sleep; never expected to touch the scheduler's own state. */
  readonly sleepSession: (id: Id) => void
  readonly now: () => number
  /** Records a failure. The scheduler never throws out of its timer. */
  readonly onError: (where: string, error: unknown) => void
  /** How often the idle check runs. Defaults to CHECK_EVERY_MS. */
  readonly checkEveryMs?: number
  readonly setInterval?: SleepSetInterval
  readonly clearInterval?: SleepClearInterval
}

export interface SleepScheduler {
  /** Records "last touched now" for a session (pty input, pty output or an activity change). */
  touch(id: Id): void
  /** Drops the recorded touch of a session (e.g. it was removed). */
  forget(id: Id): void
  start(): void
  stop(): void
}

export const CHECK_EVERY_MS = 30_000

/**
 * Runs the idle-sleep check on a fixed interval. `lastTouchAt` starts at "now" for every open session, so a freshly
 * launched app does not sleep everything on its first tick. Failures are reported through `onError`, never thrown.
 */
export function createSleepScheduler(deps: SleepSchedulerDeps): SleepScheduler {
  const {
    getSettings,
    getSessions,
    getRuntime,
    getActiveSessionId,
    sleepSession,
    now,
    onError,
    checkEveryMs = CHECK_EVERY_MS,
    setInterval: setIntervalFn = (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: clearIntervalFn = (handle) => globalThis.clearInterval(handle)
  } = deps

  const lastTouchAt = new Map<Id, number>()
  let timer: SleepTimer | null = null
  let started = false

  function check(): void {
    let ids: readonly Id[]
    try {
      ids = pickSessionsToSleep({
        nowMs: now(),
        settings: getSettings(),
        activeSessionId: getActiveSessionId(),
        sessions: getSessions().map((s) => ({ id: s.id, closed: s.closedAt !== undefined, keepAwake: s.keepAwake === true })),
        runtime: getRuntime(),
        lastTouchAt
      })
    } catch (error) {
      onError('sleep check', error)
      return
    }

    for (const id of ids) {
      try {
        sleepSession(id)
        lastTouchAt.delete(id)
      } catch (error) {
        onError(`sleep session ${id}`, error)
      }
    }
  }

  function tick(): void {
    try {
      check()
    } catch (error) {
      onError('sleep tick', error)
    }
  }

  return {
    touch(id: Id): void {
      lastTouchAt.set(id, now())
    },

    forget(id: Id): void {
      lastTouchAt.delete(id)
    },

    start(): void {
      if (started) return
      started = true
      const at = now()
      for (const session of getSessions()) {
        if (session.closedAt === undefined) {
          lastTouchAt.set(session.id, at)
        }
      }
      timer = setIntervalFn(tick, checkEveryMs)
    },

    stop(): void {
      if (!started) return
      started = false
      if (timer !== null) {
        clearIntervalFn(timer)
        timer = null
      }
    }
  }
}
