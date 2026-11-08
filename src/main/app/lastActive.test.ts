import { describe, expect, it } from 'vitest'
import type { RuntimeState } from '../../shared/types'
import { createLastActiveTracker } from './lastActive'

function setup(throttleMs = 1000) {
  let clock = 10_000
  const writes: Array<[string, number]> = []
  const timers: Array<{ cb: () => void; at: number; cleared: boolean }> = []
  const tracker = createLastActiveTracker({
    now: () => clock,
    write: (id, at) => writes.push([id, at]),
    setTimeout: (cb, ms) => {
      const timer = { cb, at: clock + ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      (timer as { cleared: boolean }).cleared = true
    },
    throttleMs
  })
  const advance = (ms: number): void => {
    clock += ms
    for (const timer of timers) {
      if (!timer.cleared && timer.at <= clock) {
        timer.cleared = true
        timer.cb()
      }
    }
  }
  return { tracker, writes, advance, timers }
}

function runtime(sessionId: string, activity: RuntimeState['activity'], activityAt?: number): RuntimeState {
  return { sessionId, run: 'running', exitCode: null, attention: null, activity, ...(activityAt !== undefined ? { activityAt } : {}) }
}

describe('createLastActiveTracker (D61)', () => {
  it('writes the first touch at once', () => {
    const { tracker, writes } = setup()
    tracker.touch('a')
    expect(writes).toEqual([['a', 10_000]])
  })

  it('folds touches inside the window into one trailing write with the latest time', () => {
    const { tracker, writes, advance } = setup(1000)
    tracker.touch('a')
    advance(200)
    tracker.touch('a')
    advance(300)
    tracker.touch('a')
    expect(writes).toHaveLength(1)
    advance(500)
    expect(writes).toEqual([['a', 10_000], ['a', 10_500]])
  })

  it('writes at once again after the window passed', () => {
    const { tracker, writes, advance } = setup(1000)
    tracker.touch('a')
    advance(1500)
    tracker.touch('a')
    expect(writes).toEqual([['a', 10_000], ['a', 11_500]])
  })

  it('throttles each session on its own', () => {
    const { tracker, writes } = setup(1000)
    tracker.touch('a')
    tracker.touch('b')
    expect(writes.map(([id]) => id)).toEqual(['a', 'b'])
  })

  it('counts working and finished activity once per activity change, not the idle reminder', () => {
    const { tracker, writes, advance } = setup(10)
    tracker.onRuntime(runtime('a', 'working', 1))
    advance(50)
    tracker.onRuntime(runtime('a', 'working', 1)) // same change re-emitted (another runtime field changed)
    tracker.onRuntime(runtime('b', 'needs-input', 2))
    tracker.onRuntime(runtime('c', null))
    expect(writes.map(([id]) => id)).toEqual(['a'])
    tracker.onRuntime(runtime('a', 'finished', 3))
    expect(writes.map(([id]) => id)).toEqual(['a', 'a'])
  })

  it('counts typed input only when it submits a line', () => {
    const { tracker, writes } = setup()
    tracker.onUserInput('a', 'hel')
    tracker.onUserInput('a', '\x1b[I')
    expect(writes).toEqual([])
    tracker.onUserInput('a', 'lo\r')
    expect(writes).toEqual([['a', 10_000]])
  })

  it('flush writes the pending value and clears the timer', () => {
    const { tracker, writes, advance, timers } = setup(1000)
    tracker.touch('a')
    advance(100)
    tracker.touch('a')
    tracker.flush()
    expect(writes).toEqual([['a', 10_000], ['a', 10_100]])
    expect(timers.every((timer) => timer.cleared)).toBe(true)
  })
})
