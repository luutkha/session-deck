import type { QuotaAlert } from '../../shared/types'
import { formatPercent, formatResetsIn } from './usageLogic'

export type QuotaToastTone = 'warn' | 'critical' | 'ok'

export interface QuotaToastDescription {
  readonly title: string
  readonly detail: string
  readonly tone: QuotaToastTone
}

/** The session action a quota toast offers (autopilot, D30). */
export interface QuotaToastAction {
  readonly kind: 'sleep' | 'wake'
  readonly count: number
}

function windowLabel(window: QuotaAlert['window']): string {
  return window === 'fiveHour' ? '5-hour' : 'Weekly'
}

/** "session" for 1, "sessions" otherwise. */
export function sessionWord(count: number): string {
  return count === 1 ? 'session' : 'sessions'
}

function sessionCountOf(alert: QuotaAlert): number {
  return alert.sessionIds?.length ?? 0
}

/**
 * The action a toast offers, or null when it offers none. An alert that already carries
 * `autoAction` is an info toast (nothing left to click), and an empty list offers nothing.
 */
export function quotaToastAction(alert: QuotaAlert): QuotaToastAction | null {
  const count = sessionCountOf(alert)
  if (alert.autoAction !== undefined || count === 0) return null
  if (alert.kind === 'critical') return { kind: 'sleep', count }
  if (alert.kind === 'reset') return { kind: 'wake', count }
  return null
}

function describeSlept(count: number): string {
  if (count === 0) return 'No idle sessions were slept.'
  return `Slept ${String(count)} idle ${sessionWord(count)} until the reset.`
}

function describeWoke(count: number): string {
  if (count === 0) return 'No sessions were woken.'
  return `Woke ${String(count)} ${sessionWord(count)}.`
}

function describeCritical(alert: QuotaAlert, title: string): QuotaToastDescription {
  const detail = alert.autoAction === 'slept' ? describeSlept(sessionCountOf(alert)) : ''
  return { title, detail, tone: 'critical' }
}

function describeReset(alert: QuotaAlert, label: string, nowMs: number): QuotaToastDescription {
  if (alert.autoAction === 'woke') {
    return { title: `${label} quota reset`, detail: describeWoke(sessionCountOf(alert)), tone: 'ok' }
  }
  const count = sessionCountOf(alert)
  if (quotaToastAction(alert) !== null) {
    return {
      title: `${label} window reset`,
      detail: `${String(count)} ${sessionWord(count)} waiting for the reset.`,
      tone: 'ok'
    }
  }
  return {
    title: `${label} window reset`,
    detail: formatResetsIn(nowMs, alert.resetsAt),
    tone: 'ok'
  }
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
      return describeCritical(alert, `${label} usage is at ${formatPercent(alert.percent)}, critical`)
    case 'reset':
      return describeReset(alert, label, nowMs)
  }
}
