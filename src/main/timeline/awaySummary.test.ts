import { describe, it, expect } from 'vitest'
import type { AwaySummary, Id, RuntimeState, TimelineTurn, TurnEnd } from '../../shared/types'
import { buildAwaySummary, type AwaySessionInfo, type BuildAwaySummaryInput } from './awaySummary'

const SINCE = 1_000_000
const UNTIL = 2_000_000

function turn(overrides: Partial<TimelineTurn> & { id: string; sessionId: Id }): TimelineTurn {
  return {
    prompt: '',
    startedAt: SINCE + 100,
    endedAt: SINCE + 200,
    end: 'finished',
    costUsd: null,
    neededYou: false,
    ...overrides
  }
}

function runtimeOf(...entries: Array<[Id, RuntimeState['attention']]>): ReadonlyMap<Id, RuntimeState> {
  return new Map(
    entries.map(([sessionId, attention]) => [
      sessionId,
      { sessionId, run: 'running' as const, exitCode: null, attention }
    ])
  )
}

function input(overrides: Partial<BuildAwaySummaryInput> = {}): BuildAwaySummaryInput {
  return {
    since: SINCE,
    until: UNTIL,
    turns: [],
    sessions: [{ id: 's1', name: 'Alpha' }],
    runtime: new Map(),
    lastSleptAt: () => null,
    ...overrides
  }
}

function summaryFor(overrides: Partial<BuildAwaySummaryInput>): AwaySummary {
  return buildAwaySummary(input(overrides))
}

describe('buildAwaySummary: empty and basic shape', () => {
  it('with nothing to report gives no sessions and zero totals', () => {
    const summary = buildAwaySummary(input())
    expect(summary).toEqual({
      since: SINCE,
      until: UNTIL,
      sessions: [],
      totals: { finished: 0, needsYou: 0, slept: 0, hitLimit: 0, costUsd: 0 }
    })
  })

  it('echoes the window it was built for', () => {
    const summary = buildAwaySummary(input({ since: 5, until: 9 }))
    expect(summary.since).toBe(5)
    expect(summary.until).toBe(9)
  })
})

describe('buildAwaySummary: finished turns', () => {
  it('counts turns that finished inside the window, with the newest prompt and cost', () => {
    const summary = summaryFor({
      turns: [
        turn({ id: 'a', sessionId: 's1', prompt: 'first', endedAt: SINCE + 100, costUsd: 0.5 }),
        turn({ id: 'b', sessionId: 's1', prompt: 'second', endedAt: SINCE + 900, costUsd: 0.25 })
      ]
    })
    expect(summary.sessions).toHaveLength(1)
    expect(summary.sessions[0]).toMatchObject({
      sessionId: 's1',
      name: 'Alpha',
      finished: 2,
      needsYou: false,
      hitLimit: false,
      slept: false,
      costUsd: 0.75,
      lastPrompt: 'second',
      lastAt: SINCE + 900
    })
    expect(summary.totals.finished).toBe(2)
    expect(summary.totals.costUsd).toBeCloseTo(0.75)
  })

  it('ignores turns that ended before the window or after it', () => {
    const summary = summaryFor({
      turns: [
        turn({ id: 'early', sessionId: 's1', startedAt: 0, endedAt: SINCE }),
        turn({ id: 'late', sessionId: 's1', startedAt: UNTIL, endedAt: UNTIL + 1 })
      ]
    })
    expect(summary.sessions).toEqual([])
  })

  it('counts a turn that ended exactly at until, and not one that ended exactly at since', () => {
    const atUntil = summaryFor({ turns: [turn({ id: 'x', sessionId: 's1', startedAt: SINCE + 1, endedAt: UNTIL })] })
    const atSince = summaryFor({ turns: [turn({ id: 'y', sessionId: 's1', startedAt: 0, endedAt: SINCE })] })
    expect(atUntil.sessions[0]?.finished).toBe(1)
    expect(atSince.sessions).toEqual([])
  })

  it('a finished turn with no known cost gives a null session cost and 0 total cost', () => {
    const summary = summaryFor({ turns: [turn({ id: 'a', sessionId: 's1', costUsd: null })] })
    expect(summary.sessions[0].costUsd).toBeNull()
    expect(summary.totals.costUsd).toBe(0)
  })
})

describe('buildAwaySummary: needs the user', () => {
  it('a session with a pending permission request is listed even with no turns', () => {
    const summary = summaryFor({ runtime: runtimeOf(['s1', 'permission']) })
    expect(summary.sessions).toEqual([
      expect.objectContaining({ sessionId: 's1', needsYou: true, finished: 0, lastPrompt: '' })
    ])
    expect(summary.totals.needsYou).toBe(1)
  })

  it('a turn that needed the user and ended inside the window marks needsYou', () => {
    const summary = summaryFor({
      turns: [turn({ id: 'a', sessionId: 's1', neededYou: true })]
    })
    expect(summary.sessions[0].needsYou).toBe(true)
  })

  it('a turn still running through the window that needed the user counts, though not as finished', () => {
    const summary = summaryFor({
      turns: [turn({ id: 'a', sessionId: 's1', startedAt: SINCE - 500, endedAt: null, end: null, neededYou: true })]
    })
    expect(summary.sessions[0]).toMatchObject({ needsYou: true, finished: 0 })
  })

  it('a running turn that did not need the user is not reported', () => {
    const summary = summaryFor({
      turns: [turn({ id: 'a', sessionId: 's1', startedAt: SINCE + 10, endedAt: null, end: null })]
    })
    expect(summary.sessions).toEqual([])
  })

  it('a turn that needed the user before the window and ended before it is not reported', () => {
    const summary = summaryFor({
      turns: [turn({ id: 'a', sessionId: 's1', startedAt: 0, endedAt: SINCE - 1, neededYou: true })]
    })
    expect(summary.sessions).toEqual([])
  })
})

