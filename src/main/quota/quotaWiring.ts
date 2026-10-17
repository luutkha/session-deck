import type { QuotaAlert, QuotaSettings } from '../../shared/types'
import { createQuotaGuard, type QuotaGuard, type QuotaUsageSource } from './quotaGuard'
import { loadQuotaMarkers, saveQuotaMarkers } from './quotaMarkers'
import { quotaNotice } from './quotaNotice'

export interface QuotaWiringDeps {
  readonly usage: QuotaUsageSource
  readonly getSettings: () => QuotaSettings
  readonly markersFile: string
  /** Epoch milliseconds. */
  readonly now: () => number
  /** Sends the alert to the renderer (in-app toast). */
  readonly sendAlert: (alert: QuotaAlert) => void
  /** Plays the quota sound (called for warn and critical only). */
  readonly playSound: () => void
  readonly notifyApp: (title: string, body: string) => void
  readonly onError: (where: string, error: unknown) => void
}

/** Starts the quota guard and delivers each alert: toast, sound (not for resets) and desktop notification. */
export function startQuotaWiring(deps: QuotaWiringDeps): QuotaGuard {
  const attempt = (where: string, action: () => void): void => {
    try {
      action()
    } catch (error) {
      deps.onError(where, error)
    }
  }

  return createQuotaGuard({
    usage: deps.usage,
    getSettings: deps.getSettings,
    now: deps.now,
    loadMarkers: () => loadQuotaMarkers(deps.markersFile),
    saveMarkers: (markers) => saveQuotaMarkers(deps.markersFile, markers),
    onError: deps.onError,
    notify: (alert: QuotaAlert) => {
      attempt('quota toast', () => deps.sendAlert(alert))
      if (alert.kind !== 'reset') {
        attempt('quota sound', () => deps.playSound())
      }
      const notice = quotaNotice(alert)
      attempt('quota notification', () => deps.notifyApp(notice.title, notice.body))
    }
  })
}
