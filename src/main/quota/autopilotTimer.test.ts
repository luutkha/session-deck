import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createResetTimer } from './autopilotTimer'
import { MAX_TIMEOUT_MS, RESET_GRACE_MS } from './autopilotPolicy'

const NOW_MS = 1_700_000_000_000
const NOW_SEC = NOW_MS / 1000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
})

afterEach(() => {
  vi.useRealTimers()
})

function makeTimer(onFire = vi.fn(), onError = vi.fn()) {
  const timer = createResetTimer({
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle),
    onFire,
    onError
  })
  return { timer, onFire, onError }
}

describe('createResetTimer', () => {
  it('fires once, RESET_GRACE_MS after the reset time', () => {
    const { timer, onFire } = makeTimer()
    timer.arm(NOW_SEC + 60)
    vi.advanceTimersByTime(60_000 + RESET_GRACE_MS - 1)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3_600_000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('fires right away when the reset time has already passed', () => {
    const { timer, onFire } = makeTimer()
    timer.arm(NOW_SEC - 120)
    vi.advanceTimersByTime(0)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('waits longer than the timer maximum by chunking the delay', () => {
    const { timer, onFire } = makeTimer()
    const waitMs = MAX_TIMEOUT_MS * 2
    timer.arm(NOW_SEC + waitMs / 1000)
    vi.advanceTimersByTime(MAX_TIMEOUT_MS + 1000)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(waitMs)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('cancels the pending fire on disarm', () => {
    const { timer, onFire } = makeTimer()
    timer.arm(NOW_SEC + 60)
    timer.disarm()
    vi.advanceTimersByTime(3_600_000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does nothing when armed with no reset time', () => {
    const { timer, onFire } = makeTimer()
    timer.arm(null)
    vi.advanceTimersByTime(3_600_000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('replaces an earlier schedule when armed again', () => {
    const { timer, onFire } = makeTimer()
    timer.arm(NOW_SEC + 60)
    timer.arm(NOW_SEC + 600)
    vi.advanceTimersByTime(120_000)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600_000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('reports a failing fire callback instead of throwing out of the timer', () => {
    const boom = new Error('deliver failed')
    const { timer, onError } = makeTimer(vi.fn(() => { throw boom }))
    timer.arm(NOW_SEC - 10)
    expect(() => vi.advanceTimersByTime(0)).not.toThrow()
    expect(onError).toHaveBeenCalledWith('quota autopilot reset', boom)
  })
})
