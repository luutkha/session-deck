import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineTurn } from '../../shared/types'
import {
  INITIAL_TIMELINE_STATE,
  LOAD_FAILED_MESSAGE,
  beginLoad,
  createRequestGate,
  finishLoad,
  loadTimeline,
  subscribeSafely,
  type TimelineLoadResult,
  type TimelineViewState
} from './timelineLoad'

function turn(id: string, sessionId = 's1'): TimelineTurn {
  return {
    id,
    sessionId,
    prompt: `prompt ${id}`,
    startedAt: 1,
    endedAt: 2,
    end: 'finished',
    costUsd: null,
    neededYou: false
  }
}

function loaded(sessionId: string, turns: readonly TimelineTurn[]): TimelineViewState {
  return { sessionId, turns, error: null, loading: false }
}

describe('loadTimeline', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the turns the IPC call gave, in the same order', async () => {
    const turns = [turn('newest'), turn('oldest')]
    const result = await loadTimeline('s1', (): Promise<readonly TimelineTurn[]> => Promise.resolve(turns))
    expect(result).toEqual({ ok: true, turns })
  })

  it('asks for the given session', async () => {
    const getTimeline = vi.fn((): Promise<readonly TimelineTurn[]> => Promise.resolve([]))
    await loadTimeline('s9', getTimeline)
    expect(getTimeline).toHaveBeenCalledWith('s9')
  })

  it('returns the short message when the IPC call rejects', async () => {
    const result = await loadTimeline('s1', (): Promise<readonly TimelineTurn[]> => Promise.reject(new Error('ipc down')))
    expect(result).toEqual({ ok: false, error: 'Could not load activity.' })
    expect(console.error).toHaveBeenCalled()
  })

  it('returns the short message when the call throws synchronously', async () => {
    const result = await loadTimeline('s1', (): Promise<readonly TimelineTurn[]> => {
      throw new Error('no bridge')
    })
    expect(result).toEqual({ ok: false, error: LOAD_FAILED_MESSAGE })
  })

  it('returns an empty list for a session with no turns', async () => {
    const result = await loadTimeline('s1', (): Promise<readonly TimelineTurn[]> => Promise.resolve([]))
    expect(result).toEqual({ ok: true, turns: [] })
  })
})

describe('beginLoad', () => {
  it('starts loading the first session with no turns', () => {
    const state = beginLoad(INITIAL_TIMELINE_STATE, 's1')
    expect(state).toEqual({ sessionId: 's1', turns: [], error: null, loading: true })
  })

  it('drops the turns of the previous session when the session changes', () => {
    const state = beginLoad(loaded('s1', [turn('a')]), 's2')
    expect(state.turns).toEqual([])
    expect(state.sessionId).toBe('s2')
  })

  it('keeps the turns on screen while refetching the same session', () => {
    const state = beginLoad(loaded('s1', [turn('a')]), 's1')
    expect(state.turns).toEqual([turn('a')])
    expect(state.loading).toBe(true)
  })

  it('clears an earlier error when a new load starts', () => {
    const failed: TimelineViewState = { sessionId: 's1', turns: [], error: 'Could not load activity.', loading: false }
    expect(beginLoad(failed, 's1').error).toBeNull()
  })
})

describe('finishLoad', () => {
  it('stores the turns of a successful load', () => {
    const started = beginLoad(INITIAL_TIMELINE_STATE, 's1')
    const result: TimelineLoadResult = { ok: true, turns: [turn('a')] }
    expect(finishLoad(started, 's1', result)).toEqual({ sessionId: 's1', turns: [turn('a')], error: null, loading: false })
  })

  it('shows the message and stops loading when the load failed', () => {
    const started = beginLoad(INITIAL_TIMELINE_STATE, 's1')
    const state = finishLoad(started, 's1', { ok: false, error: 'Could not load activity.' })
    expect(state.error).toBe('Could not load activity.')
    expect(state.loading).toBe(false)
  })

  it('ignores a reply for a session that is no longer shown', () => {
    const started = beginLoad(INITIAL_TIMELINE_STATE, 's2')
    const state = finishLoad(started, 's1', { ok: true, turns: [turn('old', 's1')] })
    expect(state).toBe(started)
  })

  it('shows an empty list (not an error) for a session with no turns', () => {
    const started = beginLoad(INITIAL_TIMELINE_STATE, 's1')
    const state = finishLoad(started, 's1', { ok: true, turns: [] })
    expect(state.turns).toEqual([])
    expect(state.error).toBeNull()
  })
})

describe('createRequestGate', () => {
  it('treats only the newest request as current', () => {
    const gate = createRequestGate()
    const first = gate.next()
    const second = gate.next()
    expect(gate.isLatest(first)).toBe(false)
    expect(gate.isLatest(second)).toBe(true)
  })

  it('makes every outstanding request stale after cancel', () => {
    const gate = createRequestGate()
    const request = gate.next()
    gate.cancel()
    expect(gate.isLatest(request)).toBe(false)
  })

  it('accepts a new request after a cancel', () => {
    const gate = createRequestGate()
    gate.next()
    gate.cancel()
    expect(gate.isLatest(gate.next())).toBe(true)
  })
})

describe('subscribeSafely', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the unsubscribe function of a working subscription', () => {
    const off = vi.fn()
    const unsubscribe = subscribeSafely((): (() => void) => off)
    unsubscribe()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('returns a no-op and logs when subscribing throws', () => {
    const unsubscribe = subscribeSafely((): (() => void) => {
      throw new Error('no bridge')
    })
    expect(() => unsubscribe()).not.toThrow()
    expect(console.error).toHaveBeenCalled()
  })
})
