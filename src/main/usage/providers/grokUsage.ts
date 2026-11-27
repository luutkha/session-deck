// Grok quota bars (D96): read the Grok CLI's own login file and ask xAI's billing endpoint for plan windows.
// Ported from Orca's grok fetcher/auth/mapping: a credits balance alone is not a quota, so a window is only
// produced when Orca would derive one (creditUsagePercent, a confirmed weekly period, or used/monthlyLimit).
// The CLI owns login/refresh; nothing here writes its file, and the token never leaves a request header.
import { join } from 'node:path'
import { isRecord } from '../../../shared/guards'
import type { UsageWindow } from '../../../shared/types'
import { PROVIDER_HTTP_TIMEOUT_MS } from './providerUsageTypes'
import type {
  ProviderHttpResponse,
  ProviderUsageDeps,
  ProviderUsageFailure,
  ProviderUsageResult,
  ProviderWindows
} from './providerUsageTypes'

type Json = Record<string, unknown>

const CREDITS_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const DEFAULT_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing'
const PREFERRED_ISSUER = 'https://auth.x.ai'
const CLI_AUTH_HEADER = 'xai-grok-cli'
// Orca's weekly window is 7 days (10,080 min) and its monthly one is 30 days (43,200 min): the two
// slots a Grok billing response can fill. It never reports a 5-hour window, so `fiveHour` stays null.
const TOKEN_SKEW_MS = 5 * 60 * 1000
const SECONDS_TEXT = /^\d+(\.\d+)?$/
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000
/** Flat billing payloads carry these fields directly; nested payloads put them under `config`. */
const FLAT_BILLING_FIELDS: readonly string[] = [
  'creditUsagePercent',
  'currentPeriod',
  'billingPeriodStart',
  'billingPeriodEnd',
  'subscriptionTier',
  'monthlyLimit',
  'used',
  'onDemandCap',
  'onDemandUsed',
  'prepaidBalance'
]

