import { describe, it, expect } from 'vitest'
import type { Id, RuntimeState, SessionActivity, SleepSettings } from '../../shared/types'
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'
import { pickAllToSleep, type AllSleepPolicyInput } from './sleepAllPolicy'
import type { SleepPolicySession } from './sleepPolicy'

const NOW = 1_000_000_000
const MINUTE_MS = 60_000
const ALL_AFTER_MINUTES = 60

function settings(overrides: Partial<SleepSettings> = {}): SleepSettings {
  return { enabled: false, afterMinutes: 30, allEnabled: true, allAfterMinutes: ALL_AFTER_MINUTES, ...overrides }
}

function state(id: Id, overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    sessionId: id,
    run: 'running',
    exitCode: null,
    attention: null,
    activity: 'finished',
    ...overrides
  }
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

/** An input where the whole app has been idle for exactly the threshold and every session was touched long ago. */
function idleInput(overrides: Partial<AllSleepPolicyInput> = {}): AllSleepPolicyInput {
  return {
    nowMs: NOW,
    settings: settings(),
    sessions: [open('a')],
    runtime: runtimeOf(state('a')),
    lastTouchAt: touches([['a', NOW - ALL_AFTER_MINUTES * MINUTE_MS]]),
    lastUserInputAt: NOW - ALL_AFTER_MINUTES * MINUTE_MS,
    ...overrides
  }
}

