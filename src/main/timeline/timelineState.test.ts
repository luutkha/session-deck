import { describe, it, expect } from 'vitest'
import type { TimelineTurn } from '../../shared/types'
import { TIMELINE_MAX_TURNS_PER_SESSION } from '../../shared/types'
import {
  COST_SETTLE_MS,
  allTurns,
  emptyTimelineState,
  endRunningTurn,
  forgetSession,
  markNeededYou,
  recordSleptAt,
  refreshCost,
  runningTurn,
  sessionTurns,
  startTurn,
  stateFromTurns
} from './timelineState'

const T0 = 1_000_000

function turn(id: string, overrides: Partial<TimelineTurn> = {}): TimelineTurn {
  return {
    id,
    sessionId: 's1',
    prompt: '',
    startedAt: T0,
    endedAt: null,
    end: null,
    costUsd: null,
    neededYou: false,
    ...overrides
  }
}

function startedState(id = 'a', startCost: number | null = 1) {
  return startTurn(emptyTimelineState(), 's1', turn(id, { prompt: 'p' }), startCost)
}

describe('startTurn / sessionTurns / runningTurn', () => {
  it('appends the turn to its session in chronological order', () => {
    let state = startedState('a')
    state = endRunningTurn(state, 's1', 'finished', T0 + 5)
    state = startTurn(state, 's1', turn('b'), 1)
    expect(sessionTurns(state, 's1').map((t) => t.id)).toEqual(['a', 'b'])
    expect(runningTurn(sessionTurns(state, 's1'))?.id).toBe('b')
  })

  it('keeps only the newest TIMELINE_MAX_TURNS_PER_SESSION turns', () => {
    let state = emptyTimelineState()
    for (let i = 0; i <= TIMELINE_MAX_TURNS_PER_SESSION; i += 1) {
      state = startTurn(state, 's1', turn(`t${i}`, { endedAt: T0, end: 'finished' }), null)
    }
    const ids = sessionTurns(state, 's1').map((t) => t.id)
    expect(ids).toHaveLength(TIMELINE_MAX_TURNS_PER_SESSION)
    expect(ids[0]).toBe('t1')
    expect(ids[ids.length - 1]).toBe(`t${TIMELINE_MAX_TURNS_PER_SESSION}`)
  })

  it('does not change the previous state object (immutable)', () => {
    const before = startedState('a')
    const snapshot = JSON.stringify([...before.turns.entries()])
    startTurn(before, 's1', turn('b'), 1)
    expect(JSON.stringify([...before.turns.entries()])).toBe(snapshot)
  })
})

describe('endRunningTurn', () => {
  it('ends the running turn with the given end and time', () => {
    const state = endRunningTurn(startedState(), 's1', 'limit', T0 + 9)
    expect(sessionTurns(state, 's1')[0]).toMatchObject({ end: 'limit', endedAt: T0 + 9 })
  })

  it('returns the same state object when nothing is running', () => {
    const ended = endRunningTurn(startedState(), 's1', 'finished', T0 + 1)
    expect(endRunningTurn(ended, 's1', 'finished', T0 + 2)).toBe(ended)
    const empty = emptyTimelineState()
    expect(endRunningTurn(empty, 's1', 'finished', T0)).toBe(empty)
  })
})

describe('markNeededYou', () => {
  it('sets neededYou on the running turn', () => {
    const state = markNeededYou(startedState(), 's1')
    expect(sessionTurns(state, 's1')[0].neededYou).toBe(true)
  })

  it('is a no-op (same state) when no turn is running', () => {
    const ended = endRunningTurn(startedState(), 's1', 'finished', T0 + 1)
    expect(markNeededYou(ended, 's1')).toBe(ended)
  })
})