function failure(reason: ProviderUsageFailure, retryAfterMs?: number): ProviderUsageResult {
  return retryAfterMs === undefined ? { ok: false, reason } : { ok: false, reason, retryAfterMs }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function asString(obj: Json | null, key: string): string | undefined {
  const value = obj?.[key]
  return typeof value === 'string' ? value : undefined
}

/** xAI wraps money in `{ val }` and sometimes sends it as a string (e.g. "12.50"). */
function money(obj: Json | null, key: string): number | null {
  const value = obj?.[key]
  if (!isRecord(value)) return null
  const raw = value.val
  const parsed = typeof raw === 'string' ? Number.parseFloat(raw) : raw
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function dateMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function timestampsMatch(left: unknown, right: unknown): boolean {
  const a = dateMs(left)
  const b = dateMs(right)
  return a !== null && a === b
}

/** A { val } of exactly zero is different from "0invalid": only the former is a reported zero cap. */
function strictZero(obj: Json | null, key: string): boolean {
  if (money(obj, key) !== 0) return false
  const value = obj?.[key]
  return isRecord(value) && Number(value.val) === 0
}

function confirmedWeeklyPeriod(config: Json): boolean {
  const period = isRecord(config.currentPeriod) ? config.currentPeriod : null
  return (
    asString(period, 'type') === 'USAGE_PERIOD_TYPE_WEEKLY' &&
    timestampsMatch(period?.start, config.billingPeriodStart) &&
    timestampsMatch(period?.end, config.billingPeriodEnd)
  )
}

function usageScalars(config: Json): readonly number[] {
  return ['onDemandCap', 'onDemandUsed', 'prepaidBalance', 'monthlyLimit', 'used']
    .map((key) => money(config, key))
    .filter((value): value is number => value !== null)
}

function reportsPositiveSpend(config: Json): boolean {
  return (money(config, 'onDemandUsed') ?? 0) > 0 || (money(config, 'used') ?? 0) > 0
}

function omittedPercentIsUnreported(config: Json): boolean {
  if (strictZero(config, 'onDemandCap')) return reportsPositiveSpend(config)
  return usageScalars(config).some((value) => value === 0)
}

function periodEnd(config: Json): string | undefined {
  const period = isRecord(config.currentPeriod) ? config.currentPeriod : null
  return asString(period, 'end') ?? asString(config, 'billingPeriodEnd')
}

/** Reset times are ISO strings here, but the UsageWindow contract wants epoch SECONDS. Relative seconds
 * and epoch milliseconds are handled too, so a changed payload shape cannot silently produce a bad reset. */
function resetSeconds(value: string | undefined, nowMs: number): number | null {
  if (value === undefined) return null
  const text = value.trim()
  if (text === '') return null
  if (SECONDS_TEXT.test(text)) {
    const seconds = Number(text)
    if (!Number.isFinite(seconds) || seconds < 0) return null
    if (seconds >= 1e12) return Math.floor(seconds / 1000)
    if (seconds >= 1e9) return Math.floor(seconds)
    return Math.floor(nowMs / 1000) + Math.floor(seconds)
  }
  const ms = Date.parse(text)
  return Number.isNaN(ms) || ms < 0 ? null : Math.floor(ms / 1000)
}

/** A spend/limit pair is the only monthly percentage xAI reports; a balance on its own is not a quota. */
function mapMonthly(config: Json, nowMs: number): UsageWindow | null {
  const limit = money(config, 'monthlyLimit')
  const used = money(config, 'used')
  if (limit === null || used === null || limit <= 0) return null
  return {
    usedPercentage: clampPercent((used / limit) * 100),
    resetsAt: resetSeconds(periodEnd(config), nowMs)
  }
}

function resolveWeeklyPercent(config: Json, nowMs: number): number | null {
  const reported = config.creditUsagePercent
  if (typeof reported === 'number' && Number.isFinite(reported)) return reported
  if (reported !== undefined) return null
  // A zero cap may mean "no quota reported"; do not relabel a computable monthly budget as weekly zero.
  if (omittedPercentIsUnreported(config) || mapMonthly(config, nowMs) !== null) return null
  return confirmedWeeklyPeriod(config) ? 0 : null
}

function mapWeekly(config: Json, nowMs: number): UsageWindow | null {
  const percent = resolveWeeklyPercent(config, nowMs)
  if (percent === null) return null
  return { usedPercentage: clampPercent(percent), resetsAt: resetSeconds(periodEnd(config), nowMs) }
}

function resolveConfig(data: Json): Json | null {
  if (isRecord(data.config)) return data.config
  return FLAT_BILLING_FIELDS.some((field) => data[field] !== undefined) ? data : null
}

interface GrokSession {
  readonly token: string
  readonly userId: string | null
  readonly expiryAtMs: number | null
}

type SessionRead =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'ok'; session: GrokSession }

function fresh(expiresAtMs: number | null, nowMs: number): boolean {
  // No expiry is inconclusive: let the endpoint decide rather than hiding a usable login.
  return expiresAtMs === null || expiresAtMs - nowMs > TOKEN_SKEW_MS
}

/** auth.json is keyed by OAuth issuer; prefer the default x.ai login over stale alternate issuers. */
function readSession(raw: string | null, nowMs: number): SessionRead {
  if (raw === null) return { status: 'missing' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'invalid' }
  }
  if (!isRecord(parsed)) return { status: 'invalid' }

  let preferredSeen = false
  let expiredPreferred: GrokSession | null = null
  let fallback: GrokSession | null = null
  for (const [issuer, entry] of Object.entries(parsed)) {
    const preferred = issuer === PREFERRED_ISSUER || issuer.startsWith(`${PREFERRED_ISSUER}::`)
    preferredSeen ||= preferred
    if (!isRecord(entry) || typeof entry.key !== 'string' || entry.key.trim() === '') continue
    const expiry = dateMs(entry.expires_at)
    const session: GrokSession = {
      token: entry.key.trim(),
      userId: typeof entry.user_id === 'string' && entry.user_id !== '' ? entry.user_id : null,
      expiryAtMs: expiry
    }
    const isFresh = fresh(expiry, nowMs)
    if (preferred && isFresh) return { status: 'ok', session }
    if (preferred) {
      expiredPreferred ??= session
      continue
    }
    fallback ??= session
  }
  const selected = expiredPreferred ?? (preferredSeen ? null : fallback)
  if (selected === null) return { status: 'missing' }
  return fresh(selected.expiryAtMs, nowMs) ? { status: 'ok', session: selected } : { status: 'expired' }
}

