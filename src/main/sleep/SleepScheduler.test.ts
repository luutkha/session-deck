import { describe, it, expect } from 'vitest'
import type { Id, RuntimeState, SleepSettings } from '../../shared/types'
import { CHECK_EVERY_MS, createSleepScheduler, type SleepScheduler, type SleepTimer } from './SleepScheduler'

interface Harness {
  readonly scheduler: SleepScheduler
  readonly slept: Id[]
  readonly errors: ReadonlyArray<readonly [string, unknown]>
  tick(): void
  intervalMs(): number
  startCount(): number
  clearCount(): number
  setNow(value: number): void
  setSettings(value: SleepSettings): void
  setSessions(value: ReadonlyArray<{ id: Id; closedAt?: number }>): void
  setRuntime(value: ReadonlyMap<Id, RuntimeState>): void
  setActive(id: Id | null): void
}

function runtimeRunning(ids: readonly Id[]): ReadonlyMap<Id, RuntimeState> {
  return new Map(
    ids.map((id) => [id, { sessionId: id, run: 'running' as const, exitCode: null, attention: null, activity: 'finished' as const }])
  )
}

function harness(): Harness {
  let time = 10_000
  let settings: SleepSettings = { enabled: true, afterMinutes: 1 }
  let sessions: ReadonlyArray<{ id: Id; closedAt?: number }> = []
  let runtime: ReadonlyMap<Id, RuntimeState> = new Map()
  let active: Id | null = null
  const slept: Id[] = []
  const errors: Array<readonly [string, unknown]> = []
  let callback: (() => void) | null = null
  let interval = 0
  let starts = 0
  let clears = 0

  const scheduler = createSleepScheduler({
    getSettings: () => settings,
    getSessions: () => sessions,
    getRuntime: () => runtime,
    getActiveSessionId: () => active,
    sleepSession: (id) => {
      slept.push(id)
    },
    now: () => time,
    onError: (where, error) => {
      errors.push([where, error])
    },
    setInterval: (cb, ms) => {
      callback = cb
      interval = ms
      starts++
      return 0 as unknown as SleepTimer
    },
    clearInterval: () => {
      clears++
    }
  })

  return {
    scheduler,
    slept,
    errors,
    tick: () => callback?.(),
    intervalMs: () => interval,
    startCount: () => starts,
    clearCount: () => clears,
    setNow: (value) => {
      time = value
    },
    setSettings: (value) => {
      settings = value
    },
    setSessions: (value) => {
      sessions = value
    },
    setRuntime: (value) => {
      runtime = value
    },
    setActive: (id) => {
      active = id
    }
  }
}

