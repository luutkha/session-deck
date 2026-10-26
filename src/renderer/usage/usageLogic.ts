import type {
  AccountUsage,
  Id,
  SessionUsage,
  UsageProvider,
  UsageRefreshError,
  UsageState,
  UsageWindow
} from '../../shared/types'

export type UsageLevel = 'ok' | 'warn' | 'high'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Default age after which account usage is considered stale (15 minutes). */
export const DEFAULT_STALE_MS = 15 * MINUTE_MS

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

/** Consumption level for a 0..100 usage percentage. Non-finite input reads as 'ok'. */
export function usageLevel(percent: number): UsageLevel {
  if (!Number.isFinite(percent)) return 'ok'
  if (percent >= 90) return 'high'
  if (percent >= 70) return 'warn'
  return 'ok'
}

/** Clamped, rounded percentage label, e.g. "38%". Non-finite input reads as "0%". */
export function formatPercent(percent: number): string {
  return `${String(Math.round(clampPercent(percent)))}%`
}

/**
 * Countdown to a window reset. `resetsAtSec` is epoch seconds. Buckets:
 *  - past / now -> "resetting now"
 *  - < 1 minute  -> "resets in <1m"
 *  - minutes     -> "resets in 35m"
 *  - hours       -> "resets in 2h 10m" ("resets in 2h" when the minutes are zero)
 *  - days        -> "resets in 3d 4h" ("resets in 3d" when the hours are zero)
 * Returns "" when `resetsAtSec` is null or non-finite.
 */
export function formatResetsIn(nowMs: number, resetsAtSec: number | null): string {
  if (resetsAtSec === null || !Number.isFinite(resetsAtSec)) return ''
  if (!Number.isFinite(nowMs)) return ''
  const deltaMs = resetsAtSec * SECOND_MS - nowMs
  if (deltaMs <= 0) return 'resetting now'
  const totalMinutes = Math.floor(deltaMs / MINUTE_MS)
  if (totalMinutes < 1) return 'resets in <1m'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) {
    return hours > 0 ? `resets in ${String(days)}d ${String(hours)}h` : `resets in ${String(days)}d`
  }
  if (hours > 0) {
    return minutes > 0
      ? `resets in ${String(hours)}h ${String(minutes)}m`
      : `resets in ${String(hours)}h`
  }
  return `resets in ${String(minutes)}m`
}

/**
 * Cost label for a session. `null` / non-finite / negative -> "". Zero -> "$0.00".
 * Positive amounts under one cent -> "<$0.01"; otherwise two decimals, e.g. "$12.40".
 */
export function formatCost(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd) || usd < 0) return ''
  if (usd > 0 && usd < 0.005) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** Context-window label, e.g. "ctx 5%". `null` -> "". */
export function formatContext(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return ''
  return `ctx ${formatPercent(percent)}`
}

/** True when usage was last updated more than `maxAgeMs` before `nowMs`. */
export function isStale(
  updatedAtMs: number,
  nowMs: number,
  maxAgeMs: number = DEFAULT_STALE_MS
): boolean {
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs)) return false
  return nowMs - updatedAtMs > maxAgeMs
}

/** The usage record for `sessionId`, or null when absent / no id was given. */
export function sessionUsageFor(state: UsageState, sessionId: Id | null): SessionUsage | null {
  if (sessionId === null) return null
  return state.sessions.find((session) => session.sessionId === sessionId) ?? null
}

/** Provider of an account row; legacy rows without one are Claude. */
export function providerOf(account: AccountUsage): UsageProvider {
  return account.provider ?? 'claude'
}

/** Status-bar label: "Claude" or "Go". */
export function providerLabel(provider: UsageProvider): string {
  return provider === 'opencode-go' ? 'Go' : 'Claude'
}

/** An account row is shown only when it has at least one window. */
export function accountHasData(account: AccountUsage): boolean {
  return account.fiveHour !== null || account.sevenDay !== null || (account.monthly ?? null) !== null
}

const PROVIDER_ORDER: readonly UsageProvider[] = ['claude', 'opencode-go']

/** Every displayable account, Claude first then Go. Legacy state (no list) reads as one Claude row. */
export function accountsForDisplay(state: UsageState): readonly AccountUsage[] {
  const list = state.accounts !== undefined ? state.accounts : state.account !== null ? [state.account] : []
  const byProvider = new Map<UsageProvider, AccountUsage>()
  for (const account of list) {
    const provider = providerOf(account)
    if (accountHasData(account) && !byProvider.has(provider)) byProvider.set(provider, account)
  }
  return PROVIDER_ORDER.map((provider) => byProvider.get(provider)).filter(
    (account): account is AccountUsage => account !== undefined
  )
}

/** Short "time since" label, e.g. "3m ago", "2h ago", "3d ago", "just now". */
export function formatAgo(nowMs: number, thenMs: number): string {
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return ''
  const delta = nowMs - thenMs
  if (delta < MINUTE_MS) return 'just now'
  if (delta < HOUR_MS) return `${String(Math.max(1, Math.round(delta / MINUTE_MS)))}m ago`
  if (delta < DAY_MS) return `${String(Math.max(1, Math.round(delta / HOUR_MS)))}h ago`
  return `${String(Math.max(1, Math.round(delta / DAY_MS)))}d ago`
}

/**
 * Full sentence for a window tooltip / aria-label, e.g.
 * "5-hour window: 38% used, resets in 2h 10m (updated 3m ago)".
 */
