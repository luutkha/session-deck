import { describe, expect, it } from 'vitest'
import { createClock, type ClockDeps } from './useClock'

/** A fake timer world: `advance` runs every interval created by the clock once. */
function fakeDeps(): ClockDeps & { advance(ms: number): void; intervals(): number } {
  let now = 1_000_000
  let nextId = 1
  const timers = new Map<number, { handler: () => void; ms: number }>()
  return {
    now: (): number => now,
    setInterval: (handler: () => void, ms: number): number => {
      const id = nextId++
      timers.set(id, { handler, ms })
      return id
    },
    clearInterval: (id: number): void => {
      timers.delete(id)
    },
    advance: (ms: number): void => {
      now += ms
      for (const timer of [...timers.values()]) timer.handler()
    },
    intervals: (): number => timers.size
  }
}

describe('createClock', () => {
  it('starts one interval for the first subscriber and stops it when the last leaves', () => {
    const deps = fakeDeps()
    const clock = createClock(30_000, deps)
    const offA = clock.subscribe((): void => undefined)
    expect(deps.intervals()).toBe(1)
    const offB = clock.subscribe((): void => undefined)
    expect(deps.intervals()).toBe(1)
    offA()
    expect(deps.intervals()).toBe(1)
    offB()
    expect(deps.intervals()).toBe(0)
  })

  it('notifies every subscriber once per tick and keeps one snapshot for all', () => {
    const deps = fakeDeps()
    const clock = createClock(30_000, deps)
    let a = 0
    let b = 0
    const offA = clock.subscribe((): void => { a += 1 })
    const offB = clock.subscribe((): void => { b += 1 })
    deps.advance(30_000)
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(clock.getSnapshot()).toBe(1_030_000)
    offA()
    offB()
  })

  it('refreshes the snapshot when a new subscriber joins a stopped clock', () => {
    const deps = fakeDeps()
    const clock = createClock(30_000, deps)
    const off = clock.subscribe((): void => undefined)
    off()
    deps.advance(5_000)
    expect(clock.getSnapshot()).toBe(1_000_000)
    const offAgain = clock.subscribe((): void => undefined)
    expect(clock.getSnapshot()).toBe(1_005_000)
    offAgain()
  })

  it('does not tick after the last subscriber left', () => {
    const deps = fakeDeps()
    const clock = createClock(30_000, deps)
    let calls = 0
    const off = clock.subscribe((): void => { calls += 1 })
    deps.advance(30_000)
    off()
    deps.advance(30_000)
    expect(calls).toBe(1)
    expect(clock.getSnapshot()).toBe(1_030_000)
  })

  it('uses the requested period', () => {
    const deps = fakeDeps()
    const clock = createClock(1_000, deps)
    const seen: number[] = []
    const off = clock.subscribe((): void => {
      seen.push(clock.getSnapshot())
    })
    deps.advance(1_000)
    deps.advance(1_000)
    expect(seen).toEqual([1_001_000, 1_002_000])
    off()
  })
})
