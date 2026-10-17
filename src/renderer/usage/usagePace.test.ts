import { describe, expect, it } from 'vitest'
import {
  PACE_WONT_HIT,
  USAGE_HISTORY_KEY,
  appendSample,
  formatPace,
  paceFor,
  parseHistory,
  sampleFromWindows,
  serializeHistory,
  type PaceSample
} from './usagePace'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function sample(overrides: Partial<PaceSample> = {}): PaceSample {
  return {
    at: 0,
    fiveHour: null,
    sevenDay: null,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null,
    ...overrides
  }
}

describe('appendSample', () => {
  it('appends a new sample', () => {
    const next = appendSample([], sample({ at: 1, fiveHour: 10 }))
    expect(next).toHaveLength(1)
    expect(next[0].fiveHour).toBe(10)
  })

  it('drops an identical consecutive sample and returns the same reference', () => {
    const history = [sample({ at: 1, fiveHour: 10, fiveHourResetsAt: 5 })]
    const next = appendSample(history, sample({ at: 2, fiveHour: 10, fiveHourResetsAt: 5 }))
    expect(next).toBe(history)
  })

  it('appends when only a window value changes', () => {
    const history = [sample({ at: 1, fiveHour: 10 })]
    const next = appendSample(history, sample({ at: 2, fiveHour: 11 }))
    expect(next).toHaveLength(2)
  })

  it('drops samples older than maxAgeMs', () => {
    const history = [sample({ at: 0, fiveHour: 1 }), sample({ at: 10 * DAY, fiveHour: 2 })]
    const next = appendSample(history, sample({ at: 10 * DAY + 1, fiveHour: 3 }), 7 * DAY)
    expect(next.map((entry) => entry.at)).toEqual([10 * DAY, 10 * DAY + 1])
  })

  it('caps the history at maxLen most recent samples', () => {
    const history = [sample({ at: 1, fiveHour: 1 }), sample({ at: 2, fiveHour: 2 }), sample({ at: 3, fiveHour: 3 })]
    const next = appendSample(history, sample({ at: 4, fiveHour: 4 }), 7 * DAY, 2)
    expect(next.map((entry) => entry.at)).toEqual([3, 4])
  })

  it('never mutates the input history', () => {
    const history = [sample({ at: 1, fiveHour: 1 })]
    appendSample(history, sample({ at: 2, fiveHour: 2 }))
    expect(history).toHaveLength(1)
  })
})

describe('paceFor', () => {
  const now = 10 * HOUR

  it('returns null for fewer than two samples', () => {
    expect(paceFor([], 'fiveHour', now)).toBeNull()
    expect(paceFor([sample({ at: now, fiveHour: 10 })], 'fiveHour', now)).toBeNull()
  })

  it('returns null when the span is under five minutes', () => {
    const history = [
      sample({ at: now - 2 * MINUTE, fiveHour: 10 }),
      sample({ at: now, fiveHour: 20 })
    ]
    expect(paceFor(history, 'fiveHour', now)).toBeNull()
  })

  it('returns null for a flat or falling slope', () => {
    const flat = [sample({ at: now - HOUR, fiveHour: 10 }), sample({ at: now, fiveHour: 10 })]
    const falling = [sample({ at: now - HOUR, fiveHour: 30 }), sample({ at: now, fiveHour: 10 })]
    expect(paceFor(flat, 'fiveHour', now)).toBeNull()
    expect(paceFor(falling, 'fiveHour', now)).toBeNull()
  })

  it('projects the burn rate from the endpoints', () => {
    const history = [
      sample({ at: now - HOUR, fiveHour: 10, fiveHourResetsAt: 1000 }),
      sample({ at: now, fiveHour: 30, fiveHourResetsAt: 1000 })
    ]
    const pace = paceFor(history, 'fiveHour', now)
    expect(pace?.percentPerHour).toBeCloseTo(20, 5)
    expect(pace?.hoursToLimit).toBeCloseTo(3.5, 5)
  })

  it('ignores samples from a different window (different resetsAt)', () => {
    const history = [
      sample({ at: now - 30 * MINUTE, fiveHour: 10, fiveHourResetsAt: 1000 }),
      sample({ at: now - 20 * MINUTE, fiveHour: 20, fiveHourResetsAt: 999 }),
      sample({ at: now, fiveHour: 30, fiveHourResetsAt: 1000 })
    ]
    const pace = paceFor(history, 'fiveHour', now)
    expect(pace?.percentPerHour).toBeCloseTo(40, 5)
  })

  it('only looks back 90 minutes for the 5-hour window and 24 hours for the 7-day window', () => {
    const old = [
      sample({ at: now - 3 * HOUR, fiveHour: 1 }),
      sample({ at: now, fiveHour: 2 })
    ]
    expect(paceFor(old, 'fiveHour', now)).toBeNull()

    const within = [
      sample({ at: now - 3 * HOUR, sevenDay: 1 }),
      sample({ at: now, sevenDay: 2 })
    ]
    expect(paceFor(within, 'sevenDay', now)?.percentPerHour).toBeCloseTo(1 / 3, 5)
  })

  it('clamps hoursToLimit to zero when already at the limit', () => {
    const history = [
      sample({ at: now - HOUR, fiveHour: 90 }),
      sample({ at: now, fiveHour: 105 })
    ]
    expect(paceFor(history, 'fiveHour', now)?.hoursToLimit).toBe(0)
  })

  it('returns null for a non-finite now', () => {
    const history = [sample({ at: now - HOUR, fiveHour: 10 }), sample({ at: now, fiveHour: 20 })]
    expect(paceFor(history, 'fiveHour', Number.NaN)).toBeNull()
  })
})

