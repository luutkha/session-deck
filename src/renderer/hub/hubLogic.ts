import type {
  AttentionReason,
  Id,
  RuntimeState,
  Session,
  SessionRun,
  SessionUsage,
  StatusDef,
  StoreData
} from '../../shared/types'
import { isClosed, splitClosed } from '../state/selectors'
import { lastPathSegment } from '../Sidebar/uiLogic'
import { formatCost, formatPercent } from '../usage/usageLogic'

/** A Hub board column: a user status (or the synthetic "No status" bucket) and its open sessions. */
export interface HubColumn {
  readonly status: StatusDef | null
  readonly sessions: readonly Session[]
}

/** Result of dropping a card onto a column. */
export interface StatusDrop {
  readonly sessionId: Id
  readonly statusId: Id | null
}

/** Sentinel used as a React key for the "No status" column so it never collides with a real status id. */
const NO_STATUS_COLUMN_KEY = '\u0000no-status'

export function hubColumnKey(status: StatusDef | null): string {
  return status?.id ?? NO_STATUS_COLUMN_KEY
}

function effectiveStatusId(session: Session, statusIds: ReadonlySet<Id>): Id | null {
  if (session.statusId === null) return null
  return statusIds.has(session.statusId) ? session.statusId : null
}

function activityAt(session: Session, lastChange: ReadonlyMap<Id, number>): number {
  return lastChange.get(session.id) ?? session.createdAt
}

function matchesQuery(session: Session, query: string): boolean {
  if (session.name.toLowerCase().includes(query)) return true
  return lastPathSegment(session.cwd).toLowerCase().includes(query)
}

function compareByActivity(
  lastChange: ReadonlyMap<Id, number>
): (a: Session, b: Session) => number {
  return (a, b) => {
    const diff = activityAt(b, lastChange) - activityAt(a, lastChange)
    if (diff !== 0) return diff
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  }
}

/**
 * Builds the board columns. "No status" is always first (even when empty), followed by
 * every status in `data.statuses` order. Only OPEN sessions appear; a session whose
 * `statusId` points at a deleted status lands in "No status". Sessions are filtered by
 * `query` (case-insensitive name / final cwd segment) and ordered by most recent activity
 * (`lastChange`, falling back to `createdAt`) descending. Pure: never mutates `data`.
 */
export function buildColumns(
  data: StoreData,
  query: string,
  lastChange: ReadonlyMap<Id, number>
): readonly HubColumn[] {
  const statusIds = new Set<Id>(data.statuses.map((status) => status.id))
  const normalized = query.trim().toLowerCase()
  const filtering = normalized.length > 0

  const columns: { status: StatusDef | null; sessions: Session[] }[] = [
    { status: null, sessions: [] }
  ]
  const byStatus = new Map<Id, Session[]>()
  for (const status of data.statuses) {
    const sessions: Session[] = []
    byStatus.set(status.id, sessions)
    columns.push({ status, sessions })
  }

  for (const session of data.sessions) {
    if (isClosed(session)) continue
    if (filtering && !matchesQuery(session, normalized)) continue
    const key = effectiveStatusId(session, statusIds)
    if (key === null) {
      columns[0].sessions.push(session)
    } else {
      byStatus.get(key)?.push(session)
    }
  }

  const compare = compareByActivity(lastChange)
  for (const column of columns) {
    column.sessions.sort(compare)
  }

  return columns.map((column) => ({ status: column.status, sessions: column.sessions }))
}

/**
 * Decides whether dropping `sessionId` onto `targetStatusId` produces a move. Returns null
 * for an unknown or closed session, an unknown target status, or a no-op (the session already
 * has that effective status). `targetStatusId === null` means the "No status" column.
 */
export function computeStatusDrop(
  sessionId: Id,
  targetStatusId: Id | null,
  data: StoreData
): StatusDrop | null {
  const session = data.sessions.find((candidate) => candidate.id === sessionId)
  if (session === undefined || isClosed(session)) return null

  const statusIds = new Set<Id>(data.statuses.map((status) => status.id))
  if (targetStatusId !== null && !statusIds.has(targetStatusId)) return null

  if (effectiveStatusId(session, statusIds) === targetStatusId) return null
  return { sessionId, statusId: targetStatusId }
}

/**
 * Header totals for the Hub. `sessions` counts OPEN sessions (the ones the board shows);
 * `needAttention` counts open sessions whose runtime is currently flagged for attention.
 */
export function hubTotals(
  data: StoreData,
  runtime: ReadonlyMap<Id, RuntimeState>
): { readonly sessions: number; readonly needAttention: number } {
  let sessions = 0
  let needAttention = 0
  for (const session of data.sessions) {
    if (isClosed(session)) continue
    sessions += 1
    if ((runtime.get(session.id)?.attention ?? null) !== null) needAttention += 1
  }
  return { sessions, needAttention }
}

/** Closed sessions, most recently closed first. */
export function closedSessions(data: StoreData): readonly Session[] {
  return splitClosed(data).closed
}

/**
 * Sum of known session costs over OPEN sessions. Missing/unknown or
 * non-finite costs contribute nothing. Pure.
 */
export function totalCost(
  sessions: readonly Session[],
  usage: ReadonlyMap<Id, SessionUsage>
): number {
  let total = 0
  for (const session of sessions) {
    if (isClosed(session)) continue
    const cost = usage.get(session.id)?.costUsd
    if (cost !== null && cost !== undefined && Number.isFinite(cost)) total += cost
  }
  return total
}

/**
 * One-line tooltip for a Hub card's usage chip, e.g.
 * "Model: Sonnet 5.5 · Cost: $0.08 · Context: 12%". Missing parts are omitted.
 */
export function describeCardUsage(usage: SessionUsage): string {
  const parts: string[] = []
  if (usage.model !== null) parts.push(`Model: ${usage.model}`)
  if (usage.costUsd !== null) {
    const cost = formatCost(usage.costUsd)
    if (cost !== '') parts.push(`Cost: ${cost}`)
  }
  if (usage.contextPercent !== null) parts.push(`Context: ${formatPercent(usage.contextPercent)}`)
  return parts.join(' · ')
}

/**
 * The status a session actually renders under: its `statusId` when that status still exists,
 * otherwise null ("No status"). Used by the card menu to disable the current option.
 */
export function effectiveStatusIdOf(session: Session, data: StoreData): Id | null {
  const statusIds = new Set<Id>(data.statuses.map((status) => status.id))
  return effectiveStatusId(session, statusIds)
}

/** Background class for a card's attention dot, sourced from the shared attention tokens. */
export function attentionIndicatorClass(reason: AttentionReason): string {
  switch (reason) {
    case 'permission':
      return 'bg-[var(--attn-permission)]'
    case 'done':
      return 'bg-[var(--attn-done)]'
    case 'idle':
    case 'bell':
      return 'bg-[var(--attn-idle)]'
  }
}

export function attentionIndicatorLabel(reason: AttentionReason): string {
  return `Needs attention: ${reason}`
}

/** Background class for a running/exited card dot. */
export function runIndicatorClass(run: SessionRun): string {
  return run === 'running' ? 'bg-status-success' : 'bg-destructive'
}

export function runIndicatorLabel(run: SessionRun): string {
  return run === 'running' ? 'Running' : 'Exited'
}
