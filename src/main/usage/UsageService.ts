import type { AccountUsage, SessionUsage, UsageState, UsageWindow } from '../../shared/types'
import { parseStatusLine, type ParsedAccountWindows } from './statusLineParser'

export interface UsageServiceDeps {
  readonly now?: () => number
}

export interface UsageService {
  /** Records one statusLine payload for a session. Garbage payloads are ignored. */
  ingest(sessionId: string, payload: unknown): void
  /**
   * Sets account windows from a manual refresh. ALWAYS stamps updatedAt = now and notifies, even when the numbers
   * are identical: an explicit refresh is a freshness signal (clears "stale", lets the UI show it worked).
   */
  ingestAccount(account: ParsedAccountWindows): void
  /** Drops a session's entry (e.g. when the session is removed). */
  forget(sessionId: string): void
  getState(): UsageState
  /** Calls back only when the state actually changed. Returns the unsubscribe function. */
  onChange(callback: (state: UsageState) => void): () => void
}

const EMPTY_STATE: UsageState = { account: null, sessions: [] }

function sameWindow(a: UsageWindow | null, b: UsageWindow | null): boolean {
  if (a === null || b === null) return a === b
  return a.usedPercentage === b.usedPercentage && a.resetsAt === b.resetsAt
}

/** Compares the windows only; updatedAt is bookkeeping, not a change. */
function sameAccountWindows(a: ParsedAccountWindows, b: ParsedAccountWindows): boolean {
  return sameWindow(a.fiveHour, b.fiveHour) && sameWindow(a.sevenDay, b.sevenDay)
}

function sameSessionData(a: SessionUsage, b: SessionUsage): boolean {
  return (
    a.model === b.model &&
    a.contextPercent === b.contextPercent &&
    a.costUsd === b.costUsd &&
    a.effort === b.effort
  )
}

function hasSessionData(session: Omit<SessionUsage, 'sessionId'>): boolean {
  return session.model !== null || session.contextPercent !== null || session.costUsd !== null || session.effort !== null
}

function byId(a: SessionUsage, b: SessionUsage): number {
  if (a.sessionId < b.sessionId) return -1
  if (a.sessionId > b.sessionId) return 1
  return 0
}

/** Returns the same list when nothing changed, so callers can compare references. */
function upsertSession(list: readonly SessionUsage[], entry: SessionUsage): readonly SessionUsage[] {
  const previous = list.find((s) => s.sessionId === entry.sessionId)
  if (previous && sameSessionData(previous, entry)) {
    return list
  }
  return [...list.filter((s) => s.sessionId !== entry.sessionId), entry].sort(byId)
}

export function createUsageService(deps: UsageServiceDeps = {}): UsageService {
  const now = deps.now ?? (() => Date.now())
  let state: UsageState = EMPTY_STATE
  const subscribers = new Set<(state: UsageState) => void>()

  function commit(account: AccountUsage | null, sessions: readonly SessionUsage[]): void {
    if (account === state.account && sessions === state.sessions) return
    state = { account, sessions }
    for (const callback of subscribers) {
      callback(state)
    }
  }

  return {
    ingest(sessionId: string, payload: unknown): void {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return

      const timestamp = now()
      const parsed = parseStatusLine(payload, timestamp)

      let account = state.account
      if (parsed.account !== null && (account === null || !sameAccountWindows(account, parsed.account))) {
        account = { fiveHour: parsed.account.fiveHour, sevenDay: parsed.account.sevenDay, updatedAt: timestamp }
      }

      const sessions = hasSessionData(parsed.session)
        ? upsertSession(state.sessions, { sessionId, ...parsed.session })
        : state.sessions

      commit(account, sessions)
    },

    ingestAccount(account: ParsedAccountWindows): void {
      const timestamp = now()
      commit({ fiveHour: account.fiveHour, sevenDay: account.sevenDay, updatedAt: timestamp }, state.sessions)
    },

    forget(sessionId: string): void {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return
      commit(state.account, state.sessions.filter((s) => s.sessionId !== sessionId))
    },

    getState(): UsageState {
      return state
    },

    onChange(callback: (state: UsageState) => void): () => void {
      subscribers.add(callback)
      return () => {
        subscribers.delete(callback)
      }
    }
  }
}
