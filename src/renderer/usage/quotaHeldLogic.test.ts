import { describe, expect, it } from 'vitest'
import type { QuotaAutopilotState } from '../../shared/types'
import {
  formatClockTime,
  heldChipLabel,
  heldSessionIds,
  heldTooltipLines,
  isHeldVisible
} from './quotaHeldLogic'

function state(overrides: Partial<QuotaAutopilotState> = {}): QuotaAutopilotState {
  return { sleptForQuota: [], stoppedAtLimit: [], resetsAt: null, ...overrides }
}

describe('heldSessionIds', () => {
  it('lists each held session once, slept sessions first', () => {
    expect(heldSessionIds(state({ sleptForQuota: ['a', 'b'], stoppedAtLimit: ['b', 'c'] }))).toEqual(['a', 'b', 'c'])
  })

  it('is empty when nothing is held', () => {
    expect(heldSessionIds(state())).toEqual([])
  })
})

describe('isHeldVisible', () => {
  it('is visible while a session is slept for the quota', () => {
    expect(isHeldVisible(state({ sleptForQuota: ['a'] }))).toBe(true)
  })

  it('is visible while a session is stopped at the limit', () => {
    expect(isHeldVisible(state({ stoppedAtLimit: ['a'] }))).toBe(true)
  })

  it('is hidden when nothing is held, even if a reset time is known', () => {
    expect(isHeldVisible(state({ resetsAt: 1_700_000_000 }))).toBe(false)
  })
})

describe('formatClockTime', () => {
  it('formats a local time as HH:MM with leading zeros', () => {
    const epochSec = new Date(2026, 9, 22, 9, 5).getTime() / 1000
    expect(formatClockTime(epochSec)).toBe('09:05')
  })

  it('formats an afternoon time without padding the hour away', () => {
    const epochSec = new Date(2026, 9, 22, 14, 47).getTime() / 1000
    expect(formatClockTime(epochSec)).toBe('14:47')
  })

  it('returns an empty string when the reset time is unknown or not finite', () => {
    expect(formatClockTime(null)).toBe('')
    expect(formatClockTime(Number.NaN)).toBe('')
  })
})

describe('heldChipLabel', () => {
  it('shows the count without a time when the reset is unknown', () => {
    expect(heldChipLabel(state({ sleptForQuota: ['a', 'b'] }))).toBe('2 waiting for reset')
  })

  it('appends the local reset time when it is known', () => {
    const epochSec = new Date(2026, 9, 22, 14, 5).getTime() / 1000
    expect(heldChipLabel(state({ sleptForQuota: ['a'], stoppedAtLimit: ['b'], resetsAt: epochSec }))).toBe(
      '2 waiting for reset · 14:05'
    )
  })

  it('counts a session that is both slept and stopped once', () => {
    expect(heldChipLabel(state({ sleptForQuota: ['a'], stoppedAtLimit: ['a'] }))).toBe('1 waiting for reset')
  })
})

describe('heldTooltipLines', () => {
  it('lists the slept and the stopped sessions on their own lines', () => {
    expect(heldTooltipLines(state({ sleptForQuota: ['a', 'b'], stoppedAtLimit: ['c'] }))).toEqual([
      'Slept for quota: a, b.',
      'Stopped at the limit: c.'
    ])
  })

  it('leaves out an empty group', () => {
    expect(heldTooltipLines(state({ stoppedAtLimit: ['c'] }))).toEqual(['Stopped at the limit: c.'])
  })

  it('is empty when nothing is held', () => {
    expect(heldTooltipLines(state())).toEqual([])
  })
})
