// D61: how sessions are ordered inside each sidebar section, Code worktree and Hub column. Pure, no React.
// 'manual' keeps the order the caller already built (drag order in Ops, creation order in Code).
import type { Id, RuntimeState, Session } from '../../shared/types'
import { isIdleReminder } from '../../shared/idleReminder'

export type SessionSort = 'manual' | 'attention' | 'recent' | 'newest' | 'name'

export const DEFAULT_SESSION_SORT: SessionSort = 'manual'

export const SESSION_SORT_OPTIONS: ReadonlyArray<{ readonly value: SessionSort; readonly label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'recent', label: 'Last active' },
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' }
]

const SORT_VALUES: ReadonlySet<string> = new Set(SESSION_SORT_OPTIONS.map((option): string => option.value))

/** Stored or tool-given text → a sort; anything unknown is Manual. */
export function parseSessionSort(raw: unknown): SessionSort {
  return typeof raw === 'string' && SORT_VALUES.has(raw) ? (raw as SessionSort) : DEFAULT_SESSION_SORT
}

export function sessionSortLabel(sort: SessionSort): string {
  return SESSION_SORT_OPTIONS.find((option): boolean => option.value === sort)?.label ?? 'Manual'
}

/** Last prompt / turn end / submitted line; a session never seen active counts from its creation. */
export function lastActiveOf(session: Session): number {
  return session.lastActiveAt ?? session.createdAt
}

/**
 * Rank for "Needs attention" (lower = higher in the list): 0 needs you (a bell, or Claude is asking), 1 working,
 * 2 finished, 3 running with nothing known, 4 sleeping, 5 not running (exited or never started).
 */
export function attentionRank(state: RuntimeState | undefined): number {
  if (state === undefined) return 5
  if (state.sleeping === true) return 4
  if (state.run !== 'running') return 5
  if (state.attention !== null) return 0
  if (state.activity === 'needs-input') return isIdleReminder(state.activityMessage) ? 2 : 0
  if (state.activity === 'working') return 1
  if (state.activity === 'finished') return 2
  return 3
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Returns the sessions in the chosen order (a new array; Manual returns the input as is). Ties keep the input order.
 * `frozen` (session id → position) pins a live sort while the pointer is over the list, so a card never moves
 * under a click: known sessions keep their frozen position, sessions that appeared since go after them.
 */
export function sortSessions(
  sessions: readonly Session[],
  sort: SessionSort,
  runtime: ReadonlyMap<Id, RuntimeState>,
  frozen?: ReadonlyMap<Id, number>
): readonly Session[] {
  if (sort === 'manual' || sessions.length < 2) return sessions
  const byRecent = (a: Session, b: Session): number => lastActiveOf(b) - lastActiveOf(a)
  const live: (a: Session, b: Session) => number =
    sort === 'name'
      ? (a, b): number => nameCollator.compare(a.name, b.name)
      : sort === 'newest'
        ? (a, b): number => b.createdAt - a.createdAt
        : sort === 'recent'
          ? byRecent
          : (a, b): number =>
              attentionRank(runtime.get(a.id)) - attentionRank(runtime.get(b.id)) || byRecent(a, b)
  const compare =
    frozen !== undefined && isLiveSort(sort)
      ? (a: Session, b: Session): number =>
          (frozen.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (frozen.get(b.id) ?? Number.MAX_SAFE_INTEGER) || live(a, b)
      : live
  // Array.prototype.sort is stable, so equal keys keep the manual order.
  return [...sessions].sort(compare)
}

/** Position of every session in the current sorted order: the snapshot `sortSessions` uses as `frozen`. */
export function sortPositions(
  sessions: readonly Session[],
  sort: SessionSort,
  runtime: ReadonlyMap<Id, RuntimeState>
): ReadonlyMap<Id, number> {
  return new Map(sortSessions(sessions, sort, runtime).map((session, index): [Id, number] => [session.id, index]))
}

/** True when the order must not change right now: a live sort (attention / recent) while the pointer is over the list. */
export function isLiveSort(sort: SessionSort): boolean {
  return sort === 'attention' || sort === 'recent'
}