describe('createSleepScheduler', () => {
  it('starts a check every CHECK_EVERY_MS and stops it', () => {
    const h = harness()
    h.scheduler.start()
    expect(h.intervalMs()).toBe(CHECK_EVERY_MS)

    h.scheduler.stop()
    expect(h.clearCount()).toBe(1)
  })

  it('uses the injected checkEveryMs', () => {
    let interval = 0
    const scheduler = createSleepScheduler({
      getSettings: () => ({ enabled: false, afterMinutes: 1 }),
      getSessions: () => [],
      getRuntime: () => new Map(),
      getActiveSessionId: () => null,
      sleepSession: () => {},
      now: () => 0,
      onError: () => {},
      checkEveryMs: 5000,
      setInterval: (_cb, ms) => {
        interval = ms
        return 0 as unknown as SleepTimer
      },
      clearInterval: () => {}
    })
    scheduler.start()
    expect(interval).toBe(5000)
  })

  it('start is idempotent and stop before start is a no-op', () => {
    const h = harness()
    h.scheduler.stop()
    expect(h.clearCount()).toBe(0)

    h.scheduler.start()
    h.scheduler.start()
    expect(h.startCount()).toBe(1)
  })

  it('does not sleep everything on the first tick after start (fresh launch)', () => {
    const h = harness()
    h.setSessions([{ id: 'a' }, { id: 'b' }])
    h.setRuntime(runtimeRunning(['a', 'b']))

    h.scheduler.start()
    h.tick()

    expect(h.slept).toEqual([])
  })

  it('sleeps an idle session once the threshold has passed', () => {
    const h = harness()
    h.setSessions([{ id: 'a' }])
    h.setRuntime(runtimeRunning(['a']))
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.tick()

    expect(h.slept).toEqual(['a'])
  })

  it('touch restarts the idle countdown', () => {
    const h = harness()
    h.setSessions([{ id: 'a' }])
    h.setRuntime(runtimeRunning(['a']))
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.tick()
    expect(h.slept).toEqual(['a'])

    h.setNow(10_000 + 120_000)
    h.scheduler.touch('a')
    h.tick()
    expect(h.slept).toEqual(['a'])
  })

  it('forget drops the recorded touch so the session is not picked again', () => {
    const h = harness()
    h.setSessions([{ id: 'a' }])
    h.setRuntime(runtimeRunning(['a']))
    h.scheduler.start()
    h.scheduler.forget('a')

    h.setNow(10_000 + 60_000)
    h.tick()

    expect(h.slept).toEqual([])
  })

  it('does not sleep the active session', () => {
    const h = harness()
    h.setSessions([{ id: 'a' }])
    h.setRuntime(runtimeRunning(['a']))
    h.setActive('a')
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.tick()

    expect(h.slept).toEqual([])
  })

  it('does not read closed or non-running sessions', () => {
    const h = harness()
    h.setSessions([{ id: 'closed', closedAt: 5 }, { id: 'idle' }])
    h.setRuntime(new Map([['closed', { sessionId: 'closed', run: 'running', exitCode: null, attention: null }]]))
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.tick()

    expect(h.slept).toEqual([])
  })

  it('catches a failure while sleeping one session, reports it and continues with the others', () => {
    // A dedicated scheduler whose sleeper throws for the first id.
    let time = 10_000
    const slept: Id[] = []
    const errors: Array<readonly [string, unknown]> = []
    let callback: (() => void) | null = null
    const scheduler = createSleepScheduler({
      getSettings: () => ({ enabled: true, afterMinutes: 1 }),
      getSessions: () => [{ id: 'a' }, { id: 'b' }],
      getRuntime: () =>
        new Map([
          ['a', { sessionId: 'a', run: 'running', exitCode: null, attention: null, activity: 'finished' }],
          ['b', { sessionId: 'b', run: 'running', exitCode: null, attention: null, activity: 'finished' }]
        ]),
      getActiveSessionId: () => null,
      sleepSession: (id) => {
        if (id === 'a') throw new Error('boom')
        slept.push(id)
      },
      now: () => time,
      onError: (where, error) => errors.push([where, error]),
      setInterval: (cb) => {
        callback = cb
        return 0 as unknown as SleepTimer
      },
      clearInterval: () => {}
    })

    scheduler.start()
    time = 10_000 + 60_000
    expect(() => callback?.()).not.toThrow()

    expect(slept).toEqual(['b'])
    expect(errors[0]?.[0]).toBe('sleep session a')
  })

  it('reports a failure in the policy check without throwing out of the timer', () => {
    const errors: Array<readonly [string, unknown]> = []
    let callback: (() => void) | null = null
    const scheduler = createSleepScheduler({
      getSettings: () => {
        throw new Error('settings boom')
      },
      getSessions: () => [],
      getRuntime: () => new Map(),
      getActiveSessionId: () => null,
      sleepSession: () => {},
      now: () => 0,
      onError: (where, error) => errors.push([where, error]),
      setInterval: (cb) => {
        callback = cb
        return 0 as unknown as SleepTimer
      },
      clearInterval: () => {}
    })

    scheduler.start()
    expect(() => callback?.()).not.toThrow()
    expect(errors[0]?.[0]).toBe('sleep check')
  })
})
