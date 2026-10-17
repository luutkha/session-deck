import type { QuotaAlert } from '../../shared/types'
import { formatPercent, formatResetsIn } from './usageLogic'

export type QuotaToastTone = 'warn' | 'critical' | 'ok'

export interface QuotaToastDescription {
  readonly title: string
  readonly detail: string
  readonly tone: QuotaToastTone
}

function windowLabel(window: QuotaAlert['window']): string {
  return window === 'fiveHour' ? '5-hour' : 'Weekly'
}

/**
 * Human copy for an in-app quota toast. `detail` carries the reset countdown
 * for a reset alert (empty otherwise), and `tone` selects the toast colours.
 */
export function describeQuotaAlert(alert: QuotaAlert, nowMs: number): QuotaToastDescription {
  const label = windowLabel(alert.window)
  switch (alert.kind) {
    case 'warn':
      return { title: `${label} usage is at ${formatPercent(alert.percent)}`, detail: '', tone: 'warn' }
    case 'critical':
      return {
        title: `${label} usage is at ${formatPercent(alert.percent)}, critical`,
        detail: '',
        tone: 'critical'
      }
    case 'reset':
      return {
        title: `${label} window reset`,
        detail: formatResetsIn(nowMs, alert.resetsAt),
        tone: 'ok'
      }
  }
}
