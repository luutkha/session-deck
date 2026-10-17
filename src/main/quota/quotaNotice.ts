import type { QuotaAlert } from '../../shared/types'

export interface QuotaNotice {
  readonly title: string
  readonly body: string
}

const WINDOW_LABEL: Readonly<Record<QuotaAlert['window'], string>> = {
  fiveHour: '5-hour window',
  sevenDay: 'Weekly window'
}

function defaultClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Title and body of the desktop notification for a quota alert. */
export function quotaNotice(alert: QuotaAlert, clock: (epochSec: number) => string = defaultClock): QuotaNotice {
  const label = WINDOW_LABEL[alert.window]
  const percent = Math.round(alert.percent)
  const resetAt = alert.resetsAt === null ? '' : clock(alert.resetsAt)

  if (alert.kind === 'reset') {
    return {
      title: 'Claude usage window reset',
      body: resetAt === '' ? `${label} has reset` : `${label} has reset; next reset at ${resetAt}`
    }
  }

  const title = alert.kind === 'critical' ? `Claude usage critical ${percent}%` : `Claude usage ${percent}%`
  const body = resetAt === ''
    ? `${label}: ${percent}% used`
    : `${label}: ${percent}% used, resets at ${resetAt}`
  return { title, body }
}