export function describeWindow(
  label: string,
  window: UsageWindow | null,
  nowMs: number,
  updatedAtMs: number
): string {
  if (window === null) return `${label}: no data`
  const parts = [`${formatPercent(window.usedPercentage)} used`]
  const reset = formatResetsIn(nowMs, window.resetsAt)
  if (reset !== '') parts.push(reset)
  const ago = formatAgo(nowMs, updatedAtMs)
  const suffix = ago !== '' ? ` (updated ${ago})` : ''
  return `${label}: ${parts.join(', ')}${suffix}`
}

/**
 * Applies an update from main to what is on screen. Main starts empty after a restart (it only learns plan usage
 * from the next turn), so an update that carries no Claude row must not erase the last known Claude numbers; the
 * per-session list always comes from the update.
 *
 * A missing Go row is NOT retained: main drops it on purpose when the settings toggle is off. The status bar also
 * filters Go by the same setting, so a disabled provider can never reappear from the cache. A provider present in
 * the update always replaces its cached row.
 */
export function mergeUsageState(previous: UsageState, next: UsageState): UsageState {
  const accounts = mergeAccounts(previous, next)
  const claudeFromAccounts = accounts?.find((account) => providerOf(account) === 'claude') ?? null
  const account = next.account ?? claudeFromAccounts ?? (next.accounts === undefined ? previous.account : null)
  return accounts === undefined
    ? { account, sessions: next.sessions }
    : { account, accounts, sessions: next.sessions }
}

/** Per-provider merge: fresh rows win; a missing Claude row keeps its cached value (main restarted empty). */
function mergeAccounts(
  previous: UsageState,
  next: UsageState
): readonly AccountUsage[] | undefined {
  if (next.accounts === undefined) return previous.accounts
  const fresh = accountsForDisplay({ account: null, accounts: next.accounts, sessions: [] })
  // Claude is always supported, so an update that omits it only means main has not seen a Claude turn yet.
  // Go is optional and its absence is how main enforces the settings toggle, so it is never retained.
  const retainsClaude = !fresh.some((account) => providerOf(account) === 'claude')
  const kept = retainsClaude
    ? (previous.accounts ?? []).filter((account) => providerOf(account) === 'claude' && accountHasData(account))
    : []
  if (kept.length === 0) return fresh
  return accountsForDisplay({ account: null, accounts: [...fresh, ...kept], sessions: [] })
}

/** An update is "fresh" for the account bars only when it actually carries account usage. */
export function carriesFreshAccount(next: UsageState): boolean {
  return next.account !== null || next.accounts !== undefined
}

const RESETS_IN_PREFIX = 'resets in '

/**
 * Human duration label for a relative retry delay, reusing the reset-countdown
 * buckets (e.g. "4m", "2h 10m", "<1m"). Returns null when there is no usable
 * delay so callers can fall back to their own wording.
 */
function formatRetryAfter(nowMs: number, retryAfterMs: number | null): string | null {
  if (retryAfterMs === null || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return null
  if (!Number.isFinite(nowMs)) return null
  const sentence = formatResetsIn(nowMs, (nowMs + retryAfterMs) / SECOND_MS)
  return sentence.startsWith(RESETS_IN_PREFIX) ? sentence.slice(RESETS_IN_PREFIX.length) : null
}

/**
 * Friendly, credential-free one-liner for a failed manual usage refresh.
 * `nowMs` anchors the relative retry delay for the rate-limited case.
 */
export function describeRefreshError(error: UsageRefreshError, nowMs: number): string {
  switch (error.kind) {
    case 'no-credentials':
      return 'No Claude login found. Sign in with Claude Code first.'
    case 'stale-token':
      return 'Your Claude login expired. Open any Claude session (it renews automatically), then try again.'
    case 'rate-limited': {
      const retry = formatRetryAfter(nowMs, error.retryAfterMs)
      return retry === null
        ? 'Usage is rate limited right now. Try again in a minute.'
        : `Usage is rate limited right now. Try again in ${retry}.`
    }
    case 'server':
      return "Anthropic's usage service had a problem. Try again shortly."
    case 'network':
      return 'Could not reach Anthropic. Check your connection.'
    case 'unavailable':
      return 'Anthropic returned no usage data.'
  }
}

/**
 * Remaining cooldown (ms) before another manual refresh should be attempted after
 * a rate-limited failure. Zero for any other kind, an absent delay, or once the
 * cooldown has elapsed. Non-finite inputs read as zero.
 */
export function refreshCooldownLeftMs(
  error: UsageRefreshError,
  failedAtMs: number,
  nowMs: number
): number {
  if (error.kind !== 'rate-limited') return 0
  const retryAfterMs = error.retryAfterMs
  if (retryAfterMs === null || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return 0
  if (!Number.isFinite(failedAtMs) || !Number.isFinite(nowMs)) return 0
  return Math.max(0, retryAfterMs - (nowMs - failedAtMs))
}

/** Reads the persisted consent flag. Any corrupt, missing, or non-`true` value is not consented. */
export function parseConsent(raw: string | null): boolean {
  if (raw === null) return false
  try {
    return JSON.parse(raw) === true
  } catch {
    return false
  }
}

/** Serialized form of the consent flag for localStorage. */
export function serializeConsent(): string {
  return JSON.stringify(true)
}
