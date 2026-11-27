import { describe, it, expect } from 'vitest'
import type { QuotaAutopilotState, RuntimeState, Session, UsageState } from '../../shared/types'
import {
  EMPTY_AUTOPILOT_STATE,
  FALLBACK_RESET_SEC,
  MAX_TIMEOUT_MS,
  fallbackResetAt,
  RESET_GRACE_MS,
  futureFiveHourReset,
  hasHeld,
  idleCandidateIds,
  isIdleCandidate,
  isNewerReset,
  liveHeldIds,
  nextTimerDelay,
  pruneHeld,
  resetFireAt,
  resolveResetsAt,
  uniqueIds
} from './autopilotPolicy'

const NOW_MS = 1_700_000_000_000
const NOW_SEC = NOW_MS / 1000

function session(overrides: Partial<Session> & { id: string }): Session {
  return { name: overrides.id, cwd: '/x', groupId: null, statusId: null, order: 0, createdAt: 1, claudeArgs: [], ...overrides }
}

function running(overrides: Partial<RuntimeState> & { sessionId: string }): RuntimeState {
  return { run: 'running', exitCode: null, attention: null, ...overrides }
}

function usage(resetsAt: number | null | undefined): UsageState {
  const fiveHour = resetsAt === undefined ? null : { usedPercentage: 96, resetsAt }
  return { account: { fiveHour, sevenDay: null, updatedAt: NOW_MS }, sessions: [] }
}

describe('isIdleCandidate', () => {
  it('accepts an open, running, idle session', () => {
    expect(isIdleCandidate(session({ id: 'a' }), running({ sessionId: 'a' }))).toBe(true)
  })

  it('accepts a session that is idle but waiting at its prompt (activity finished)', () => {
    expect(isIdleCandidate(session({ id: 'a' }), running({ sessionId: 'a', activity: 'finished' }))).toBe(true)
  })

  it('rejects a session without runtime state or that is not running', () => {
    expect(isIdleCandidate(session({ id: 'a' }), undefined)).toBe(false)
    expect(isIdleCandidate(session({ id: 'a' }), running({ sessionId: 'a', run: 'exited' }))).toBe(false)
  })

  it('rejects a session that is already asleep', () => {
    expect(isIdleCandidate(session({ id: 'a' }), running({ sessionId: 'a', sleeping: true }))).toBe(false)
  })

  it('rejects a working or waiting-for-input session', () => {
    expect(isIdleCandidate(session({ id: 'a' }), running({ sessionId: 'a', activity: 'working' }))).toBe(false)
    expect(isIdleCandidate(session({ id: 'a' }), running({ sessionId: 'a', activity: 'needs-input' }))).toBe(false)
  })

  it('rejects a kept-awake session', () => {
    expect(isIdleCandidate(session({ id: 'a', keepAwake: true }), running({ sessionId: 'a' }))).toBe(false)
  })

  it('rejects a session whose Remote Control is active', () => {
    expect(isIdleCandidate(session({ id: 'a' }), running({ sessionId: 'a', remoteControl: true }))).toBe(false)
  })

  it('rejects a closed session', () => {
    expect(isIdleCandidate(session({ id: 'a', closedAt: 5 }), running({ sessionId: 'a' }))).toBe(false)
  })
})

