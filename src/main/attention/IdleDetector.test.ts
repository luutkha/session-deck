import { describe, it, expect, beforeEach } from 'vitest'
import { createIdleDetector, type IdleDetectorTimers } from './IdleDetector'

describe('IdleDetector', () => {
  let idleCalls: string[] = []
  let scheduledTimers: Array<{ handle: number; fn: () => void; ms: number }> = []
  let handleCounter = 0

  function createFakeTimers(): IdleDetectorTimers {
    scheduledTimers = []
    handleCounter = 0
    return {
      set: (fn, ms) => {
        const handle = ++handleCounter
        scheduledTimers.push({ handle, fn, ms })
        return handle
      },
      clear: (handle) => {
        scheduledTimers = scheduledTimers.filter((t) => t.handle !== handle)
      }
    }
  }

  function fireTimer(handle: number): void {
    const timer = scheduledTimers.find((t) => t.handle === handle)
    if (timer) {
      timer.fn()
      scheduledTimers = scheduledTimers.filter((t) => t.handle !== handle)
    }
  }

  function getPendingTimerCount(): number {
    return scheduledTimers.length
  }

  beforeEach(() => {
    idleCalls = []
  })

  it('fires onIdle once after idleMs of no output', () => {
    const timers = createFakeTimers()
    const detector = createIdleDetector({
      idleMs: 100,
      onIdle: (id) => idleCalls.push(id),
      timers
    })

    detector.noteOutput('session-1')
    expect(idleCalls).toHaveLength(0)
    expect(getPendingTimerCount()).toBe(1)

    fireTimer(scheduledTimers[0].handle)
    expect(idleCalls).toHaveLength(1)
    expect(idleCalls[0]).toBe('session-1')
    expect(getPendingTimerCount()).toBe(0)
  })

  it('does not fire again until new output arrives', () => {
    const timers = createFakeTimers()
    const detector = createIdleDetector({
      idleMs: 100,
      onIdle: (id) => idleCalls.push(id),
      timers
    })

    detector.noteOutput('session-1')
    fireTimer(scheduledTimers[0].handle)
    expect(idleCalls).toHaveLength(1)

    // Fire again without new output - should not fire
    // (no timer scheduled)
    expect(getPendingTimerCount()).toBe(0)

    // New output schedules new timer
    detector.noteOutput('session-1')
    expect(getPendingTimerCount()).toBe(1)
    fireTimer(scheduledTimers[0].handle)
    expect(idleCalls).toHaveLength(2)
  })

  it('noteInput cancels pending idle', () => {
    const timers = createFakeTimers()
    const detector = createIdleDetector({
      idleMs: 100,
      onIdle: (id) => idleCalls.push(id),
      timers
    })

    detector.noteOutput('session-1')
    expect(getPendingTimerCount()).toBe(1)

    detector.noteInput('session-1')
    expect(getPendingTimerCount()).toBe(0)

    // Timer should not fire
    // (already cleared)
    expect(idleCalls).toHaveLength(0)
  })

  it('forget cleans up session state', () => {
    const timers = createFakeTimers()
    const detector = createIdleDetector({
      idleMs: 100,
      onIdle: (id) => idleCalls.push(id),
      timers
    })

    detector.noteOutput('session-1')
    expect(getPendingTimerCount()).toBe(1)

    detector.forget('session-1')
    expect(getPendingTimerCount()).toBe(0)
    expect(idleCalls).toHaveLength(0)
  })

  it('uses default timers when not provided', () => {
    const detector = createIdleDetector({
      idleMs: 100,
      onIdle: (id) => idleCalls.push(id)
    })

    detector.noteOutput('session-1')
    detector.forget('session-1')
    // Should not throw
  })

  it('custom idleMs is passed to timer', () => {
    const timers = createFakeTimers()
    const detector = createIdleDetector({
      idleMs: 5000,
      onIdle: (id) => idleCalls.push(id),
      timers
    })

    detector.noteOutput('session-1')
    expect(scheduledTimers[0].ms).toBe(5000)
  })

  it('multiple sessions tracked independently', () => {
    const timers = createFakeTimers()
    const detector = createIdleDetector({
      idleMs: 100,
      onIdle: (id) => idleCalls.push(id),
      timers
    })

    detector.noteOutput('session-1')
    detector.noteOutput('session-2')
    expect(getPendingTimerCount()).toBe(2)

    fireTimer(scheduledTimers[0].handle)
    expect(idleCalls).toHaveLength(1)
    expect(idleCalls[0]).toBe('session-1')

    fireTimer(scheduledTimers[0].handle) // now session-2's timer
    expect(idleCalls).toHaveLength(2)
    expect(idleCalls[1]).toBe('session-2')
  })

  it('noteOutput after noteInput schedules new timer', () => {
    const timers = createFakeTimers()
    const detector = createIdleDetector({
      idleMs: 100,
      onIdle: (id) => idleCalls.push(id),
      timers
    })

    detector.noteOutput('session-1')
    detector.noteInput('session-1')
    detector.noteOutput('session-1')
    expect(getPendingTimerCount()).toBe(1)

    fireTimer(scheduledTimers[0].handle)
    expect(idleCalls).toHaveLength(1)
  })
})