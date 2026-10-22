import { describe, expect, it } from 'vitest'
import type { AwaySessionSummary, AwaySummary, TimelineTurn } from '../../shared/types'
import {
  awayHeadline,
  awayRowDetail,
  formatCost,
  formatDuration,
  formatTurnTime,
  isTurnRunning,
  promptText,
  singleLine,
  turnEndLabel,
  turnMeta
} from './timelineFormat'

function turn(overrides: Partial<TimelineTurn> = {}): TimelineTurn {
  return {
    id: 't1',
    sessionId: 's1',
    prompt: 'Fix the login bug',
    startedAt: new Date(2026, 9, 22, 14, 5).getTime(),
    endedAt: new Date(2026, 9, 22, 14, 8, 5).getTime(),
    end: 'finished',
    costUsd: 0.12,
    neededYou: false,
    ...overrides
  }
}

function sessionSummary(overrides: Partial<AwaySessionSummary> = {}): AwaySessionSummary {
  return {
    sessionId: 's1',
    name: 'API',
    finished: 0,
    needsYou: false,
    hitLimit: false,
    slept: false,
    costUsd: null,
    lastPrompt: '',
    lastAt: 1,
    ...overrides
  }
}

function summary(overrides: Partial<AwaySummary> = {}): AwaySummary {
  return {
    since: 0,
    until: 0,
    sessions: [],
    totals: { finished: 0, needsYou: 0, slept: 0, hitLimit: 0, costUsd: 0 },
    ...overrides
  }
}

describe('turnEndLabel', () => {
  it('says Running while the turn has no end', () => {
    expect(turnEndLabel(turn({ end: null, endedAt: null }))).toBe('Running')
  })

  it('says Finished for a normal end', () => {
    expect(turnEndLabel(turn({ end: 'finished' }))).toBe('Finished')
  })

  it('adds needed you when the turn asked the user something', () => {
    expect(turnEndLabel(turn({ end: 'finished', neededYou: true }))).toBe('Finished · needed you')
  })

  it('says the turn stopped at the usage limit', () => {
    expect(turnEndLabel(turn({ end: 'limit' }))).toBe('Stopped at the usage limit')
  })

  it('says the session was put to sleep', () => {
    expect(turnEndLabel(turn({ end: 'slept' }))).toBe('Put to sleep')
  })

  it('says the session was closed', () => {
    expect(turnEndLabel(turn({ end: 'closed' }))).toBe('Closed')
  })

  it('says Stopped when the process exited', () => {
    expect(turnEndLabel(turn({ end: 'exited' }))).toBe('Stopped')
  })
})

describe('isTurnRunning', () => {
  it('is true when endedAt is null', () => {
    expect(isTurnRunning(turn({ endedAt: null, end: null }))).toBe(true)
  })

  it('is false once the turn has an end time', () => {
    expect(isTurnRunning(turn())).toBe(false)
  })
})

describe('formatDuration', () => {
  it('shows whole seconds under one minute', () => {
    expect(formatDuration(42_000)).toBe('42s')
  })

  it('shows exactly 60 seconds as a minute with padded seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 00s')
  })

  it('pads seconds inside minutes', () => {
    expect(formatDuration(185_000)).toBe('3m 05s')
  })

  it('drops the sub-second part', () => {
    expect(formatDuration(59_999)).toBe('59s')
  })

  it('shows exactly 60 minutes as an hour with padded minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m')
  })

  it('pads minutes inside hours', () => {
    expect(formatDuration(4_020_000)).toBe('1h 07m')
  })

  it('reads a negative duration as 0s', () => {
    expect(formatDuration(-5_000)).toBe('0s')
  })

  it('reads NaN as 0s', () => {
    expect(formatDuration(Number.NaN)).toBe('0s')
  })

  it('reads Infinity as 0s', () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s')
  })
})

describe('formatCost', () => {
  it('is empty when the cost is unknown', () => {
    expect(formatCost(null)).toBe('')
  })

  it('shows less than a cent as <$0.01', () => {
    expect(formatCost(0.004)).toBe('<$0.01')
  })

  it('shows zero as <$0.01', () => {
    expect(formatCost(0)).toBe('<$0.01')
  })

  it('shows exactly one cent with two decimals', () => {
    expect(formatCost(0.01)).toBe('$0.01')
  })

  it('rounds to two decimals', () => {
    expect(formatCost(1.236)).toBe('$1.24')
  })

  it('is empty for NaN', () => {
    expect(formatCost(Number.NaN)).toBe('')
  })
})

