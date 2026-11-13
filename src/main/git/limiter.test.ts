import { describe, expect, it } from 'vitest'
import { createLimiter, mapLimit } from './limiter'

/** A task that stays pending until released, and records the peak number of tasks running at once. */
function gate() {
  let running = 0
  let peak = 0
  const releases: Array<() => void> = []
  const task = <T>(value: T) => (): Promise<T> => {
    running += 1
    peak = Math.max(peak, running)
    return new Promise<T>((resolve) => {
      releases.push(() => { running -= 1; resolve(value) })
    })
  }
  return { task, releases, peak: () => peak, running: () => running }
}
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLimiter', () => {
  it('runs at most max tasks at once and starts the rest in order as slots free up', async () => {
    const limit = createLimiter(2)
    const g = gate()
    const order: number[] = []
    const results = [1, 2, 3, 4, 5].map((n) => limit(g.task(n)).then((value) => { order.push(value); return value }))
    await tick()
    expect(g.running()).toBe(2)
    g.releases.shift()?.()
    await tick()
    expect(g.running()).toBe(2)
    while (g.releases.length > 0) {
      g.releases.shift()?.()
      await tick()
    }
    expect(await Promise.all(results)).toEqual([1, 2, 3, 4, 5])
    expect(g.peak()).toBe(2)
    expect(order).toEqual([1, 2, 3, 4, 5])
  })

  it('frees the slot when a task rejects or throws synchronously', async () => {
    const limit = createLimiter(1)
    const failed = limit(() => Promise.reject(new Error('boom')))
    const threw = limit(() => { throw new Error('sync') })
    const fine = limit(() => Promise.resolve('ok'))
    await expect(failed).rejects.toThrow('boom')
    await expect(threw).rejects.toThrow('sync')
    await expect(fine).resolves.toBe('ok')
  })

  it('rejects an invalid max', () => {
    expect(() => createLimiter(0)).toThrow(RangeError)
    expect(() => createLimiter(1.5)).toThrow(RangeError)
  })
})

describe('mapLimit', () => {
  it('keeps the input order and never exceeds the limit', async () => {
    const g = gate()
    const done = mapLimit([1, 2, 3, 4, 5, 6], 3, (n) => g.task(n * 10)())
    await tick()
    expect(g.running()).toBe(3)
    while (g.releases.length > 0) {
      g.releases.shift()?.()
      await tick()
    }
    expect(await done).toEqual([10, 20, 30, 40, 50, 60])
    expect(g.peak()).toBe(3)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 2, (n: number) => Promise.resolve(n))).toEqual([])
  })
})
