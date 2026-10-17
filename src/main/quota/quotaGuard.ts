import type { AccountUsage, QuotaAlert, QuotaSettings, UsageState, UsageWindow } from '../../shared/types'

export type QuotaWindowKey = 'fiveHour' | 'sevenDay'
export type QuotaLevel = 'none' | 'warn' | 'critical'

/** What has already been alerted for one window instance (identified by resetsAt). */
export interface QuotaMarker {
  readonly resetsAt: number | null
  readonly level: QuotaLevel
  readonly percent: number
}

export type QuotaMarkers = Readonly<Record<QuotaWindowKey, QuotaMarker>>

export interface QuotaEvaluation {
  readonly alerts: readonly QuotaAlert[]
  readonly markers: QuotaMarkers
}

export interface QuotaEvaluationInput {
  readonly settings: QuotaSettings
  readonly account: AccountUsage | null
  readonly markers: QuotaMarkers
  /** Epoch seconds, to recognise a window that has already ended. */
  readonly nowSec: number
}

export const EMPTY_QUOTA_MARKER: QuotaMarker = { resetsAt: null, level: 'none', percent: 0 }

export function emptyQuotaMarkers(): QuotaMarkers {
  return { fiveHour: EMPTY_QUOTA_MARKER, sevenDay: EMPTY_QUOTA_MARKER }
}

const WINDOW_KEYS: readonly QuotaWindowKey[] = ['fiveHour', 'sevenDay']

function sameMarker(a: QuotaMarker, b: QuotaMarker): boolean {
  return a.resetsAt === b.resetsAt && a.level === b.level && a.percent === b.percent
}

function usablePercent(window: UsageWindow | null): number | null {
  if (window === null || window === undefined) return null
  const value: unknown = window.usedPercentage
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

interface WindowStep {
  readonly alerts: readonly QuotaAlert[]
  readonly marker: QuotaMarker
}

/** Whether the previous marker had something to report (so a reset is news, not noise). */
function hadAlertState(prev: QuotaMarker, settings: QuotaSettings): boolean {
  return prev.level !== 'none' || prev.percent >= settings.warnAtPercent
}

function resetAlert(key: QuotaWindowKey, percent: number, resetsAt: number | null): QuotaAlert {
  return { window: key, kind: 'reset', percent, resetsAt }
}

function evaluateWindow(
  key: QuotaWindowKey,
  prev: QuotaMarker,
  window: UsageWindow | null,
  input: QuotaEvaluationInput
): WindowStep {
  const { settings, nowSec } = input
  const percent = usablePercent(window)
  if (window === null || percent === null) {
    return { alerts: [], marker: prev }
  }
  const resetsAt = window.resetsAt
  // The window has already ended: its percentage is history, not a threshold to report.
  if (resetsAt !== null && resetsAt <= nowSec) {
    return { alerts: [], marker: prev }
  }

  const reportable: QuotaAlert[] = []
  let base: QuotaMarker = prev

  if (prev.resetsAt !== resetsAt) {
    // A new window instance began.
    if (hadAlertState(prev, settings) && settings.notifyOnReset) {
      reportable.push(resetAlert(key, percent, resetsAt))
    }
    base = { resetsAt, level: 'none', percent: 0 }
  } else if (percent < settings.warnAtPercent && prev.percent > percent) {
    // Same window, but usage fell back below the warn line after a larger value.
    if (hadAlertState(prev, settings) && settings.notifyOnReset) {
      reportable.push(resetAlert(key, percent, resetsAt))
    }
    base = { resetsAt, level: 'none', percent }
  }

  let level = base.level
  const alerts: QuotaAlert[] = [...reportable]
  if (percent >= settings.criticalAtPercent) {
    if (level !== 'critical') {
      alerts.push({ window: key, kind: 'critical', percent, resetsAt })
      level = 'critical'
    }
  } else if (percent >= settings.warnAtPercent && level === 'none') {
    alerts.push({ window: key, kind: 'warn', percent, resetsAt })
    level = 'warn'
  }

  return {
    alerts: settings.enabled ? alerts : [],
    marker: { resetsAt, level, percent }
  }
}

/**
 * Pure quota evaluation. Returns the alerts to deliver and the markers to remember. The markers are tracked even
 * when quota alerts are disabled, so enabling them later does not announce thresholds that were already crossed.
 * Returns the very same markers object when nothing changed.
 */
export function evaluateQuota(input: QuotaEvaluationInput): QuotaEvaluation {
  const alerts: QuotaAlert[] = []
  const next: Partial<Record<QuotaWindowKey, QuotaMarker>> = {}
  let changed = false

  for (const key of WINDOW_KEYS) {
    const prev = input.markers[key]
    const window = input.account === null ? null : input.account[key]
    const step = evaluateWindow(key, prev, window, input)
    alerts.push(...step.alerts)
    next[key] = step.marker
    if (!sameMarker(prev, step.marker)) {
      changed = true
    }
  }

  if (!changed) {
    return { alerts, markers: input.markers }
  }
  return {
    alerts,
    markers: { fiveHour: next.fiveHour ?? EMPTY_QUOTA_MARKER, sevenDay: next.sevenDay ?? EMPTY_QUOTA_MARKER }
  }
}

export interface QuotaUsageSource {
  onChange(callback: (state: UsageState) => void): () => void
}

export interface QuotaGuardDeps {
  readonly usage: QuotaUsageSource
  readonly getSettings: () => QuotaSettings
  readonly notify: (alert: QuotaAlert) => void
  /** Epoch milliseconds. */
  readonly now: () => number
  readonly loadMarkers: () => QuotaMarkers
  readonly saveMarkers: (markers: QuotaMarkers) => void
  readonly onError?: (where: string, error: unknown) => void
}

export interface QuotaGuard {
  stop(): void
  markers(): QuotaMarkers
}

/** Watches usage changes, evaluates the thresholds and delivers alerts. Markers are saved only when they change. */
export function createQuotaGuard(deps: QuotaGuardDeps): QuotaGuard {
  const { usage, getSettings, notify, now, saveMarkers, onError } = deps
  let markers: QuotaMarkers = deps.loadMarkers()

  const report = (where: string, error: unknown): void => {
    onError?.(where, error)
  }

  const unsubscribe = usage.onChange((state: UsageState) => {
    const result = evaluateQuota({
      settings: getSettings(),
      account: state.account,
      markers,
      nowSec: Math.floor(now() / 1000)
    })
    if (result.markers !== markers) {
      markers = result.markers
      try {
        // Saved before the alerts go out, so a crash cannot make the same alert fire twice.
        saveMarkers(markers)
      } catch (error) {
        report('quota markers save', error)
      }
    }
    for (const alert of result.alerts) {
      try {
        notify(alert)
      } catch (error) {
        report('quota notify', error)
      }
    }
  })

  return {
    stop(): void {
      unsubscribe()
    },
    markers(): QuotaMarkers {
      return markers
    }
  }
}
