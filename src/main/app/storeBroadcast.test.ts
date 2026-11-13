import { describe, expect, it } from 'vitest'
import { createCoalescedBroadcast } from './storeBroadcast'

const INTERVAL_MS = 40

interface ManualClock {
  readonly setTimer: (callback: () => void, milliseconds: number) => number
  readonly clearTimer: (handle: number) => void
  readonly pending: () => number
  /** Fires every timer due up to now + milliseconds, in due order, including timers scheduled while firing. */
  readonly advance: (milliseconds: number) => void
}

function createManualClock(): ManualClock {
  let now = 0
  let nextHandle = 1
  const timers = new Map<number, { readonly at: number; readonly callback: () => void }>()

  const setTimer = (callback: () => void, milliseconds: number): number => {
    const handle = nextHandle
    nextHandle += 1
    timers.set(handle, { at: now + milliseconds, callback })
    return handle
  }

  const clearTimer = (handle: number): void => {
    timers.delete(handle)
  }

  const advance = (milliseconds: number): void => {
    const target = now + milliseconds
    for (;;) {
      let next: { readonly id: number; readonly at: number; readonly callback: () => void } | null = null
      for (const [id, timer] of timers) {
        if (timer.at <= target && (next === null || timer.at < next.at)) {
          next = { id, at: timer.at, callback: timer.callback }
        }
      }
      if (next === null) break
      timers.delete(next.id)
      now = next.at
      next.callback()
    }
    now = target
  }

  return { setTimer, clearTimer, pending: () => timers.size, advance }
}

interface Harness {
  readonly notify: () => void
  readonly dispose: () => void
  readonly sends: string[]
  readonly clock: ManualClock
  readonly setLatest: (value: string) => void
}

function setup(): Harness {
  const clock = createManualClock()
  const sends: string[] = []
  let latest = 'v1'
  const broadcast = createCoalescedBroadcast<string, number>({
    send: (value) => {
      sends.push(value)
    },
    getLatest: () => latest,
    intervalMs: INTERVAL_MS,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  })
  return {
    notify: broadcast.notify,
    dispose: broadcast.dispose,
    sends,
    clock,
    setLatest: (value) => {
      latest = value
    }
  }
}

describe('createCoalescedBroadcast', () => {
  it('sends the first change at once', () => {
    const harness = setup()

    harness.notify()

    expect(harness.sends).toEqual(['v1'])
    expect(harness.clock.pending()).toBe(1)
  })

  it('coalesces changes inside the interval into one trailing send with the latest value', () => {
    const harness = setup()

    harness.notify()
    for (const value of ['v2', 'v3', 'v4', 'v5']) {
      harness.setLatest(value)
      harness.notify()
    }

    expect(harness.sends).toEqual(['v1'])
    harness.clock.advance(INTERVAL_MS - 1)
    expect(harness.sends).toEqual(['v1'])
    harness.clock.advance(1)
    expect(harness.sends).toEqual(['v1', 'v5'])
    expect(harness.clock.pending()).toBe(1)
  })

  it('does not send a trailing update when nothing changed during the interval', () => {
    const harness = setup()

    harness.notify()
    harness.clock.advance(INTERVAL_MS)

    expect(harness.sends).toEqual(['v1'])
    expect(harness.clock.pending()).toBe(0)
  })

  it('sends the state as it is when the timer fires, never the state at notify time', () => {
    const harness = setup()

    harness.notify()
    harness.clock.advance(INTERVAL_MS / 2)
    harness.notify()
    harness.setLatest('v9')
    expect(harness.sends).toEqual(['v1'])

    harness.clock.advance(INTERVAL_MS / 2)
    expect(harness.sends).toEqual(['v1', 'v9'])
  })

  it('keeps throttling while changes continue after a trailing send', () => {
    const harness = setup()

    harness.notify()
    harness.setLatest('v2')
    harness.notify()
    harness.clock.advance(INTERVAL_MS)
    expect(harness.sends).toEqual(['v1', 'v2'])

    harness.setLatest('v3')
    harness.notify()
    harness.setLatest('v4')
    harness.notify()
    expect(harness.sends).toEqual(['v1', 'v2'])
    harness.clock.advance(INTERVAL_MS)
    expect(harness.sends).toEqual(['v1', 'v2', 'v4'])
  })

  it('dispose cancels a pending trailing send and ignores later notifies', () => {
    const harness = setup()

    harness.notify()
    harness.setLatest('v2')
    harness.notify()
    harness.dispose()
    harness.clock.advance(INTERVAL_MS * 3)

    expect(harness.sends).toEqual(['v1'])
    expect(harness.clock.pending()).toBe(0)

    harness.setLatest('v3')
    harness.notify()
    expect(harness.sends).toEqual(['v1'])
    expect(harness.clock.pending()).toBe(0)
  })

  it('sends at once again after a quiet interval', () => {
    const harness = setup()

    harness.notify()
    harness.clock.advance(INTERVAL_MS)
    expect(harness.clock.pending()).toBe(0)

    harness.setLatest('v2')
    harness.notify()
    expect(harness.sends).toEqual(['v1', 'v2'])
  })
})
