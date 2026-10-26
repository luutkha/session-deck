import type { AccountUsage, SessionUsage, UsageProvider, UsageState, UsageWindow } from '../../shared/types'
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
  /**
   * Shows or hides the OpenCode Go bars. Disabling drops the entry at once (the next Go payload is ignored);
   * enabling waits for the next payload. The Claude account is never affected.
   */
  setOpencodeGoEnabled(enabled: boolean): void
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
function sameAccountWindows(a: AccountUsage, b: ParsedAccountWindows): boolean {
  return (
    sameWindow(a.fiveHour, b.fiveHour) &&
    sameWindow(a.sevenDay, b.sevenDay) &&
    sameWindow(a.monthly ?? null, b.monthly ?? null)
  )
}

function hasAnyWindow(windows: ParsedAccountWindows): boolean {
  return windows.fiveHour !== null || windows.sevenDay !== null || (windows.monthly ?? null) !== null
}

function toAccount(provider: UsageProvider, windows: ParsedAccountWindows, updatedAt: number): AccountUsage {
  if (provider === 'opencode-go') {
    return { provider, fiveHour: windows.fiveHour, sevenDay: windows.sevenDay, monthly: windows.monthly ?? null, updatedAt }
  }
  return { provider, fiveHour: windows.fiveHour, sevenDay: windows.sevenDay, updatedAt }
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
  let claude: AccountUsage | null = null
  let opencodeGo: AccountUsage | null = null
  let goEnabled = true
  const subscribers = new Set<(state: UsageState) => void>()

  /** Claude first, then Go; undefined when neither has data (keeps the legacy state shape). */
  function displayAccounts(): readonly AccountUsage[] | undefined {
    const list: AccountUsage[] = []
    if (claude !== null) list.push(claude)
    if (opencodeGo !== null) list.push(opencodeGo)
    return list.length === 0 ? undefined : list
  }

  /** Element-wise identity: entries are only replaced when their windows change. */
  function sameAccounts(a: readonly AccountUsage[] | undefined, b: readonly AccountUsage[] | undefined): boolean {
    if (a === b) return true
    if (a === undefined || b === undefined || a.length !== b.length) return false
    return a.every((entry, index) => entry === b[index])
  }

  function commit(sessions: readonly SessionUsage[]): void {
    const candidate = displayAccounts()
    const accounts = sameAccounts(candidate, state.accounts) ? state.accounts : candidate
    if (claude === state.account && accounts === state.accounts && sessions === state.sessions) return
    state = accounts === undefined ? { account: claude, sessions } : { account: claude, accounts, sessions }
    for (const callback of subscribers) {
      callback(state)
    }
  }

  return {
    ingest(sessionId: string, payload: unknown): void {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return

      const timestamp = now()
      const parsed = parseStatusLine(payload, timestamp)
      const windows = parsed.account

      if (windows !== null && hasAnyWindow(windows)) {
        if (parsed.provider === 'opencode-go') {
          if (goEnabled && (opencodeGo === null || !sameAccountWindows(opencodeGo, windows))) {
            opencodeGo = toAccount('opencode-go', windows, timestamp)
          }
        } else if (claude === null || !sameAccountWindows(claude, windows)) {
          claude = toAccount('claude', windows, timestamp)
        }
      }

      const sessions = hasSessionData(parsed.session)
        ? upsertSession(state.sessions, { sessionId, ...parsed.session })
        : state.sessions

      commit(sessions)
    },

    ingestAccount(account: ParsedAccountWindows): void {
      const timestamp = now()
      claude = toAccount('claude', account, timestamp)
      commit(state.sessions)
    },

    setOpencodeGoEnabled(enabled: boolean): void {
      if (enabled === goEnabled) return
      goEnabled = enabled
      if (!enabled && opencodeGo !== null) {
        opencodeGo = null
        commit(state.sessions)
      }
    },

    forget(sessionId: string): void {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return
      commit(state.sessions.filter((s) => s.sessionId !== sessionId))
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
