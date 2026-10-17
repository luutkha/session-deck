import { describe, it, expect } from 'vitest'
import type { Id, RuntimeState, SessionActivity, SleepSettings } from '../../shared/types'
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'
import { pickSessionsToSleep, type SleepPolicySession } from './sleepPolicy'

const NOW = 1_000_000_000

function settings(overrides: Partial<SleepSettings> = {}): SleepSettings {
  return { enabled: true, afterMinutes: 30, ...overrides }
}

function state(id: Id, overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    sessionId: id,
    run: 'running',
    exitCode: null,
    attention: null,
    ...overrides
  }
}

function sessions(...list: SleepPolicySession[]): SleepPolicySession[] {
  return list
}

function open(id: Id): SleepPolicySession {
  return { id, closed: false }
}

function runtimeOf(...list: RuntimeState[]): ReadonlyMap<Id, RuntimeState> {
  return new Map(list.map((s) => [s.sessionId, s]))
}

function touches(entries: ReadonlyArray<readonly [Id, number]>): ReadonlyMap<Id, number> {
  return new Map(entries)
}

describe('pickSessionsToSleep', () => {
  it('returns nothing when sleep is disabled', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ enabled: false }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a')),
      lastTouchAt: touches([['a', NOW - 60 * 60_000]])
    })
    expect(picked).toEqual([])
  })

  it('picks an idle running session once the threshold has elapsed', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 30 }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished' })),
      lastTouchAt: touches([['a', NOW - 30 * 60_000]])
    })
    expect(picked).toEqual(['a'])
  })

  it('never picks a session with Remote Control active (sleeping would drop the phone connection)', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 30 }),
      activeSessionId: null,
      sessions: sessions(open('a'), open('b')),
      runtime: runtimeOf(
        state('a', { activity: 'finished', remoteControl: true }),
        state('b', { activity: 'finished' })
      ),
      lastTouchAt: touches([['a', NOW - 90 * 60_000], ['b', NOW - 90 * 60_000]])
    })
    expect(picked).toEqual(['b'])
  })

  it('does not pick a session before the threshold', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 30 }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished' })),
      lastTouchAt: touches([['a', NOW - 30 * 60_000 + 1]])
    })
    expect(picked).toEqual([])
  })

  it('never picks the active session', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: 'a',
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a')),
      lastTouchAt: touches([['a', 0]])
    })
    expect(picked).toEqual([])
  })

  it('never picks a closed session', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: null,
      sessions: sessions({ id: 'a', closed: true }),
      runtime: runtimeOf(state('a')),
      lastTouchAt: touches([['a', 0]])
    })
    expect(picked).toEqual([])
  })

  it('never picks a session that is not running', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { run: 'exited' })),
      lastTouchAt: touches([['a', 0]])
    })
    expect(picked).toEqual([])
  })

  it('never picks an already sleeping session', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { run: 'exited', sleeping: true })),
      lastTouchAt: touches([['a', 0]])
    })
    expect(picked).toEqual([])
  })

  it('never picks a session with no runtime entry', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(),
      lastTouchAt: touches([['a', 0]])
    })
    expect(picked).toEqual([])
  })

  it('never picks working or needs-input regardless of idle time', () => {
    for (const activity of ['working', 'needs-input'] as const) {
      const picked = pickSessionsToSleep({
        nowMs: NOW,
        settings: settings(),
        activeSessionId: null,
        sessions: sessions(open('a')),
        runtime: runtimeOf(state('a', { activity })),
        lastTouchAt: touches([['a', 0]])
      })
      expect(picked).toEqual([])
    }
  })

  it('picks finished and unknown activity', () => {
    for (const activity of ['finished', null] as const) {
      const picked = pickSessionsToSleep({
        nowMs: NOW,
        settings: settings(),
        activeSessionId: null,
        sessions: sessions(open('a')),
        runtime: runtimeOf(state('a', { activity: activity as SessionActivity | null })),
        lastTouchAt: touches([['a', 0]])
      })
      expect(picked).toEqual(['a'])
    }
  })

  it('never picks a session with pending attention', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { attention: 'permission' })),
      lastTouchAt: touches([['a', 0]])
    })
    expect(picked).toEqual([])
  })

  it('never picks a session with no recorded touch (treated as now)', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished', activityAt: 0 })),
      lastTouchAt: touches([])
    })
    expect(picked).toEqual([])
  })

  it('uses the later of lastTouchAt and activityAt', () => {
    const recentActivity = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 30 }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished', activityAt: NOW - 1000 })),
      lastTouchAt: touches([['a', 0]])
    })
    expect(recentActivity).toEqual([])

    const oldActivity = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 30 }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished', activityAt: 0 })),
      lastTouchAt: touches([['a', NOW - 30 * 60_000]])
    })
    expect(oldActivity).toEqual(['a'])
  })

  it('clamps afterMinutes below the minimum to MIN_SLEEP_MINUTES', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 0 }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished' })),
      lastTouchAt: touches([['a', NOW - MIN_SLEEP_MINUTES * 60_000]])
    })
    expect(picked).toEqual(['a'])
  })

  it('clamps afterMinutes above the maximum to MAX_SLEEP_MINUTES', () => {
    const justAboveMax = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 999_999 }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished' })),
      lastTouchAt: touches([['a', NOW - (MAX_SLEEP_MINUTES * 60_000 - 1)]])
    })
    expect(justAboveMax).toEqual([])

    const atMax = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 999_999 }),
      activeSessionId: null,
      sessions: sessions(open('a')),
      runtime: runtimeOf(state('a', { activity: 'finished' })),
      lastTouchAt: touches([['a', NOW - MAX_SLEEP_MINUTES * 60_000]])
    })
    expect(atMax).toEqual(['a'])
  })

  it('returns every eligible session (in input order)', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings(),
      activeSessionId: 'b',
      sessions: sessions(open('a'), open('b'), open('c')),
      runtime: runtimeOf(state('a', { activity: 'finished' }), state('b'), state('c', { activity: 'working' })),
      lastTouchAt: touches([['a', 0], ['b', 0], ['c', 0]])
    })
    expect(picked).toEqual(['a'])
  })
})

describe('pickSessionsToSleep (keep awake)', () => {
  it('never picks a session the user marked keep-awake', () => {
    const picked = pickSessionsToSleep({
      nowMs: NOW,
      settings: settings({ afterMinutes: 30 }),
      activeSessionId: null,
      sessions: sessions({ id: 'a', closed: false, keepAwake: true }, open('b')),
      runtime: runtimeOf(state('a', { activity: 'finished' }), state('b', { activity: 'finished' })),
      lastTouchAt: touches([['a', NOW - 90 * 60_000], ['b', NOW - 90 * 60_000]])
    })
    expect(picked).toEqual(['b'])
  })
})