describe('pickAllToSleep', () => {
  it('returns nothing when sleep-all is disabled', () => {
    const picked = pickAllToSleep(idleInput({ settings: settings({ allEnabled: false }) }))
    expect(picked).toEqual([])
  })

  it('picks every running session once the whole app has been idle for the threshold', () => {
    const picked = pickAllToSleep(idleInput())
    expect(picked).toEqual(['a'])
  })

  it('does nothing when the user typed 1 ms inside the threshold', () => {
    const picked = pickAllToSleep(idleInput({ lastUserInputAt: NOW - ALL_AFTER_MINUTES * MINUTE_MS + 1 }))
    expect(picked).toEqual([])
  })

  it('fires when the user input is exactly at the threshold (>= threshold)', () => {
    const picked = pickAllToSleep(idleInput({ lastUserInputAt: NOW - ALL_AFTER_MINUTES * MINUTE_MS }))
    expect(picked).toEqual(['a'])
  })

  it('a single working session blocks sleeping everything', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [open('a'), open('b')],
        runtime: runtimeOf(state('a'), state('b', { activity: 'working' })),
        lastTouchAt: touches([['a', 0], ['b', 0]])
      })
    )
    expect(picked).toEqual([])
  })

  it('a session waiting for input blocks sleeping everything', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [open('a'), open('b')],
        runtime: runtimeOf(state('a'), state('b', { activity: 'needs-input' })),
        lastTouchAt: touches([['a', 0], ['b', 0]])
      })
    )
    expect(picked).toEqual([])
  })

  it('a pending permission request blocks sleeping everything', () => {
    const picked = pickAllToSleep(
      idleInput({
        runtime: runtimeOf(state('a', { attention: 'permission' })),
        lastTouchAt: touches([['a', 0]])
      })
    )
    expect(picked).toEqual([])
  })

  it('done, idle, bell and unread attention do not block sleeping everything', () => {
    for (const attention of ['done', 'idle', 'bell', 'unread'] as const) {
      const picked = pickAllToSleep(
        idleInput({
          runtime: runtimeOf(state('a', { attention })),
          lastTouchAt: touches([['a', 0]])
        })
      )
      expect(picked).toEqual(['a'])
    }
  })

  it('a working keep-awake session neither blocks nor gets picked', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [{ id: 'a', closed: false, keepAwake: true }, open('b')],
        runtime: runtimeOf(state('a', { activity: 'working' }), state('b')),
        lastTouchAt: touches([['a', 0], ['b', 0]])
      })
    )
    expect(picked).toEqual(['b'])
  })

  it('a remote control session is spared: not picked and it does not block', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [open('a'), open('b')],
        runtime: runtimeOf(state('a', { activity: 'working', remoteControl: true }), state('b')),
        lastTouchAt: touches([['a', 0], ['b', 0]])
      })
    )
    expect(picked).toEqual(['b'])
  })

  it('the on-screen (active) session is picked too', () => {
    const picked = pickAllToSleep(idleInput({ runtime: runtimeOf(state('a', { activity: 'finished' })) }))
    expect(picked).toEqual(['a'])
  })

  it('a session with no recorded touch blocks sleeping everything', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [open('a'), open('b')],
        runtime: runtimeOf(state('a'), state('b')),
        lastTouchAt: touches([['a', 0]])
      })
    )
    expect(picked).toEqual([])
  })

  it('a session with recent activity blocks sleeping everything', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [open('a'), open('b')],
        runtime: runtimeOf(state('a', { activityAt: NOW - MINUTE_MS }), state('b')),
        lastTouchAt: touches([['a', 0], ['b', 0]])
      })
    )
    expect(picked).toEqual([])
  })

  it('a session touched inside the threshold blocks sleeping everything', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [open('a'), open('b')],
        runtime: runtimeOf(state('a'), state('b')),
        lastTouchAt: touches([['a', 0], ['b', NOW - ALL_AFTER_MINUTES * MINUTE_MS + 1]])
      })
    )
    expect(picked).toEqual([])
  })

  it('clamps allAfterMinutes below the minimum to MIN_SLEEP_MINUTES', () => {
    const picked = pickAllToSleep(
      idleInput({
        settings: settings({ allAfterMinutes: 0 }),
        lastUserInputAt: NOW - MIN_SLEEP_MINUTES * MINUTE_MS,
        lastTouchAt: touches([['a', NOW - MIN_SLEEP_MINUTES * MINUTE_MS]])
      })
    )
    expect(picked).toEqual(['a'])
  })

  it('clamps allAfterMinutes above the maximum to MAX_SLEEP_MINUTES', () => {
    const justBelowMax = pickAllToSleep(
      idleInput({
        settings: settings({ allAfterMinutes: 99_999 }),
        lastUserInputAt: NOW - (MAX_SLEEP_MINUTES * MINUTE_MS - 1),
        lastTouchAt: touches([['a', NOW - (MAX_SLEEP_MINUTES * MINUTE_MS - 1)]])
      })
    )
    expect(justBelowMax).toEqual([])

    const atMax = pickAllToSleep(
      idleInput({
        settings: settings({ allAfterMinutes: 99_999 }),
        lastUserInputAt: NOW - MAX_SLEEP_MINUTES * MINUTE_MS,
        lastTouchAt: touches([['a', NOW - MAX_SLEEP_MINUTES * MINUTE_MS]])
      })
    )
    expect(atMax).toEqual(['a'])
  })

  it('returns nothing when there are no candidates', () => {
    expect(pickAllToSleep(idleInput({ sessions: [], runtime: runtimeOf() }))).toEqual([])
  })

  it('never picks or blocks on a closed, sleeping or exited session', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [
          { id: 'closed', closed: true },
          open('asleep'),
          open('exited'),
          open('b')
        ],
        runtime: runtimeOf(
          state('closed', { activity: 'working' }),
          state('asleep', { run: 'exited', sleeping: true, attention: 'permission' }),
          state('exited', { run: 'exited', activity: 'working' }),
          state('b')
        ),
        lastTouchAt: touches([['b', 0]])
      })
    )
    expect(picked).toEqual(['b'])
  })

  it('returns every candidate in sessions order', () => {
    const picked = pickAllToSleep(
      idleInput({
        sessions: [open('c'), open('a'), open('b')],
        runtime: runtimeOf(state('a'), state('b'), state('c')),
        lastTouchAt: touches([['a', 0], ['b', 0], ['c', 0]])
      })
    )
    expect(picked).toEqual(['c', 'a', 'b'])
  })

  it('treats an unknown activity as finished (does not block)', () => {
    const picked = pickAllToSleep(
      idleInput({
        runtime: runtimeOf(state('a', { activity: null as SessionActivity | null })),
        lastTouchAt: touches([['a', 0]])
      })
    )
    expect(picked).toEqual(['a'])
  })
})