/** Retry-After is delta-seconds or an HTTP date; an unusable header leaves the wait to the poller. */
function retryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined
  const text = header.trim()
  if (text === '') return undefined
  if (SECONDS_TEXT.test(text)) return Math.min(Math.floor(Number(text) * 1000), MAX_RETRY_AFTER_MS)
  if (/^[+-]?[\d.]+$/.test(text)) return undefined
  const at = Date.parse(text)
  if (Number.isNaN(at)) return undefined
  return Math.min(Math.max(0, Math.floor(at - nowMs)), MAX_RETRY_AFTER_MS)
}

function httpProblem(response: ProviderHttpResponse, nowMs: number): ProviderUsageResult | null {
  if (response.status === 401 || response.status === 403) return failure('unauthorized')
  if (response.status === 429) {
    const wait = retryAfterMs(response.headers.get('retry-after'), nowMs)
    return wait === undefined ? failure('rate-limited') : failure('rate-limited', wait)
  }
  return response.status >= 200 && response.status < 300 ? null : failure('unavailable')
}

type BillingOutcome = { data: Json } | { result: ProviderUsageResult }

async function fetchBilling(url: string, session: GrokSession, deps: ProviderUsageDeps): Promise<BillingOutcome> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'X-XAI-Token-Auth': CLI_AUTH_HEADER,
    Accept: 'application/json'
  }
  if (session.userId !== null) headers['x-userid'] = session.userId
  const response = await deps.http(url, { method: 'GET', headers, timeoutMs: PROVIDER_HTTP_TIMEOUT_MS })
  const problem = httpProblem(response, deps.now())
  if (problem !== null) return { result: problem }
  const body: unknown = await response.json()
  return { data: isRecord(body) ? body : {} }
}

function withWindows(windows: ProviderWindows): ProviderUsageResult {
  return windows.fiveHour === null && windows.sevenDay === null && windows.monthly === null
    ? failure('unavailable')
    : { ok: true, windows }
}

/** Read Grok's own login, then map billing data to the weekly/monthly bars without inventing a 5-hour window.
 * Never throws: no error text (which could quote a header) escapes into the result. */
export async function fetchGrokUsage(deps: ProviderUsageDeps): Promise<ProviderUsageResult> {
  try {
    const path = join(deps.homeDir, '.grok', 'auth.json')
    const read = readSession(await deps.readTextFile(path), deps.now())
    if (read.status === 'missing') return failure('not-signed-in')
    if (read.status === 'invalid') return failure('unavailable')
    if (read.status === 'expired') return failure('unauthorized')

    const session = read.session
    const credits = await fetchBilling(CREDITS_URL, session, deps)
    if ('result' in credits) return credits.result
    const config = resolveConfig(credits.data)
    if (config === null) return failure('unavailable')

    const weekly = mapWeekly(config, deps.now())
    if (weekly !== null) return withWindows({ fiveHour: null, sevenDay: weekly, monthly: null })
    // The credits view may already carry a monthly budget; do not make a second request for it.
    const monthly = mapMonthly(config, deps.now())
    if (monthly !== null) return withWindows({ fiveHour: null, sevenDay: null, monthly })

    // A percent-free credits view can still hold monthly quota in the default billing view.
    const fallback = await fetchBilling(DEFAULT_BILLING_URL, session, deps)
    if ('result' in fallback) return fallback.result
    const fallbackConfig: Json = isRecord(fallback.data.config) ? fallback.data.config : fallback.data
    const fallbackMonthly = mapMonthly(fallbackConfig, deps.now())
    // A zero weekly from a missing cap is only safe when the default view shows no spend and no monthly window.
    const skipZeroWeekly = fallbackMonthly !== null || reportsPositiveSpend(fallbackConfig)
    const zeroConfig: Json = {
      onDemandCap: fallbackConfig.onDemandCap,
      used: fallbackConfig.used,
      ...config
    }
    const zeroWeekly = skipZeroWeekly ? null : mapWeekly(zeroConfig, deps.now())
    return withWindows({ fiveHour: null, sevenDay: zeroWeekly, monthly: fallbackMonthly })
  } catch {
    return failure('unavailable')
  }
}
