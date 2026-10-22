// Pure text for the Activity list and the "While you were away" summary. No React, no DOM, no IPC.
// Dates use the local clock with manual formatting so the output does not depend on the locale.
import type { AwaySessionSummary, AwaySummary, TimelineTurn } from '../../shared/types'

const SECOND_MS = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const CENT_USD = 0.01
const PLACEHOLDER_PROMPT = '(prompt not recorded)'
const PART_SEPARATOR = ' · '
const MONTHS: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value)
}

/** Collapses every run of whitespace (newlines included) to one space. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The prompt on one line, or a placeholder when none was recorded. */
export function promptText(turn: TimelineTurn): string {
  const text = singleLine(turn.prompt)
  return text === '' ? PLACEHOLDER_PROMPT : text
}

/** A turn with no end time is still running. */
export function isTurnRunning(turn: TimelineTurn): boolean {
  return turn.endedAt === null
}

export function turnEndLabel(turn: TimelineTurn): string {
  switch (turn.end) {
    case null:
      return 'Running'
    case 'finished':
      return turn.neededYou ? 'Finished · needed you' : 'Finished'
    case 'limit':
      return 'Stopped at the usage limit'
    case 'slept':
      return 'Put to sleep'
    case 'closed':
      return 'Closed'
    case 'exited':
      return 'Stopped'
  }
}

/** 42s, 3m 05s, 1h 07m. Negative or non-finite input reads as 0s. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const totalSeconds = Math.floor(ms / SECOND_MS)
  if (totalSeconds < SECONDS_PER_MINUTE) return `${String(totalSeconds)}s`
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${String(totalMinutes)}m ${pad2(totalSeconds % SECONDS_PER_MINUTE)}s`
  }
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  return `${String(hours)}h ${pad2(totalMinutes % MINUTES_PER_HOUR)}m`
}

/** null or non-finite = no cost (''); under one cent = '<$0.01'; otherwise '$0.40'. */
export function formatCost(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return ''
  if (usd < CENT_USD) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function clockOf(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dayBefore(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)
}

/** Today: 'HH:MM'. Yesterday: 'Yesterday HH:MM'. Older: 'D Mon HH:MM' (e.g. '3 Oct 14:05'). */
export function formatTurnTime(ms: number, nowMs: number): string {
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return ''
  const at = new Date(ms)
  const now = new Date(nowMs)
  if (isSameDay(at, now)) return clockOf(at)
  if (isSameDay(at, dayBefore(now))) return `Yesterday ${clockOf(at)}`
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''} ${clockOf(at)}`
}

/** One Activity row, line 2: "14:05 · 3m 05s · Finished · $0.12". */
export function turnMeta(turn: TimelineTurn, nowMs: number): string {
  const duration = formatDuration((turn.endedAt ?? nowMs) - turn.startedAt)
  const parts = [formatTurnTime(turn.startedAt, nowMs), duration, turnEndLabel(turn)]
  const cost = formatCost(turn.costUsd)
  if (cost !== '') parts.push(cost)
  return parts.join(PART_SEPARATOR)
}

function needsYouPhrase(count: number): string {
  return count === 1 ? '1 needs you' : `${String(count)} need you`
}

function nonNull(part: string | null): part is string {
  return part !== null
}

/** Totals for the whole away window, e.g. '2 finished · 1 needs you · $0.40'. */
function totalParts(totals: AwaySummary['totals']): readonly string[] {
  return [
    totals.finished > 0 ? `${String(totals.finished)} finished` : null,
    totals.needsYou > 0 ? needsYouPhrase(totals.needsYou) : null,
    totals.slept > 0 ? `${String(totals.slept)} put to sleep` : null,
    totals.hitLimit > 0 ? `${String(totals.hitLimit)} hit the limit` : null,
    totals.costUsd > 0 ? formatCost(totals.costUsd) : null
  ].filter(nonNull)
}

/** Dialog description: 'Away 1h 07m · 2 finished · 1 needs you · $0.40'. */
export function awayHeadline(summary: AwaySummary): string {
  const head = `Away ${formatDuration(summary.until - summary.since)}`
  const parts = totalParts(summary.totals)
  return parts.length === 0 ? head : `${head}${PART_SEPARATOR}${parts.join(PART_SEPARATOR)}`
}

/** One session row: '2 finished · needs you · put to sleep · $0.40'. */
export function awayRowDetail(session: AwaySessionSummary): string {
  const parts = [
    session.finished > 0 ? `${String(session.finished)} finished` : null,
    session.needsYou ? 'needs you' : null,
    session.slept ? 'put to sleep' : null,
    session.hitLimit ? 'hit the limit' : null,
    session.costUsd !== null && session.costUsd > 0 ? formatCost(session.costUsd) : null
  ].filter(nonNull)
  return parts.join(PART_SEPARATOR)
}