describe('buildAwaySummary: limit, sleep and closed sessions', () => {
  it('a turn that ended at the usage limit marks hitLimit', () => {
    const summary = summaryFor({ turns: [turn({ id: 'a', sessionId: 's1', end: 'limit' })] })
    expect(summary.sessions[0]).toMatchObject({ hitLimit: true, finished: 0 })
    expect(summary.totals.hitLimit).toBe(1)
  })

  it('a turn that ended by sleep marks slept', () => {
    const summary = summaryFor({ turns: [turn({ id: 'a', sessionId: 's1', end: 'slept' })] })
    expect(summary.sessions[0]).toMatchObject({ slept: true })
    expect(summary.totals.slept).toBe(1)
  })

  it('a sleep recorded inside the window marks slept even with no turns', () => {
    const summary = summaryFor({ lastSleptAt: (id) => (id === 's1' ? UNTIL - 10 : null) })
    expect(summary.sessions).toEqual([expect.objectContaining({ sessionId: 's1', slept: true })])
  })

  it('a sleep recorded before the window does not count', () => {
    const summary = summaryFor({ lastSleptAt: () => SINCE })
    expect(summary.sessions).toEqual([])
  })

  it('a closed session is excluded even when it had activity', () => {
    const sessions: AwaySessionInfo[] = [{ id: 's1', name: 'Gone', closedAt: SINCE + 5 }]
    const summary = summaryFor({ sessions, turns: [turn({ id: 'a', sessionId: 's1' })] })
    expect(summary.sessions).toEqual([])
  })

  it('a session that only closed or exited inside the window is not listed', () => {
    const ends: TurnEnd[] = ['closed', 'exited']
    const turns = ends.map((end, i) => turn({ id: `e${i}`, sessionId: 's1', end }))
    expect(summaryFor({ turns }).sessions).toEqual([])
  })

  it('turns of an unknown session id are ignored', () => {
    const summary = summaryFor({ turns: [turn({ id: 'a', sessionId: 'ghost' })] })
    expect(summary.sessions).toEqual([])
  })
})

describe('buildAwaySummary: ordering and totals', () => {
  it('sorts sessions by lastAt, newest first', () => {
    const summary = summaryFor({
      sessions: [
        { id: 'old', name: 'Old' },
        { id: 'new', name: 'New' }
      ],
      turns: [
        turn({ id: 'a', sessionId: 'old', endedAt: SINCE + 100 }),
        turn({ id: 'b', sessionId: 'new', endedAt: SINCE + 800 })
      ]
    })
    expect(summary.sessions.map((s) => s.sessionId)).toEqual(['new', 'old'])
  })

  it('lastAt uses the sleep time when that is the newest event', () => {
    const summary = summaryFor({
      turns: [turn({ id: 'a', sessionId: 's1', endedAt: SINCE + 100 })],
      lastSleptAt: () => SINCE + 1500
    })
    expect(summary.sessions[0].lastAt).toBe(SINCE + 1500)
  })

  it('a session kept only by a pending permission falls back to since as lastAt', () => {
    const summary = summaryFor({ runtime: runtimeOf(['s1', 'permission']) })
    expect(summary.sessions[0].lastAt).toBe(SINCE)
  })

  it('totals add up over the listed sessions', () => {
    const summary = summaryFor({
      sessions: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ],
      runtime: runtimeOf(['a', 'permission']),
      turns: [
        turn({ id: 'a1', sessionId: 'a', costUsd: 1 }),
        turn({ id: 'a2', sessionId: 'a', costUsd: 2, end: 'limit' }),
        turn({ id: 'b1', sessionId: 'b', costUsd: 0.5, end: 'slept' }),
        turn({ id: 'c1', sessionId: 'c', costUsd: null, end: 'finished' })
      ]
    })
    expect(summary.totals).toEqual({ finished: 2, needsYou: 1, slept: 1, hitLimit: 1, costUsd: 3.5 })
  })

  it('sums known costs only and counts a running turn cost that is known so far', () => {
    const summary = summaryFor({
      turns: [
        turn({ id: 'a', sessionId: 's1', costUsd: 1 }),
        turn({ id: 'b', sessionId: 's1', costUsd: null }),
        turn({ id: 'c', sessionId: 's1', startedAt: SINCE + 300, endedAt: null, end: null, costUsd: 0.5, neededYou: true })
      ]
    })
    expect(summary.sessions[0].costUsd).toBeCloseTo(1.5)
  })

  it('a session with a known cost on a turn outside the window does not add to the summary', () => {
    const summary = summaryFor({
      turns: [
        turn({ id: 'old', sessionId: 's1', startedAt: 0, endedAt: SINCE - 5, costUsd: 9 }),
        turn({ id: 'new', sessionId: 's1', endedAt: SINCE + 50, costUsd: 0.1 })
      ]
    })
    expect(summary.sessions[0].costUsd).toBeCloseTo(0.1)
  })
})
