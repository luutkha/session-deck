import { describe, expect, it } from 'vitest'
import { createDebouncedSaver, type DebounceTimers, type DebouncedSaver } from './debounce'

interface FakeTimers {
  readonly timers: DebounceTimers
  /** Fires every pending timer synchronously and clears it. */
  fireAll: () => void
  /** Number of pending timers. */
  pending: () => number
}

function makeFakeTimers(): FakeTimers {
  let nextId = 1
  const handlers = new Map<number, () => void>()
  return {
    timers: {
      setTimeout: (handler: () => void, _ms: number): number => {
        const id = nextId++
        handlers.set(id, handler)
        return id
      },
      clearTimeout: (handle: number): void => {
        handlers.delete(handle)
      }
    } as DebounceTimers,
    fireAll: (): void => {
      for (const handler of [...handlers.values()]) {
        handler()
      }
      handlers.clear()
    },
    pending: (): number => handlers.size
  }
}

function collectFired(): { fired: string[]; timers: FakeTimers; saver: DebouncedSaver<string> } {
  const timers = makeFakeTimers()
  const fired: string[] = []
  const saver = createDebouncedSaver<string>(600, (value: string): void => {
    fired.push(value)
  }, timers.timers)
  return { fired, timers, saver }
}

describe('createDebouncedSaver', () => {
  it('does nothing before the delay elapses', () => {
    const { fired, saver } = collectFired()
    saver.schedule('hello')
    expect(fired).toEqual([])
  })

  it('fires the latest scheduled value once the timer elapses', () => {
    const { fired, timers, saver } = collectFired()
    saver.schedule('a')
    timers.fireAll()
    expect(fired).toEqual(['a'])
  })

  it('keeps only the most recent value across multiple schedules', () => {
    const { fired, timers, saver } = collectFired()
    saver.schedule('a')
    saver.schedule('b')
    saver.schedule('c')
    expect(timers.pending()).toBe(1)
    timers.fireAll()
    expect(fired).toEqual(['c'])
  })

  it('schedules again after the timer fired', () => {
    const { fired, timers, saver } = collectFired()
    saver.schedule('a')
    timers.fireAll()
    saver.schedule('b')
    timers.fireAll()
    expect(fired).toEqual(['a', 'b'])
  })

  it('flush fires the pending value immediately and returns it', () => {
    const { fired, timers, saver } = collectFired()
    saver.schedule('hello')
    const value = saver.flush()
    expect(value).toBe('hello')
    expect(fired).toEqual(['hello'])
    expect(timers.pending()).toBe(0)
  })

  it('flush with nothing pending does not fire and returns null', () => {
    const { fired, saver } = collectFired()
    expect(saver.flush()).toBeNull()
    expect(fired).toEqual([])
  })

  it('flush after the timer already fired does not double-fire', () => {
    const { fired, timers, saver } = collectFired()
    saver.schedule('a')
    timers.fireAll()
    expect(saver.flush()).toBeNull()
    expect(fired).toEqual(['a'])
  })

  it('cancel drops the pending value and the timer', () => {
    const { fired, timers, saver } = collectFired()
    saver.schedule('a')
    saver.cancel()
    timers.fireAll()
    expect(fired).toEqual([])
    expect(saver.hasPending()).toBe(false)
  })

  it('hasPending reflects whether a value is queued', () => {
    const { timers, saver } = collectFired()
    expect(saver.hasPending()).toBe(false)
    saver.schedule('a')
    expect(saver.hasPending()).toBe(true)
    timers.fireAll()
    expect(saver.hasPending()).toBe(false)
  })
})