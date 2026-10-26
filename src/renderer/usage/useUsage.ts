import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountUsage, UsageState } from '../../shared/types'
import {
  carriesFreshAccount,
  describeRefreshError,
  isStale,
  mergeUsageState,
  parseConsent,
  serializeConsent
} from './usageLogic'
import { parseCachedAccounts, serializeAccounts } from './usageCache'
import {
  appendSample,
  formatPace,
  paceFor,
  parseHistory,
  sampleFromWindows,
  serializeHistory,
  USAGE_HISTORY_KEY,
  type PaceSample
} from './usagePace'

/** localStorage key holding the last known account usage. */
export const USAGE_CACHE_KEY = 'sessiondeck.usage.v1'

/** localStorage key holding the one-time manual-refresh consent flag. */
export const USAGE_CONSENT_KEY = 'sessiondeck.usage.consent.v1'

/** Formatted pace hints for each plan window ("" when there is no usable pace). */
export interface UsagePace {
  readonly fiveHour: string
  readonly sevenDay: string
}

const TICK_MS = 30_000
const REFRESH_ERROR_MS = 8_000
const REFRESH_UNAVAILABLE_MESSAGE = 'Refresh is not available in this build.'

export interface UseUsageResult {
  readonly state: UsageState
  /** True while the visible account numbers come from cache and no fresh update has arrived. */
  readonly stale: boolean
  /** Monotonic-ish clock updated every 30s, driving live reset countdowns. */
  readonly now: number
  /** Manual-only: asks main for fresh usage. Never throws and never runs while already refreshing. */
  readonly refresh: () => Promise<void>
  /** True while a manual refresh request is in flight. */
  readonly refreshing: boolean
  /** Formatted, credential-free message for the last failed refresh; null when there is none. */
  readonly refreshError: string | null
  /** True once the user has allowed reading the Claude login token for a refresh. */
  readonly consented: boolean
  /** Records and persists consent for manual usage refresh. */
  readonly grantConsent: () => void
  /** Burn-rate hints for the account plan windows, derived from sampled history. */
  readonly pace: UsagePace
}

const EMPTY_STATE: UsageState = { account: null, sessions: [] }

function loadCachedAccounts(): readonly AccountUsage[] | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return parseCachedAccounts(localStorage.getItem(USAGE_CACHE_KEY))
  } catch {
    return null
  }
}

function saveCachedAccounts(accounts: readonly AccountUsage[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(USAGE_CACHE_KEY, serializeAccounts(accounts))
  } catch {
    // Persistence is best-effort; a full/blocked store must not break rendering.
  }
}

function loadConsent(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return parseConsent(localStorage.getItem(USAGE_CONSENT_KEY))
  } catch {
    return false
  }
}

function saveConsent(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(USAGE_CONSENT_KEY, serializeConsent())
  } catch {
    // Persistence is best-effort; consent still holds for this session.
  }
}

function loadHistory(): readonly PaceSample[] {
  try {
    if (typeof localStorage === 'undefined') return []
    return parseHistory(localStorage.getItem(USAGE_HISTORY_KEY))
  } catch {
    return []
  }
}

function saveHistory(history: readonly PaceSample[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(USAGE_HISTORY_KEY, serializeHistory(history))
  } catch {
    // Persistence is best-effort; the pace hint still works for this session.
  }
}

/**
 * Loads account/session usage from the main process and keeps it fresh. Falls
 * back to the last cached account usage on startup (flagged stale) and never
 * throws into render when the API is missing or a call rejects.
 */
export function useUsage(): UseUsageResult {
  const [state, setState] = useState<UsageState>(() => {
    const accounts = loadCachedAccounts()
    if (accounts === null) return EMPTY_STATE
    const account = accounts.find((entry) => entry.provider !== 'opencode-go') ?? null
    return { account, accounts, sessions: [] }
  })
  const [fresh, setFresh] = useState<boolean>(false)
  const [now, setNow] = useState<number>(() => Date.now())
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [consented, setConsented] = useState<boolean>(() => loadConsent())
  const [history, setHistory] = useState<readonly PaceSample[]>(() => loadHistory())
  const refreshingRef = useRef<boolean>(false)

  useEffect((): (() => void) => {
    let active = true
    const api = typeof window !== 'undefined' ? window.api : undefined

    const apply = (next: UsageState): void => {
      if (!active) return
      setState((previous) => mergeUsageState(previous, next))
      if (carriesFreshAccount(next)) setFresh(true)
      const account = next.account
      if (account !== null) {
        setHistory((previous) => {
          const updated = appendSample(
            previous,
            sampleFromWindows(account.updatedAt, account.fiveHour, account.sevenDay)
          )
          if (updated !== previous) saveHistory(updated)
          return updated
        })
      }
    }

    if (api !== undefined && typeof api.getUsage === 'function') {
      Promise.resolve()
        .then(() => api.getUsage())
        .then(apply)
        .catch(() => undefined)
    }

    let unsubscribe: (() => void) | undefined
    if (api !== undefined && typeof api.onUsage === 'function') {
      try {
        unsubscribe = api.onUsage(apply)
      } catch {
        unsubscribe = undefined
      }
    }

    const timer = setInterval((): void => {
      setNow(Date.now())
    }, TICK_MS)

    return (): void => {
      active = false
      if (unsubscribe !== undefined) unsubscribe()
      clearInterval(timer)
    }
  }, [])

  // Persist exactly what the bar shows: a provider main does not know yet (after a restart) must survive a reload.
  useEffect((): void => {
    if (state.accounts !== undefined) saveCachedAccounts(state.accounts)
  }, [state.accounts])

  useEffect((): (() => void) | undefined => {
    if (refreshError === null) return undefined
    const timer = setTimeout((): void => {
      setRefreshError(null)
    }, REFRESH_ERROR_MS)
    return (): void => {
      clearTimeout(timer)
    }
  }, [refreshError])

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshingRef.current) return
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (api === undefined || typeof api.refreshUsage !== 'function') {
      setRefreshError(REFRESH_UNAVAILABLE_MESSAGE)
      return
    }
    refreshingRef.current = true
    setRefreshing(true)
    setRefreshError(null)
    try {
      const result = await api.refreshUsage()
      if (!result.ok) {
        setRefreshError(describeRefreshError(result.error, Date.now()))
      }
      // On success we deliberately do nothing: fresh numbers arrive via onUsage.
    } catch {
      setRefreshError(describeRefreshError({ kind: 'network', message: '', retryAfterMs: null }, Date.now()))
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [])

  const grantConsent = useCallback((): void => {
    setConsented(true)
    saveConsent()
  }, [])

  const account = state.account
  const stale = account === null ? false : !fresh || isStale(account.updatedAt, now)

  const pace = useMemo((): UsagePace => {
    const fiveHour = state.account?.fiveHour ?? null
    const sevenDay = state.account?.sevenDay ?? null
    return {
      fiveHour: formatPace(paceFor(history, 'fiveHour', now), fiveHour?.resetsAt ?? null, now),
      sevenDay: formatPace(paceFor(history, 'sevenDay', now), sevenDay?.resetsAt ?? null, now)
    }
  }, [history, state.account, now])

  return { state, stale, now, refresh, refreshing, refreshError, consented, grantConsent, pace }
}
