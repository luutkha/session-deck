import type { Id, QuotaAutopilotState } from '../../shared/types'

const TWO_DIGITS = 2

/** Sessions the autopilot holds for the reset, each id once (slept first, then stopped at the limit). */
export function heldSessionIds(state: QuotaAutopilotState): readonly Id[] {
  return [...new Set([...state.sleptForQuota, ...state.stoppedAtLimit])]
}

/** The chip shows only while at least one session is held. */
export function isHeldVisible(state: QuotaAutopilotState): boolean {
  return state.sleptForQuota.length > 0 || state.stoppedAtLimit.length > 0
}

/** Local clock time "HH:MM" for an epoch-seconds instant; '' when null or not finite. */
export function formatClockTime(epochSec: number | null): string {
  if (epochSec === null || !Number.isFinite(epochSec)) return ''
  const date = new Date(epochSec * 1000)
  const hours = String(date.getHours()).padStart(TWO_DIGITS, '0')
  const minutes = String(date.getMinutes()).padStart(TWO_DIGITS, '0')
  return `${hours}:${minutes}`
}

/** Chip label, e.g. "3 waiting for reset" or "3 waiting for reset · 14:05". */
export function heldChipLabel(state: QuotaAutopilotState): string {
  const base = `${String(heldSessionIds(state).length)} waiting for reset`
  const clock = formatClockTime(state.resetsAt)
  return clock === '' ? base : `${base} · ${clock}`
}

/** Tooltip sentences, e.g. "Slept for quota: a, b. Stopped at the limit: c." Empty groups are left out. */
export function heldTooltipLines(state: QuotaAutopilotState): readonly string[] {
  const lines: string[] = []
  if (state.sleptForQuota.length > 0) {
    lines.push(`Slept for quota: ${state.sleptForQuota.join(', ')}.`)
  }
  if (state.stoppedAtLimit.length > 0) {
    lines.push(`Stopped at the limit: ${state.stoppedAtLimit.join(', ')}.`)
  }
  return lines
}
