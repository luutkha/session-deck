import type { QuotaAlert } from '../../shared/types'

export interface QuotaNotice {
  readonly title: string
  readonly body: string
}

const WINDOW_LABEL: Readonly<Record<QuotaAlert['window'], string>> = {
  fiveHour: '5-hour window',
  sevenDay: 'Weekly window'
}

const RESET_TITLE = 'Quota reset'

function defaultClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function sessionsWord(count: number): string {
  return count === 1 ? 'session' : 'sessions'
}

/** Body for a reset alert that carries sessions: woken by the autopilot, or waiting for the user to wake them. */
function sessionResetBody(alert: QuotaAlert, count: number): string {
  if (alert.autoAction === 'woke') return `Woke ${count} ${sessionsWord(count)}.`
  if (count === 1) return '1 session is waiting. Open SessionDeck to wake it.'
  return `${count} sessions are waiting. Open SessionDeck to wake them.`
}

function resetNotice(alert: QuotaAlert, label: string, resetAt: string): QuotaNotice {
  const count = alert.sessionIds?.length ?? 0
  if (count > 0) return { title: RESET_TITLE, body: sessionResetBody(alert, count) }
  return {
    title: 'Claude usage window reset',
    body: resetAt === '' ? `${label} has reset` : `${label} has reset; next reset at ${resetAt}`
  }
}

/** Title and body of the desktop notification for a quota alert. */
export function quotaNotice(alert: QuotaAlert, clock: (epochSec: number) => string = defaultClock): QuotaNotice {
  const label = WINDOW_LABEL[alert.window]
  const percent = Math.round(alert.percent)
  const resetAt = alert.resetsAt === null ? '' : clock(alert.resetsAt)

  if (alert.kind === 'reset') return resetNotice(alert, label, resetAt)

  const title = alert.kind === 'critical' ? `Claude usage critical ${percent}%` : `Claude usage ${percent}%`
  const slept = alert.autoAction === 'slept' ? (alert.sessionIds?.length ?? 0) : 0
  if (slept > 0) {
    return { title, body: `Slept ${slept} idle ${sessionsWord(slept)} until the reset.` }
  }
  const body = resetAt === ''
    ? `${label}: ${percent}% used`
    : `${label}: ${percent}% used, resets at ${resetAt}`
  return { title, body }
}
