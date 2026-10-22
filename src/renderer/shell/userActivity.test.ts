import { describe, expect, it } from 'vitest'
import { USER_ACTIVITY_THROTTLE_MS, shouldReport } from './userActivity'

const SENT_AT = 1_000_000

describe('shouldReport', () => {
  it('reports when nothing has been sent yet', () => {
    expect(shouldReport(null, SENT_AT)).toBe(true)
  })

  it('does not report again inside the throttle window', () => {
    expect(shouldReport(SENT_AT, SENT_AT)).toBe(false)
    expect(shouldReport(SENT_AT, SENT_AT + USER_ACTIVITY_THROTTLE_MS - 1)).toBe(false)
  })

  it('reports again exactly when the throttle window has elapsed', () => {
    expect(shouldReport(SENT_AT, SENT_AT + USER_ACTIVITY_THROTTLE_MS)).toBe(true)
  })

  it('reports after the throttle window has elapsed', () => {
    expect(shouldReport(SENT_AT, SENT_AT + USER_ACTIVITY_THROTTLE_MS + 5_000)).toBe(true)
  })

  it('reports when the clock went backwards, so a stale timestamp cannot block reports forever', () => {
    expect(shouldReport(SENT_AT, SENT_AT - 1)).toBe(true)
  })

  it('uses a 15 second throttle', () => {
    expect(USER_ACTIVITY_THROTTLE_MS).toBe(15_000)
  })
})
