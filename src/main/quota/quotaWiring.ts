import type { QuotaAlert, QuotaSettings } from '../../shared/types'
import { createQuotaGuard, type QuotaGuard, type QuotaUsageSource } from './quotaGuard'
import { loadQuotaMarkers, saveQuotaMarkers } from './quotaMarkers'
import { quotaNotice } from './quotaNotice'

/** Everything needed to show one alert: toast, sound and desktop notice. */
export interface QuotaDeliveryDeps {
  /** Sends the alert to the renderer (in-app toast). */
  readonly sendAlert: (alert: QuotaAlert) => void
  /** Plays the quota sound (called for warn and critical only). */
  readonly playSound: () => void
  readonly notifyApp: (title: string, body: string) => void
  readonly onError: (where: string, error: unknown) => void
}

/** The quota autopilot's hook: called for every guard alert before delivery. */
export interface QuotaAlertHook {
  onAlert(alert: QuotaAlert): QuotaAlert | null
}

export interface QuotaWiringDeps extends QuotaDeliveryDeps {
  readonly usage: QuotaUsageSource
  readonly getSettings: () => QuotaSettings
  readonly markersFile: string
  /** Epoch milliseconds. */
  readonly now: () => number
  /** Optional (D30): decides what each guard alert becomes; null drops it. */
  readonly autopilot?: QuotaAlertHook
}

function attemptWith(onError: (where: string, error: unknown) => void, where: string, action: () => void): void {
  try {
    action()
  } catch (error) {
    onError(where, error)
  }
}

/** Shows one alert: toast, sound (not for resets) and desktop notification. Each part is attempted on its own. */
export function deliverQuotaAlert(deps: QuotaDeliveryDeps, alert: QuotaAlert): void {
  attemptWith(deps.onError, 'quota toast', () => deps.sendAlert(alert))
  if (alert.kind !== 'reset') {
    attemptWith(deps.onError, 'quota sound', () => deps.playSound())
  }
  const notice = quotaNotice(alert)
  attemptWith(deps.onError, 'quota notification', () => deps.notifyApp(notice.title, notice.body))
}

/** The alert to deliver: the autopilot's decision, or the original alert when the autopilot fails. Null = drop. */
function decide(deps: QuotaWiringDeps, alert: QuotaAlert): QuotaAlert | null {
  if (deps.autopilot === undefined) return alert
  try {
    return deps.autopilot.onAlert(alert)
  } catch (error) {
    deps.onError('quota autopilot', error)
    return alert
  }
}

/** Starts the quota guard and delivers each alert (after the autopilot has had its say). */
export function startQuotaWiring(deps: QuotaWiringDeps): QuotaGuard {
  return createQuotaGuard({
    usage: deps.usage,
    getSettings: deps.getSettings,
    now: deps.now,
    loadMarkers: () => loadQuotaMarkers(deps.markersFile),
    saveMarkers: (markers) => saveQuotaMarkers(deps.markersFile, markers),
    onError: deps.onError,
    notify: (alert: QuotaAlert) => {
      const delivered = decide(deps, alert)
      if (delivered !== null) deliverQuotaAlert(deps, delivered)
    }
  })
}