describe('refreshCost', () => {
  it('is the cost delta since the turn started', () => {
    const state = refreshCost(startedState('a', 1.5), 's1', 2.0, T0)
    expect(sessionTurns(state, 's1')[0].costUsd).toBeCloseTo(0.5)
  })

  it('clamps a cost that went down to 0', () => {
    const state = refreshCost(startedState('a', 3), 's1', 2, T0)
    expect(sessionTurns(state, 's1')[0].costUsd).toBe(0)
  })

  it('is null when the start cost or the latest cost is unknown', () => {
    expect(sessionTurns(refreshCost(startedState('a', null), 's1', 2, T0), 's1')[0].costUsd).toBeNull()
    expect(sessionTurns(refreshCost(startedState('a', 1), 's1', null, T0), 's1')[0].costUsd).toBeNull()
  })

  it('keeps updating a finished turn up to COST_SETTLE_MS after it ended', () => {
    const ended = endRunningTurn(startedState('a', 1), 's1', 'finished', T0 + 100)
    const settled = refreshCost(ended, 's1', 1.75, T0 + 100 + COST_SETTLE_MS)
    expect(sessionTurns(settled, 's1')[0].costUsd).toBeCloseTo(0.75)
  })

  it('stops updating a finished turn after COST_SETTLE_MS', () => {
    const ended = endRunningTurn(startedState('a', 1), 's1', 'finished', T0 + 100)
    const late = refreshCost(ended, 's1', 9, T0 + 100 + COST_SETTLE_MS + 1)
    expect(late).toBe(ended)
  })

  it('stops updating the previous turn once the next turn of the session starts', () => {
    let state = refreshCost(startedState('a', 1), 's1', 1.2, T0)
    state = endRunningTurn(state, 's1', 'finished', T0 + 10)
    state = startTurn(state, 's1', turn('b'), 1.2)
    const frozen = sessionTurns(state, 's1')[0].costUsd
    const after = refreshCost(state, 's1', 5, T0 + 20)
    expect(sessionTurns(after, 's1')[0].costUsd).toBe(frozen)
    expect(sessionTurns(after, 's1')[1].costUsd).toBeCloseTo(3.8)
  })

  it('returns the same state when the cost has not changed', () => {
    const state = refreshCost(startedState('a', 1), 's1', 1.5, T0)
    expect(refreshCost(state, 's1', 1.5, T0)).toBe(state)
  })

  it('does nothing for a session with no tracked turn', () => {
    const state = emptyTimelineState()
    expect(refreshCost(state, 's1', 4, T0)).toBe(state)
  })
})

describe('recordSleptAt / forgetSession', () => {
  it('records the time a session was slept', () => {
    const state = recordSleptAt(emptyTimelineState(), 's1', T0 + 3)
    expect(state.sleptAt.get('s1')).toBe(T0 + 3)
  })

  it('forgetSession drops turns, sleep time and cost tracking of that session only', () => {
    let state = recordSleptAt(startedState('a'), 's1', T0)
    state = startTurn(state, 's2', { ...turn('x'), sessionId: 's2' }, null)
    const next = forgetSession(state, 's1')
    expect(sessionTurns(next, 's1')).toEqual([])
    expect(next.sleptAt.has('s1')).toBe(false)
    expect(sessionTurns(next, 's2')).toHaveLength(1)
  })
})

describe('stateFromTurns / allTurns', () => {
  it('groups turns by session in start order and caps each session', () => {
    const many = Array.from({ length: TIMELINE_MAX_TURNS_PER_SESSION + 2 }, (_, i) =>
      turn(`t${i}`, { startedAt: T0 + i, endedAt: T0 + i, end: 'finished' })
    )
    const other = { ...turn('o'), sessionId: 's2' }
    const state = stateFromTurns([...many.slice().reverse(), other])
    expect(sessionTurns(state, 's1')).toHaveLength(TIMELINE_MAX_TURNS_PER_SESSION)
    expect(sessionTurns(state, 's1')[0].id).toBe('t2')
    expect(sessionTurns(state, 's2')).toHaveLength(1)
  })

  it('allTurns returns every turn newest first', () => {
    const state = stateFromTurns([
      turn('old', { startedAt: T0, endedAt: T0, end: 'finished' }),
      { ...turn('new', { startedAt: T0 + 10 }), sessionId: 's2' }
    ])
    expect(allTurns(state).map((t) => t.id)).toEqual(['new', 'old'])
  })
})
