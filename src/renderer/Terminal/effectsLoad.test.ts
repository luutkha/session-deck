import { describe, expect, it } from 'vitest'
import type { Id, RuntimeState } from '../../shared/types'
import { animatedSessionCount, EFFECTS_FLEET_ENTER, EFFECTS_FLEET_EXIT, nextFleetBusy } from './effectsLoad'

function runtime(states: Partial<RuntimeState>[]): ReadonlyMap<Id, RuntimeState> {
  return new Map(states.map((s, i): [Id, RuntimeState] => [`s${i}`, { sessionId: `s${i}`, run: 'running', exitCode: null, attention: null, ...s }]))
}

describe('animatedSessionCount', () => {
  it('counts running sessions that are working or need the user', () => {
    const map = runtime([
      { activity: 'working' },
      { attention: 'permission' },
      { activity: 'finished' },
      { activity: null },
      {}
    ])
    expect(animatedSessionCount(map)).toBe(2)
  })

  it('ignores exited sessions even when their last activity was working', () => {
    expect(animatedSessionCount(runtime([{ run: 'exited', activity: 'working' }, { run: 'exited', attention: 'done' }]))).toBe(0)
  })

  it('is 0 for an empty runtime', () => {
    expect(animatedSessionCount(new Map())).toBe(0)
  })
})

describe('nextFleetBusy', () => {
  it('turns on at the enter limit and off at the exit limit', () => {
    expect(nextFleetBusy(false, EFFECTS_FLEET_ENTER)).toBe(true)
    expect(nextFleetBusy(true, EFFECTS_FLEET_EXIT)).toBe(false)
  })

  it('keeps its state between the limits (no flicker)', () => {
    for (let n = EFFECTS_FLEET_EXIT + 1; n < EFFECTS_FLEET_ENTER; n += 1) {
      expect(nextFleetBusy(true, n)).toBe(true)
      expect(nextFleetBusy(false, n)).toBe(false)
    }
  })

  it('stays off with few sessions and on with many', () => {
    expect(nextFleetBusy(false, 0)).toBe(false)
    expect(nextFleetBusy(true, 40)).toBe(true)
  })
})
