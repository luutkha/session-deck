import { describe, expect, it } from 'vitest'
import type { QuotaAlert } from '../../shared/types'
import { capQuotaToasts, sleptAlert, wokeAlert, type QuotaToastItem } from './quotaToastLogic'

function alert(overrides: Partial<QuotaAlert> = {}): QuotaAlert {
  return { window: 'fiveHour', kind: 'warn', percent: 82, resetsAt: null, ...overrides }
}

function item(id: number, overrides: Partial<QuotaAlert> = {}): QuotaToastItem {
  return { id, alert: alert(overrides), nowMs: 0, busy: false, error: null }
}

const ACTION = { kind: 'critical', percent: 96, sessionIds: ['a'] } as const

describe('capQuotaToasts', () => {
  it('keeps everything while within the limit', () => {
    const items = [item(1), item(2)]
    expect(capQuotaToasts(items, 3)).toEqual(items)
  })

  it('drops the oldest plain toast first', () => {
    const items = [item(1), item(2, { kind: 'critical', percent: 96 }), item(3), item(4)]
    expect(capQuotaToasts(items, 3).map((toast) => toast.id)).toEqual([2, 3, 4])
  })

  it('keeps action toasts over a newer plain toast', () => {
    const items = [item(1, ACTION), item(2, ACTION), item(3, ACTION), item(4)]
    expect(capQuotaToasts(items, 3).map((toast) => toast.id)).toEqual([1, 2, 3])
  })

  it('drops the newest plain toast when three action toasts already fill the stack', () => {
    const items = [item(1, ACTION), item(2, ACTION), item(3, ACTION), item(4, { kind: 'reset' })]
    expect(capQuotaToasts(items, 3).map((toast) => toast.id)).toEqual([1, 2, 3])
  })

  it('drops the oldest action toast only when every toast offers an action', () => {
    const items = [item(1, ACTION), item(2, ACTION), item(3, ACTION), item(4, { kind: 'reset', sessionIds: ['z'] })]
    expect(capQuotaToasts(items, 3).map((toast) => toast.id)).toEqual([2, 3, 4])
  })

  it('treats an info toast (already acted) as plain', () => {
    const items = [item(1, { kind: 'critical', percent: 96, autoAction: 'slept', sessionIds: ['a'] }), item(2, ACTION), item(3), item(4)]
    expect(capQuotaToasts(items, 3).map((toast) => toast.id)).toEqual([2, 3, 4])
  })
})

describe('sleptAlert and wokeAlert', () => {
  it('marks the alert as slept with the ids that were slept', () => {
    expect(sleptAlert(alert({ kind: 'critical', percent: 96, sessionIds: ['a', 'b'] }), ['a'])).toEqual({
      window: 'fiveHour',
      kind: 'critical',
      percent: 96,
      resetsAt: null,
      autoAction: 'slept',
      sessionIds: ['a']
    })
  })

  it('marks the alert as woke with the ids that were woken', () => {
    expect(wokeAlert(alert({ kind: 'reset', sessionIds: ['a', 'b'] }), ['b'])).toMatchObject({
      kind: 'reset',
      autoAction: 'woke',
      sessionIds: ['b']
    })
  })
})
