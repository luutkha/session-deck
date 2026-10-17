import { describe, expect, it } from 'vitest'
import type { QuotaAlert } from '../../shared/types'
import { describeQuotaAlert } from './quotaAlertLogic'

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
})
