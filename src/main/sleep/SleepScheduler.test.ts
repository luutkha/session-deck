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
  setOnScreen(ids: readonly Id[]): void
}

function runtimeRunning(ids: readonly Id[]): ReadonlyMap<Id, RuntimeState> {
  return new Map(
    ids.map((id) => [id, { sessionId: id, run: 'running' as const, exitCode: null, attention: null, activity: 'finished' as const }])
  )
}

function harness(): Harness {
  let time = 10_000
  let settings: SleepSettings = { enabled: true, afterMinutes: 1, allEnabled: false, allAfterMinutes: 60 }
  let sessions: ReadonlyArray<{ id: Id; closedAt?: number }> = []
  let runtime: ReadonlyMap<Id, RuntimeState> = new Map()
  let onScreen: Id[] = []
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
    getOnScreenSessionIds: () => new Set(onScreen),
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
      onScreen = id === null ? [] : [id]
    },
    setOnScreen: (ids) => {
      onScreen = [...ids]
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
      getSettings: () => ({ enabled: false, afterMinutes: 1, allEnabled: false, allAfterMinutes: 60 }),
      getSessions: () => [],
      getRuntime: () => new Map(),
      getOnScreenSessionIds: () => new Set(),
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

  it('does not sleep the sessions visible in either window', () => {
    const h = harness()
    h.setSessions([{ id: 'main' }, { id: 'code' }, { id: 'idle' }])
    h.setRuntime(runtimeRunning(['main', 'code', 'idle']))
    h.setOnScreen(['main', 'code'])
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.tick()

    expect(h.slept).toEqual(['idle'])
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
      getSettings: () => ({ enabled: true, afterMinutes: 1, allEnabled: false, allAfterMinutes: 60 }),
      getSessions: () => [{ id: 'a' }, { id: 'b' }],
      getRuntime: () =>
        new Map([
          ['a', { sessionId: 'a', run: 'running', exitCode: null, attention: null, activity: 'finished' }],
          ['b', { sessionId: 'b', run: 'running', exitCode: null, attention: null, activity: 'finished' }]
        ]),
      getOnScreenSessionIds: () => new Set(),
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

  it('does not sleep everything on the first tick after a fresh start (app-wide rule)', () => {
    const h = harness()
    h.setSettings({ enabled: false, afterMinutes: 1, allEnabled: true, allAfterMinutes: 1 })
    h.setSessions([{ id: 'a' }, { id: 'b' }])
    h.setRuntime(runtimeRunning(['a', 'b']))
    h.scheduler.start()

    h.tick()

    expect(h.slept).toEqual([])
  })

  it('sleeps everything once the whole app has been idle for allAfterMinutes', () => {
    const h = harness()
    h.setSettings({ enabled: false, afterMinutes: 1, allEnabled: true, allAfterMinutes: 1 })
    h.setSessions([{ id: 'a' }, { id: 'b' }])
    h.setRuntime(runtimeRunning(['a', 'b']))
    h.setActive('a')
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.tick()

    expect(h.slept).toEqual(['a', 'b'])
  })

  it('noteUserInput postpones the app-wide sleep', () => {
    const h = harness()
    h.setSettings({ enabled: false, afterMinutes: 1, allEnabled: true, allAfterMinutes: 1 })
    h.setSessions([{ id: 'a' }])
    h.setRuntime(runtimeRunning(['a']))
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.scheduler.noteUserInput()
    h.tick()
    expect(h.slept).toEqual([])

    h.setNow(10_000 + 120_000)
    h.tick()
    expect(h.slept).toEqual(['a'])
  })

  it('sleeps a session picked by both rules only once', () => {
    const h = harness()
    h.setSettings({ enabled: true, afterMinutes: 1, allEnabled: true, allAfterMinutes: 1 })
    h.setSessions([{ id: 'a' }])
    h.setRuntime(runtimeRunning(['a']))
    h.scheduler.start()

    h.setNow(10_000 + 60_000)
    h.tick()

    expect(h.slept).toEqual(['a'])
  })

  it('a failing sleepSession for one session still sleeps the others (app-wide rule)', () => {
    let time = 10_000
    const slept: Id[] = []
    const errors: Array<readonly [string, unknown]> = []
    let callback: (() => void) | null = null
    const scheduler = createSleepScheduler({
      getSettings: () => ({ enabled: false, afterMinutes: 1, allEnabled: true, allAfterMinutes: 1 }),
      getSessions: () => [{ id: 'a' }, { id: 'b' }],
      getRuntime: () => runtimeRunning(['a', 'b']),
      getOnScreenSessionIds: () => new Set(),
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

  it('a failing app-wide check is reported and the per-session rule still sleeps', () => {
    let time = 10_000
    const slept: Id[] = []
    const errors: Array<readonly [string, unknown]> = []
    let callback: (() => void) | null = null
    const scheduler = createSleepScheduler({
      getSettings: () => ({
        enabled: true,
        afterMinutes: 1,
        allEnabled: true,
        get allAfterMinutes(): number {
          throw new Error('all boom')
        }
      }),
      getSessions: () => [{ id: 'a' }],
      getRuntime: () => runtimeRunning(['a']),
      getOnScreenSessionIds: () => new Set(),
      sleepSession: (id) => {
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

    expect(slept).toEqual(['a'])
    expect(errors[0]?.[0]).toBe('sleep-all check')
  })

  it('a failing per-session check is reported and the app-wide rule still sleeps', () => {
    let time = 10_000
    const slept: Id[] = []
    const errors: Array<readonly [string, unknown]> = []
    let callback: (() => void) | null = null
    const scheduler = createSleepScheduler({
      getSettings: () => ({
        enabled: true,
        get afterMinutes(): number {
          throw new Error('per-session boom')
        },
        allEnabled: true,
        allAfterMinutes: 1
      }),
      getSessions: () => [{ id: 'a' }],
      getRuntime: () => runtimeRunning(['a']),
      getOnScreenSessionIds: () => new Set(),
      sleepSession: (id) => {
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

    expect(slept).toEqual(['a'])
    expect(errors[0]?.[0]).toBe('sleep check')
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
      getOnScreenSessionIds: () => new Set(),
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
