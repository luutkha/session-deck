import { describe, it, expect } from 'vitest'
import type { AttentionReason, RuntimeState } from '../../shared/types'
import { relativeTime, activityLabel, activityDetail, isSleeping } from './formatTime'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('returns "now" for very recent changes (<45s)', () => {
    expect(relativeTime(1000, 1000)).toBe('now')
    expect(relativeTime(10000, 0)).toBe('now')
    expect(relativeTime(45000, 1000)).toBe('now')
  })

  it('rounds to minutes under an hour', () => {
    expect(relativeTime(MINUTE * 5, 0)).toBe('5m')
    expect(relativeTime(MINUTE * 5 + MINUTE / 2, 0)).toBe('6m')
    expect(relativeTime(HOUR - MINUTE, 0)).toBe('59m')
  })

  it('clamps single-minute deltas to at least 1m', () => {
    expect(relativeTime(MINUTE, 0)).toBe('1m')
  })

  it('rounds to hours under a day', () => {
    expect(relativeTime(HOUR * 2, 0)).toBe('2h')
    expect(relativeTime(HOUR * 23, 0)).toBe('23h')
  })

  it('clamps single-hour deltas to at least 1h', () => {
    expect(relativeTime(HOUR + MINUTE, 0)).toBe('1h')
  })

  it('rounds to days for very old changes', () => {
    expect(relativeTime(DAY * 3, 0)).toBe('3d')
    expect(relativeTime(DAY * 365, 0)).toBe('365d')
  })

  it('clamps single-day deltas to at least 1d', () => {
    expect(relativeTime(DAY + HOUR, 0)).toBe('1d')
  })

  it('treats a negative delta as "now" (clock skew safety)', () => {
    expect(relativeTime(0, 1000)).toBe('now')
  })

  it('returns "" for non-finite inputs', () => {
    expect(relativeTime(Number.NaN, 0)).toBe('')
    expect(relativeTime(0, Number.NaN)).toBe('')
  })
})

describe('activityLabel', () => {
  function runtime(overrides: Partial<RuntimeState> = {}): RuntimeState {
    return {
      sessionId: 's1',
      run: 'running',
      exitCode: null,
      attention: null,
      ...overrides
    }
  }

  it('reports "Running" when run is running and no attention', () => {
    expect(activityLabel(runtime({ run: 'running' }))).toBe('Running')
  })

  it('reports "Exited" when run is exited with no code', () => {
    expect(activityLabel(runtime({ run: 'exited', exitCode: null }))).toBe('Exited')
  })

  it('includes non-zero exit code', () => {
    expect(activityLabel(runtime({ run: 'exited', exitCode: 1 }))).toBe('Exited (1)')
  })

  it('reports "Exited" when the exit code is zero', () => {
    expect(activityLabel(runtime({ run: 'exited', exitCode: 0 }))).toBe('Exited')
  })

  it('returns attention label for permission', () => {
    expect(activityLabel(runtime({ attention: 'permission' }))).toBe('Needs permission')
  })

  it('returns attention label for done', () => {
    expect(activityLabel(runtime({ attention: 'done' }))).toBe('Finished')
  })

  it('returns attention label for idle', () => {
    expect(activityLabel(runtime({ attention: 'idle' }))).toBe('Waiting for you')
  })

  it('returns attention label for bell', () => {
    expect(activityLabel(runtime({ attention: 'bell' }))).toBe('Needs attention')
  })

  it('attention takes precedence over run state', () => {
    const reasons: readonly AttentionReason[] = ['permission', 'done', 'idle', 'bell']
    for (const reason of reasons) {
      const label = activityLabel(runtime({ run: 'exited', exitCode: 1, attention: reason }))
      expect(label).not.toBe('Exited (1)')
    }
  })

  it('returns "Exited" when runtime is undefined', () => {
    expect(activityLabel(undefined)).toBe('Exited')
  })

  it('maps hook activity when the run is not exited', () => {
    expect(activityLabel(runtime({ activity: 'working' }))).toBe('Working')
    expect(activityLabel(runtime({ activity: 'finished' }))).toBe('Finished')
  })

  it('reports "Needs permission" for needs-input with a permission reason', () => {
    expect(activityLabel(runtime({ activity: 'needs-input', attention: 'permission' }))).toBe(
      'Needs permission'
    )
  })

  it('reports "Needs input" for needs-input without a permission reason', () => {
    expect(activityLabel(runtime({ activity: 'needs-input', attention: null }))).toBe('Needs input')
    expect(activityLabel(runtime({ activity: 'needs-input', attention: 'idle' }))).toBe('Needs input')
  })

  it('lets an exited run win over a stale activity', () => {
    expect(activityLabel(runtime({ run: 'exited', exitCode: null, activity: 'working' }))).toBe('Exited')
    expect(activityLabel(runtime({ run: 'exited', exitCode: 2, activity: 'needs-input' }))).toBe('Exited (2)')
  })

  it('ignores activity when the hook reported none', () => {
    expect(activityLabel(runtime({ activity: null, run: 'running' }))).toBe('Running')
  })

  it('reports "Sleeping" and wins over "Exited"', () => {
    expect(activityLabel(runtime({ sleeping: true, run: 'running' }))).toBe('Sleeping')
    expect(activityLabel(runtime({ sleeping: true, run: 'exited', exitCode: 1 }))).toBe('Sleeping')
  })

  it('lets sleeping win over any stale activity or attention', () => {
    expect(activityLabel(runtime({ sleeping: true, activity: 'working', attention: 'permission' }))).toBe(
      'Sleeping'
    )
  })
})