describe('idleCandidateIds', () => {
  it('keeps only the candidates, in session order, including the session on screen', () => {
    const sessions = [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c', keepAwake: true }), session({ id: 'd' })]
    const runtimes = new Map<string, RuntimeState>([
      ['a', running({ sessionId: 'a' })],
      ['b', running({ sessionId: 'b', activity: 'working' })],
      ['c', running({ sessionId: 'c' })],
      ['d', running({ sessionId: 'd', sleeping: true })]
    ])
    expect(idleCandidateIds(sessions, runtimes)).toEqual(['a'])
  })

  it('returns an empty list when nothing is idle', () => {
    expect(idleCandidateIds([session({ id: 'a' })], new Map())).toEqual([])
  })
})

describe('held session helpers', () => {
  const state: QuotaAutopilotState = { sleptForQuota: ['a', 'b'], stoppedAtLimit: ['b', 'c', 'gone'], resetsAt: NOW_SEC + 60 }
  const sessions = [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c', closedAt: 9 })]

  it('reports whether anything is held', () => {
    expect(hasHeld(EMPTY_AUTOPILOT_STATE)).toBe(false)
    expect(hasHeld({ ...EMPTY_AUTOPILOT_STATE, stoppedAtLimit: ['x'] })).toBe(true)
  })

  it('lists the union of held ids, without duplicates, dropping missing and closed sessions', () => {
    expect(liveHeldIds(state, sessions)).toEqual(['a', 'b'])
  })

  it('prunes missing and closed sessions and keeps the reset time', () => {
    expect(pruneHeld(state, sessions)).toEqual({ sleptForQuota: ['a', 'b'], stoppedAtLimit: ['b'], resetsAt: NOW_SEC + 60 })
  })

  it('removes duplicate ids', () => {
    expect(uniqueIds(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })
})

describe('timer arithmetic', () => {
  it('fires RESET_GRACE_MS after the reset second', () => {
    expect(resetFireAt(NOW_SEC)).toBe(NOW_MS + RESET_GRACE_MS)
  })

  it('never asks the timer for more than the maximum delay', () => {
    expect(nextTimerDelay(0, 10 * MAX_TIMEOUT_MS)).toBe(MAX_TIMEOUT_MS)
  })

  it('uses a zero delay for a time that has already passed', () => {
    expect(nextTimerDelay(NOW_MS, NOW_MS - 1000)).toBe(0)
  })

  it('computes the remaining delay for a future time', () => {
    expect(nextTimerDelay(NOW_MS, NOW_MS + 2500)).toBe(2500)
  })
})

describe('reset time from usage', () => {
  it('takes the 5-hour reset when it lies in the future', () => {
    expect(futureFiveHourReset(usage(NOW_SEC + 3600), NOW_MS)).toBe(NOW_SEC + 3600)
  })

  it('ignores a reset time that has already passed (stale usage data)', () => {
    expect(futureFiveHourReset(usage(NOW_SEC - 1), NOW_MS)).toBeNull()
  })

  it('returns null without usage windows or a reset time', () => {
    expect(futureFiveHourReset(usage(undefined), NOW_MS)).toBeNull()
    expect(futureFiveHourReset(usage(null), NOW_MS)).toBeNull()
  })

  it('invents a reset five hours ahead in epoch seconds, rounding the current time up', () => {
    expect(FALLBACK_RESET_SEC).toBe(5 * 60 * 60)
    expect(fallbackResetAt(NOW_MS)).toBe(NOW_SEC + FALLBACK_RESET_SEC)
    expect(fallbackResetAt(NOW_MS + 500)).toBe(NOW_SEC + 1 + FALLBACK_RESET_SEC)
    expect(fallbackResetAt(NOW_MS + 1000)).toBe(NOW_SEC + 1 + FALLBACK_RESET_SEC)
  })

  it('prefers fresh usage, keeps a previous future reset, and drops a previous past one', () => {
    expect(resolveResetsAt(NOW_SEC + 10, NOW_SEC + 20, NOW_MS)).toBe(NOW_SEC + 20)
    expect(resolveResetsAt(NOW_SEC + 10, null, NOW_MS)).toBe(NOW_SEC + 10)
    expect(resolveResetsAt(NOW_SEC - 10, null, NOW_MS)).toBeNull()
    expect(resolveResetsAt(null, null, NOW_MS)).toBeNull()
  })

  it('treats a later reset time as newer information, and an unknown one as older', () => {
    expect(isNewerReset(null, NOW_SEC + 1)).toBe(true)
    expect(isNewerReset(NOW_SEC + 1, NOW_SEC + 2)).toBe(true)
    expect(isNewerReset(NOW_SEC + 2, NOW_SEC + 2)).toBe(false)
  })
})
