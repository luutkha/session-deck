import { describe, expect, it } from 'vitest'
import {
  QUOTA_CRITICAL_MAX,
  QUOTA_CRITICAL_MIN,
  QUOTA_WARN_MAX,
  QUOTA_WARN_MIN,
  validateQuotaThresholds
} from './quotaValidation'

describe('validateQuotaThresholds', () => {
  it('accepts the defaults (80 / 95)', () => {
    const result = validateQuotaThresholds(80, 95)
    expect(result.valid).toBe(true)
    expect(result.warnError).toBeNull()
    expect(result.criticalError).toBeNull()
  })

  it('accepts the boundary values', () => {
    expect(validateQuotaThresholds(QUOTA_WARN_MIN, QUOTA_CRITICAL_MIN).valid).toBe(true)
    expect(validateQuotaThresholds(QUOTA_WARN_MAX, QUOTA_CRITICAL_MAX).valid).toBe(true)
  })

  it('rejects a warn value below the minimum or above the maximum', () => {
    expect(validateQuotaThresholds(0, 95).valid).toBe(false)
    expect(validateQuotaThresholds(0, 95).warnError).not.toBeNull()
    expect(validateQuotaThresholds(100, 100).warnError).not.toBeNull()
  })

  it('rejects a non-integer warn value', () => {
    const result = validateQuotaThresholds(80.5, 95)
    expect(result.valid).toBe(false)
    expect(result.warnError).not.toBeNull()
  })

  it('rejects NaN input', () => {
    expect(validateQuotaThresholds(Number.NaN, 95).warnError).not.toBeNull()
    expect(validateQuotaThresholds(80, Number.NaN).criticalError).not.toBeNull()
  })

  it('rejects a critical value out of range', () => {
    expect(validateQuotaThresholds(80, 1).criticalError).not.toBeNull()
    expect(validateQuotaThresholds(80, 101).criticalError).not.toBeNull()
  })

  it('requires critical to be strictly greater than warn', () => {
    const equal = validateQuotaThresholds(80, 80)
    expect(equal.valid).toBe(false)
    expect(equal.criticalError).not.toBeNull()

    const less = validateQuotaThresholds(90, 85)
    expect(less.valid).toBe(false)
    expect(less.criticalError).not.toBeNull()
  })

  it('reports the warn error even when critical is also invalid', () => {
    const result = validateQuotaThresholds(0, 0)
    expect(result.valid).toBe(false)
    expect(result.warnError).not.toBeNull()
    expect(result.criticalError).not.toBeNull()
  })
})