describe('formatPace', () => {
  const now = 0

  it('returns "" for a null pace or missing projection', () => {
    expect(formatPace(null, null, now)).toBe('')
    expect(formatPace({ percentPerHour: 10, hoursToLimit: null }, null, now)).toBe('')
  })

  it('formats hours and minutes', () => {
    expect(formatPace({ percentPerHour: 30, hoursToLimit: 1 + 20 / 60 }, null, now)).toBe(
      '~1h 20m left at this pace'
    )
    expect(formatPace({ percentPerHour: 30, hoursToLimit: 2 }, null, now)).toBe('~2h left at this pace')
    expect(formatPace({ percentPerHour: 30, hoursToLimit: 0.5 }, null, now)).toBe('~30m left at this pace')
  })

  it('reports days for long projections', () => {
    expect(formatPace({ percentPerHour: 1, hoursToLimit: 76 }, null, now)).toBe('~3d 4h left at this pace')
  })

  it('says it will not hit the limit when the projection lands after the reset', () => {
    expect(formatPace({ percentPerHour: 10, hoursToLimit: 2 }, HOUR / SECOND, now)).toBe(PACE_WONT_HIT)
  })

  it('still reports the pace when the reset is after the projected limit', () => {
    expect(formatPace({ percentPerHour: 10, hoursToLimit: 1 }, (10 * HOUR) / SECOND, now)).toBe(
      '~1h left at this pace'
    )
  })

  it('returns "" for a non-finite now', () => {
    expect(formatPace({ percentPerHour: 10, hoursToLimit: 1 }, null, Number.NaN)).toBe('')
  })
})

describe('history persistence', () => {
  it('round-trips valid samples', () => {
    const history = [sample({ at: 1, fiveHour: 10, sevenDay: 20, fiveHourResetsAt: 5, sevenDayResetsAt: 6 })]
    expect(parseHistory(serializeHistory(history))).toEqual(history)
  })

  it('uses the documented storage key', () => {
    expect(USAGE_HISTORY_KEY).toBe('sessiondeck.usage.history.v1')
  })

  it('returns [] for corrupt or non-array input', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('{not json')).toEqual([])
    expect(parseHistory('42')).toEqual([])
    expect(parseHistory('{}')).toEqual([])
  })

  it('skips malformed samples but keeps valid ones', () => {
    const raw = JSON.stringify([
      { at: 1, fiveHour: 10, sevenDay: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
      { at: 'x', fiveHour: 10, sevenDay: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
      { at: 2, fiveHour: 'x', sevenDay: null, fiveHourResetsAt: null, sevenDayResetsAt: null }
    ])
    const parsed = parseHistory(raw)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].at).toBe(1)
  })
})

describe('sampleFromWindows', () => {
  it('flattens account windows into a sample', () => {
    expect(
      sampleFromWindows(123, { usedPercentage: 40, resetsAt: 9 }, { usedPercentage: 70, resetsAt: null })
    ).toEqual({
      at: 123,
      fiveHour: 40,
      sevenDay: 70,
      fiveHourResetsAt: 9,
      sevenDayResetsAt: null
    })
  })

  it('reads absent windows as null', () => {
    expect(sampleFromWindows(1, null, null)).toEqual({
      at: 1,
      fiveHour: null,
      sevenDay: null,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null
    })
  })
})
