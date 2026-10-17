import { describe, it, expect } from 'vitest'
import { quotaNotice } from './quotaNotice'

const clock = (epochSec: number): string => `clock(${epochSec})`

describe('quotaNotice', () => {
  it('titles a warn alert with the rounded percentage', () => {
    const notice = quotaNotice({ window: 'fiveHour', kind: 'warn', percent: 82.4, resetsAt: null }, clock)
    expect(notice.title).toBe('Claude usage 82%')
  })

  it('titles a critical alert with the word critical', () => {
    const notice = quotaNotice({ window: 'sevenDay', kind: 'critical', percent: 96, resetsAt: null }, clock)
    expect(notice.title).toBe('Claude usage critical 96%')
  })

  it('titles a reset alert without a percentage', () => {
    const notice = quotaNotice({ window: 'fiveHour', kind: 'reset', percent: 3, resetsAt: null }, clock)
    expect(notice.title).toBe('Claude usage window reset')
  })

  it('names the 5-hour window', () => {
    const notice = quotaNotice({ window: 'fiveHour', kind: 'warn', percent: 85, resetsAt: null }, clock)
    expect(notice.body).toBe('5-hour window: 85% used')
  })

  it('names the weekly window', () => {
    const notice = quotaNotice({ window: 'sevenDay', kind: 'warn', percent: 85, resetsAt: null }, clock)
    expect(notice.body).toBe('Weekly window: 85% used')
  })

  it('adds the reset time when known', () => {
    const notice = quotaNotice({ window: 'fiveHour', kind: 'critical', percent: 96, resetsAt: 1_700_000_000 }, clock)
    expect(notice.body).toBe('5-hour window: 96% used, resets at clock(1700000000)')
  })

  it('says when the window reset and the next reset time', () => {
    const notice = quotaNotice({ window: 'sevenDay', kind: 'reset', percent: 2, resetsAt: 1_700_600_000 }, clock)
    expect(notice.body).toBe('Weekly window has reset; next reset at clock(1700600000)')
  })

  it('omits the reset time for a reset alert without one', () => {
    const notice = quotaNotice({ window: 'fiveHour', kind: 'reset', percent: 2, resetsAt: null }, clock)
    expect(notice.body).toBe('5-hour window has reset')
  })

  it('uses a real clock formatter by default', () => {
    const notice = quotaNotice({ window: 'fiveHour', kind: 'warn', percent: 81, resetsAt: 1_700_000_000 })
    expect(notice.body.startsWith('5-hour window: 81% used, resets at ')).toBe(true)
    expect(notice.body.length).toBeGreaterThan('5-hour window: 81% used, resets at '.length)
  })
})
