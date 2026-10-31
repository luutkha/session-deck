// Cost over time (D51): daily totals and per-session sums from the timeline's per-turn costs. Pure: no React, no IPC.
// Only turns with a known cost count (TimelineTurn.costUsd null = unknown); the timeline keeps 30 days.
import type { Id, Session, TimelineTurn } from '../../shared/types'

export const CHART_DAYS = 14

export interface DayCost {
  /** Local midnight of the day (epoch ms). */
  readonly dayStart: number
  readonly total: number
  readonly turns: number
}

export interface SessionCostRow {
  readonly id: Id
  readonly name: string
  readonly today: number
  readonly week: number
  readonly month: number
  readonly turns: number
}

export interface CostTotals {
  readonly today: number
  readonly week: number
  readonly month: number
}

/** Local midnight of the day that contains `at`. */
export function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Midnight `days` local days before the day of `now` (DST-safe: calendar days, not 24 h steps). */
function daysBefore(now: number, days: number): number {
  const date = new Date(startOfDay(now))
  date.setDate(date.getDate() - days)
  return date.getTime()
}

function known(turn: TimelineTurn): turn is TimelineTurn & { readonly costUsd: number } {
  return typeof turn.costUsd === 'number' && Number.isFinite(turn.costUsd) && turn.costUsd >= 0
}

/** One entry per local day, oldest first, the last one being today. Days without cost have total 0. */
export function dailyCosts(turns: readonly TimelineTurn[], now: number, days: number = CHART_DAYS): readonly DayCost[] {
  const starts = Array.from({ length: days }, (_, i) => daysBefore(now, days - 1 - i))
  const totals = new Map<number, { total: number; turns: number }>(starts.map((start) => [start, { total: 0, turns: 0 }]))
  for (const turn of turns) {
    if (!known(turn)) continue
    const bucket = totals.get(startOfDay(turn.startedAt))
    if (bucket === undefined) continue
    bucket.total += turn.costUsd
    bucket.turns += 1
  }
  return starts.map((dayStart) => ({ dayStart, total: totals.get(dayStart)?.total ?? 0, turns: totals.get(dayStart)?.turns ?? 0 }))
}

/** Today, the last 7 days and the last 30 days (calendar days, today included). */
export function costTotals(turns: readonly TimelineTurn[], now: number): CostTotals {
  const today = startOfDay(now)
  const week = daysBefore(now, 6)
  const month = daysBefore(now, 29)
  let t = 0
  let w = 0
  let m = 0
  for (const turn of turns) {
    if (!known(turn)) continue
    if (turn.startedAt >= month) m += turn.costUsd
    if (turn.startedAt >= week) w += turn.costUsd
    if (turn.startedAt >= today) t += turn.costUsd
  }
  return { today: t, week: w, month: m }
}

/** Sessions with any known cost in the last 30 days, the most expensive first (ties: name). */
export function sessionCostRows(
  sessions: readonly Pick<Session, 'id' | 'name'>[],
  turnsBySession: ReadonlyMap<Id, readonly TimelineTurn[]>,
  now: number
): readonly SessionCostRow[] {
  const month = daysBefore(now, 29)
  const rows: SessionCostRow[] = []
  for (const session of sessions) {
    const turns = turnsBySession.get(session.id) ?? []
    const totals = costTotals(turns, now)
    const counted = turns.filter((turn) => known(turn) && turn.startedAt >= month).length
    if (counted === 0) continue
    rows.push({ id: session.id, name: session.name, ...totals, turns: counted })
  }
  return rows.sort((a, b) => b.month - a.month || a.name.localeCompare(b.name))
}

/** A short day label for the chart axis, e.g. "Oct 31". */
export function dayLabel(dayStart: number): string {
  return new Date(dayStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Rounded-up axis maximum with a readable step, so gridlines land on round dollar values. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * base >= value) return step * base
  }
  return 10 * base
}
