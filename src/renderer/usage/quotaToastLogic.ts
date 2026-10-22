import type { QuotaAlert } from '../../shared/types'
import { quotaToastAction } from './quotaAlertLogic'

/** One on-screen quota toast. `alert` becomes an info alert once its action succeeded. */
export interface QuotaToastItem {
  readonly id: number
  readonly alert: QuotaAlert
  readonly nowMs: number
  /** Wake toasts: the user's checkbox choice; absent = the saved default. */
  readonly sendContinue?: boolean
  readonly busy: boolean
  readonly error: string | null
}

/**
 * Keeps at most `max` toasts, newest last. Toasts that still offer an action are kept over
 * plain ones: the oldest plain toast goes first. Only when every toast offers an action is
 * the oldest one dropped.
 */
export function capQuotaToasts<T extends { readonly alert: QuotaAlert }>(
  items: readonly T[],
  max: number
): readonly T[] {
  let next = items
  while (next.length > max) {
    const plainIndex = next.findIndex((item) => quotaToastAction(item.alert) === null)
    const dropIndex = plainIndex === -1 ? 0 : plainIndex
    next = next.filter((_, index) => index !== dropIndex)
  }
  return next
}

/** The alert a toast turns into once its sleep action succeeded (an info toast). */
export function sleptAlert(alert: QuotaAlert, ids: readonly string[]): QuotaAlert {
  return { ...alert, autoAction: 'slept', sessionIds: ids }
}

/** The alert a toast turns into once its wake action succeeded (an info toast). */
export function wokeAlert(alert: QuotaAlert, ids: readonly string[]): QuotaAlert {
  return { ...alert, autoAction: 'woke', sessionIds: ids }
}
