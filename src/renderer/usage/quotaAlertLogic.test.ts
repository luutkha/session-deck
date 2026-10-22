import { describe, expect, it } from 'vitest'
import type { QuotaAlert } from '../../shared/types'
import { describeQuotaAlert, quotaToastAction, sessionWord } from './quotaAlertLogic'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

function alert(overrides: Partial<QuotaAlert> = {}): QuotaAlert {
  return { window: 'fiveHour', kind: 'warn', percent: 82, resetsAt: null, ...overrides }
}

describe('describeQuotaAlert', () => {
  const now = 1_000_000_000

  it('describes a 5-hour warning', () => {
    expect(describeQuotaAlert(alert({ window: 'fiveHour', kind: 'warn', percent: 82 }), now)).toEqual({
      title: '5-hour usage is at 82%',
      detail: '',
      tone: 'warn'
    })
  })

  it('describes a weekly warning', () => {
    expect(describeQuotaAlert(alert({ window: 'sevenDay', kind: 'warn', percent: 61 }), now)).toEqual({
      title: 'Weekly usage is at 61%',
      detail: '',
      tone: 'warn'
    })
  })

  it('describes a 5-hour critical alert', () => {
    expect(describeQuotaAlert(alert({ window: 'fiveHour', kind: 'critical', percent: 96 }), now)).toEqual({
      title: '5-hour usage is at 96%, critical',
      detail: '',
      tone: 'critical'
    })
  })

  it('describes a weekly critical alert', () => {
    expect(describeQuotaAlert(alert({ window: 'sevenDay', kind: 'critical', percent: 96 }), now)).toEqual({
      title: 'Weekly usage is at 96%, critical',
      detail: '',
      tone: 'critical'
    })
  })

  it('describes a reset with a countdown when resetsAt is known', () => {
    const resetsAt = (now + 2 * HOUR + 10 * MINUTE) / SECOND
    expect(describeQuotaAlert(alert({ kind: 'reset', resetsAt }), now)).toEqual({
      title: '5-hour window reset',
      detail: 'resets in 2h 10m',
      tone: 'ok'
    })
  })

  it('describes a weekly reset with no detail when resetsAt is missing', () => {
    expect(describeQuotaAlert(alert({ window: 'sevenDay', kind: 'reset', resetsAt: null }), now)).toEqual({
      title: 'Weekly window reset',
      detail: '',
      tone: 'ok'
    })
  })

  it('rounds and clamps the percent', () => {
    expect(describeQuotaAlert(alert({ kind: 'warn', percent: 82.6 }), now).title).toBe(
      '5-hour usage is at 83%'
    )
    expect(describeQuotaAlert(alert({ kind: 'warn', percent: 150 }), now).title).toBe(
      '5-hour usage is at 100%'
    )
  })

  it('keeps the critical title and reports the slept count once sessions were slept', () => {
    expect(
      describeQuotaAlert(alert({ kind: 'critical', percent: 96, autoAction: 'slept', sessionIds: ['a', 'b'] }), now)
    ).toEqual({
      title: '5-hour usage is at 96%, critical',
      detail: 'Slept 2 idle sessions until the reset.',
      tone: 'critical'
    })
  })

  it('uses the singular for one slept session', () => {
    expect(
      describeQuotaAlert(alert({ kind: 'critical', percent: 96, autoAction: 'slept', sessionIds: ['a'] }), now).detail
    ).toBe('Slept 1 idle session until the reset.')
  })

  it('says so when the autopilot slept nobody', () => {
    expect(
      describeQuotaAlert(alert({ kind: 'critical', percent: 96, autoAction: 'slept', sessionIds: [] }), now).detail
    ).toBe('No idle sessions were slept.')
  })

  it('offers the wake action on a reset with waiting sessions instead of the countdown', () => {
    const resetsAt = (now + 2 * HOUR) / SECOND
    expect(describeQuotaAlert(alert({ kind: 'reset', resetsAt, sessionIds: ['a', 'b', 'c'] }), now)).toEqual({
      title: '5-hour window reset',
      detail: '3 sessions waiting for the reset.',
      tone: 'ok'
    })
  })

  it('uses the singular for one session waiting for the reset', () => {
    expect(describeQuotaAlert(alert({ kind: 'reset', sessionIds: ['a'] }), now).detail).toBe(
      '1 session waiting for the reset.'
    )
  })

  it('describes a woken reset with the woken count', () => {
    expect(describeQuotaAlert(alert({ kind: 'reset', autoAction: 'woke', sessionIds: ['a', 'b'] }), now)).toEqual({
      title: '5-hour quota reset',
      detail: 'Woke 2 sessions.',
      tone: 'ok'
    })
  })

  it('says so when the autopilot woke nobody', () => {
    expect(describeQuotaAlert(alert({ kind: 'reset', autoAction: 'woke', sessionIds: [] }), now).detail).toBe(
      'No sessions were woken.'
    )
  })

  it('treats a warning with session ids as a plain warning (no session action)', () => {
    expect(describeQuotaAlert(alert({ kind: 'warn', percent: 85, sessionIds: ['a'] }), now)).toEqual({
      title: '5-hour usage is at 85%',
      detail: '',
      tone: 'warn'
    })
  })
})

describe('sessionWord', () => {
  it('uses the singular only for exactly one session', () => {
    expect(sessionWord(0)).toBe('sessions')
    expect(sessionWord(1)).toBe('session')
    expect(sessionWord(2)).toBe('sessions')
  })
})

describe('quotaToastAction', () => {
  it('offers sleep on a critical alert with idle sessions and no autoAction', () => {
    expect(quotaToastAction(alert({ kind: 'critical', percent: 96, sessionIds: ['a', 'b'] }))).toEqual({
      kind: 'sleep',
      count: 2
    })
  })

  it('offers wake on a reset alert with waiting sessions and no autoAction', () => {
    expect(quotaToastAction(alert({ kind: 'reset', sessionIds: ['a'] }))).toEqual({ kind: 'wake', count: 1 })
  })

  it('offers nothing when sessionIds is absent', () => {
    expect(quotaToastAction(alert({ kind: 'critical', percent: 96 }))).toBeNull()
    expect(quotaToastAction(alert({ kind: 'reset' }))).toBeNull()
  })

  it('offers nothing when sessionIds is empty', () => {
    expect(quotaToastAction(alert({ kind: 'critical', percent: 96, sessionIds: [] }))).toBeNull()
    expect(quotaToastAction(alert({ kind: 'reset', sessionIds: [] }))).toBeNull()
  })

  it('offers nothing once the autopilot already acted (autoAction present)', () => {
    expect(
      quotaToastAction(alert({ kind: 'critical', percent: 96, autoAction: 'slept', sessionIds: ['a'] }))
    ).toBeNull()
    expect(quotaToastAction(alert({ kind: 'reset', autoAction: 'woke', sessionIds: ['a'] }))).toBeNull()
  })

  it('offers nothing on warnings, whatever the session ids', () => {
    expect(quotaToastAction(alert({ kind: 'warn', sessionIds: ['a'] }))).toBeNull()
  })
})