describe('isSleeping', () => {
  function runtime(overrides: Partial<RuntimeState> = {}): RuntimeState {
    return {
      sessionId: 's1',
      run: 'running',
      exitCode: null,
      attention: null,
      ...overrides
    }
  }

  it('is true only when runtime.sleeping is true', () => {
    expect(isSleeping(runtime({ sleeping: true }))).toBe(true)
    expect(isSleeping(runtime({ sleeping: false }))).toBe(false)
    expect(isSleeping(runtime())).toBe(false)
  })

  it('is false without runtime data', () => {
    expect(isSleeping(undefined)).toBe(false)
  })
})

describe('activityDetail', () => {
  function runtime(overrides: Partial<RuntimeState> = {}): RuntimeState {
    return {
      sessionId: 's1',
      run: 'running',
      exitCode: null,
      attention: null,
      ...overrides
    }
  }

  it('returns null when there is no runtime or no needs-input activity', () => {
    expect(activityDetail(undefined)).toBeNull()
    expect(activityDetail(runtime({ activity: 'working', activityMessage: 'x' }))).toBeNull()
    expect(activityDetail(runtime({ activity: 'finished', activityMessage: 'x' }))).toBeNull()
    expect(activityDetail(runtime({ activity: null, activityMessage: 'x' }))).toBeNull()
  })

  it('returns the trimmed message for needs-input', () => {
    expect(activityDetail(runtime({ activity: 'needs-input', activityMessage: '  Allow Bash?  ' }))).toBe(
      'Allow Bash?'
    )
  })

  it('returns null for a missing or blank message', () => {
    expect(activityDetail(runtime({ activity: 'needs-input' }))).toBeNull()
    expect(activityDetail(runtime({ activity: 'needs-input', activityMessage: null }))).toBeNull()
    expect(activityDetail(runtime({ activity: 'needs-input', activityMessage: '   ' }))).toBeNull()
  })

  it('caps the message at 120 characters', () => {
    const long = 'a'.repeat(200)
    const detail = activityDetail(runtime({ activity: 'needs-input', activityMessage: long }))
    expect(detail).not.toBeNull()
    expect(detail?.length).toBe(120)
  })
})