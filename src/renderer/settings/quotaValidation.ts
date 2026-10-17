// Pure validation for the quota threshold inputs. No DOM; never throws.

export interface QuotaThresholdValidation {
  readonly valid: boolean
  readonly warnError: string | null
  readonly criticalError: string | null
}

export const QUOTA_WARN_MIN = 1
export const QUOTA_WARN_MAX = 99
export const QUOTA_CRITICAL_MIN = 2
export const QUOTA_CRITICAL_MAX = 100

const WARN_MESSAGE = `Enter a whole number from ${QUOTA_WARN_MIN} to ${QUOTA_WARN_MAX}.`
const CRITICAL_MESSAGE = `Enter a whole number from ${QUOTA_CRITICAL_MIN} to ${QUOTA_CRITICAL_MAX}.`
const ORDER_MESSAGE = 'Critical must be higher than the warning level.'

/**
 * Validates the two quota thresholds. `warn` must be an integer in 1..99,
 * `critical` an integer in 2..100 that is strictly greater than `warn`.
 * Both messages are `null` when the pair is valid.
 */
export function validateQuotaThresholds(warn: number, critical: number): QuotaThresholdValidation {
  const warnOk = Number.isInteger(warn) && warn >= QUOTA_WARN_MIN && warn <= QUOTA_WARN_MAX
  const warnError = warnOk ? null : WARN_MESSAGE

  const criticalInRange =
    Number.isInteger(critical) && critical >= QUOTA_CRITICAL_MIN && critical <= QUOTA_CRITICAL_MAX
  let criticalError: string | null = criticalInRange ? null : CRITICAL_MESSAGE
  if (criticalError === null && critical <= warn) {
    criticalError = ORDER_MESSAGE
  }

  return { valid: warnError === null && criticalError === null, warnError, criticalError }
}