describe('formatTurnTime', () => {
  const now = new Date(2026, 9, 22, 18, 30).getTime()

  it('shows only the clock for a turn from the same day', () => {
    expect(formatTurnTime(new Date(2026, 9, 22, 9, 7).getTime(), now)).toBe('09:07')
  })

  it('says Yesterday before the clock for the day before', () => {
    expect(formatTurnTime(new Date(2026, 9, 21, 23, 59).getTime(), now)).toBe('Yesterday 23:59')
  })

  it('shows day and month for older turns', () => {
    expect(formatTurnTime(new Date(2026, 9, 3, 14, 5).getTime(), now)).toBe('3 Oct 14:05')
  })

  it('treats midnight as the start of the day', () => {
    expect(formatTurnTime(new Date(2026, 9, 22, 0, 0).getTime(), now)).toBe('00:00')
  })

  it('goes back across a month boundary for yesterday', () => {
    const firstOfMonth = new Date(2026, 10, 1, 8, 0).getTime()
    expect(formatTurnTime(new Date(2026, 9, 31, 22, 15).getTime(), firstOfMonth)).toBe('Yesterday 22:15')
  })

  it('returns empty for a non-finite time', () => {
    expect(formatTurnTime(Number.NaN, now)).toBe('')
  })
})

describe('singleLine and promptText', () => {
  it('collapses newlines and runs of spaces', () => {
    expect(singleLine('first line\n\n  second   line')).toBe('first line second line')
  })

  it('returns the prompt when one was recorded', () => {
    expect(promptText(turn({ prompt: 'Add tests' }))).toBe('Add tests')
  })

  it('shows a placeholder when the prompt is empty', () => {
    expect(promptText(turn({ prompt: '' }))).toBe('(prompt not recorded)')
  })

  it('shows a placeholder when the prompt is only whitespace', () => {
    expect(promptText(turn({ prompt: ' \n\t ' }))).toBe('(prompt not recorded)')
  })

  it('keeps a long prompt whole (the list clamps it visually)', () => {
    const long = 'word '.repeat(40).trim()
    expect(promptText(turn({ prompt: long }))).toBe(long)
  })

  it('puts a multi-line prompt on one line', () => {
    expect(promptText(turn({ prompt: 'Refactor\nthe parser' }))).toBe('Refactor the parser')
  })
})

describe('turnMeta', () => {
  const now = new Date(2026, 9, 22, 18, 30).getTime()

  it('joins time, duration and end label, then cost', () => {
    expect(turnMeta(turn(), now)).toBe('14:05 · 3m 05s · Finished · $0.12')
  })

  it('leaves the cost out when it is unknown', () => {
    expect(turnMeta(turn({ costUsd: null }), now)).toBe('14:05 · 3m 05s · Finished')
  })

  it('measures a running turn up to now', () => {
    const running = turn({ endedAt: null, end: null, costUsd: null })
    const ticks = new Date(2026, 9, 22, 14, 6, 35).getTime()
    expect(turnMeta(running, ticks)).toBe('14:05 · 1m 35s · Running')
  })

  it('uses the end time of a finished turn, not now', () => {
    const later = new Date(2026, 9, 22, 20, 0).getTime()
    expect(turnMeta(turn(), later)).toBe('14:05 · 3m 05s · Finished · $0.12')
  })
})

describe('awayHeadline', () => {
  it('shows only the duration when nothing happened', () => {
    expect(awayHeadline(summary({ since: 0, until: 300_000 }))).toBe('Away 5m 00s')
  })

  it('joins every non-zero total with a dot', () => {
    const result = awayHeadline(
      summary({
        since: 0,
        until: 4_020_000,
        totals: { finished: 2, needsYou: 1, slept: 1, hitLimit: 1, costUsd: 0.4 }
      })
    )
    expect(result).toBe('Away 1h 07m · 2 finished · 1 needs you · 1 put to sleep · 1 hit the limit · $0.40')
  })

  it('uses the plural for needs you above one', () => {
    const result = awayHeadline(summary({ until: 60_000, totals: { finished: 0, needsYou: 3, slept: 0, hitLimit: 0, costUsd: 0 } }))
    expect(result).toBe('Away 1m 00s · 3 need you')
  })

  it('leaves out a zero cost', () => {
    const result = awayHeadline(summary({ until: 1_000, totals: { finished: 1, needsYou: 0, slept: 0, hitLimit: 0, costUsd: 0 } }))
    expect(result).toBe('Away 1s · 1 finished')
  })

  it('shows a tiny positive cost as <$0.01', () => {
    const result = awayHeadline(summary({ until: 1_000, totals: { finished: 0, needsYou: 0, slept: 0, hitLimit: 0, costUsd: 0.002 } }))
    expect(result).toBe('Away 1s · <$0.01')
  })

  it('never shows a negative duration', () => {
    expect(awayHeadline(summary({ since: 500, until: 100 }))).toBe('Away 0s')
  })
})

describe('awayRowDetail', () => {
  it('joins the parts for one session with a dot', () => {
    const detail = awayRowDetail(
      sessionSummary({ finished: 2, needsYou: true, slept: true, costUsd: 0.4 })
    )
    expect(detail).toBe('2 finished · needs you · put to sleep · $0.40')
  })

  it('shows hit the limit', () => {
    expect(awayRowDetail(sessionSummary({ hitLimit: true }))).toBe('hit the limit')
  })

  it('is empty when the session has nothing to report', () => {
    expect(awayRowDetail(sessionSummary())).toBe('')
  })

  it('does not show a session cost of null', () => {
    expect(awayRowDetail(sessionSummary({ finished: 1, costUsd: null }))).toBe('1 finished')
  })
})
