// Kimi Code quota bars (D96): read the CLI's own login file and ask its usage endpoint for plan windows.
// The logic follows Orca's kimi fetcher/mapping: the CLI owns token refresh, so this reads the credential
// file and never writes it, and a bare "used/limit" detail becomes a USED percentage. Every machine access
// goes through ProviderUsageDeps; the token stays in the Authorization header and never reaches a result.
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

const USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
const FIVE_HOUR_MINUTES = 300
const SEVEN_DAY_MINUTES = 10_080
const MONTHLY_MINUTES = 43_200
/** A reported window counts as the same plan window while it stays inside this drift from the nominal length. */
const TOLERANCE_MINUTES = { fiveHour: 60, sevenDay: 1_440, monthly: 4_320 } as const
type Bucket = keyof typeof TOLERANCE_MINUTES
const NOMINAL_MINUTES: Readonly<Record<Bucket, number>> = {
  fiveHour: FIVE_HOUR_MINUTES,
  sevenDay: SEVEN_DAY_MINUTES,
  monthly: MONTHLY_MINUTES
}
const SECONDS_TEXT = /^\d+(\.\d+)?$/
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000
/** Orca leaves a few seconds of skew so a request in flight does not fail on an almost-expired token. */
const EXPIRY_SKEW_SECONDS = 5

function failure(reason: ProviderUsageFailure, retryAfterMs?: number): ProviderUsageResult {
  return retryAfterMs === undefined ? { ok: false, reason } : { ok: false, reason, retryAfterMs }
}

/** Mutable while a response is being assembled; returned as the readonly ProviderWindows contract. */
type MutableWindows = { -readonly [K in keyof ProviderWindows]: ProviderWindows[K] }

function emptyWindows(): MutableWindows {
  return { fiveHour: null, sevenDay: null, monthly: null }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Retry-After is delta-seconds or an HTTP date; an unusable header leaves the wait to the poller. */
function retryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined
  const text = header.trim()
  if (text === '') return undefined
  if (SECONDS_TEXT.test(text)) return Math.min(Math.floor(Number(text) * 1000), MAX_RETRY_AFTER_MS)
  // Reject signed/decimal-looking values before Date.parse can reinterpret them as a date.
  if (/^[+-]?[\d.]+$/.test(text)) return undefined
  const at = Date.parse(text)
  if (Number.isNaN(at)) return undefined
  return Math.min(Math.max(0, Math.floor(at - nowMs)), MAX_RETRY_AFTER_MS)
}

/** A reset time as epoch SECONDS: ISO/date strings, epoch ms and epoch seconds all appear in CLI payloads.
 * Small numbers are durations in seconds from now, which some endpoints report instead of a timestamp. */
function resetSeconds(value: unknown, nowMs: number): number | null {
  if (typeof value === 'number') return numericResetSeconds(value, nowMs)
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  if (SECONDS_TEXT.test(text)) return numericResetSeconds(Number(text), nowMs)
  const ms = Date.parse(text)
  return Number.isNaN(ms) || ms < 0 ? null : Math.floor(ms / 1000)
}

function numericResetSeconds(value: number, nowMs: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  if (value >= 1e12) return Math.floor(value / 1000) // epoch milliseconds
  if (value >= 1e9) return Math.floor(value) // epoch seconds (year 2001 onwards)
  return Math.floor(nowMs / 1000) + Math.floor(value) // relative seconds from now
}

/** Non-2xx answers have a fixed failure reason; the caller never sees a status text or response body. */
function httpProblem(response: ProviderHttpResponse, nowMs: number): ProviderUsageResult | null {
  if (response.status === 401 || response.status === 403) return failure('unauthorized')
  if (response.status === 429) {
    const wait = retryAfterMs(response.headers.get('retry-after'), nowMs)
    return wait === undefined ? failure('rate-limited') : failure('rate-limited', wait)
  }
  return response.status >= 200 && response.status < 300 ? null : failure('unavailable')
}

function windowMinutes(window: unknown): number {
  const obj = isRecord(window) ? window : null
  const duration = toNumber(obj?.duration)
  if (duration === null) return FIVE_HOUR_MINUTES // Orca's default when a limit has no window description.
  const unit = (typeof obj?.timeUnit === 'string' ? obj.timeUnit : '').toUpperCase()
  if (unit.includes('MINUTE')) return duration
  if (unit.includes('HOUR')) return duration * 60
  if (unit.includes('DAY')) return duration * 60 * 24
  if (unit.includes('SECOND')) return duration / 60
  return duration // An unlabelled duration is already in minutes.
}

function bucketFor(minutes: number): Bucket | null {
  for (const key of ['fiveHour', 'sevenDay', 'monthly'] as const) {
    if (Math.abs(minutes - NOMINAL_MINUTES[key]) <= TOLERANCE_MINUTES[key]) return key
  }
  return null
}

/** Kimi reports an allowance plus either `used` or `remaining`; the bar needs USED. */
function mapDetail(detail: unknown, nowMs: number): UsageWindow | null {
  const obj = isRecord(detail) ? detail : null
  if (obj === null) return null
  const limit = toNumber(obj.limit)
  let used = toNumber(obj.used)
  if (used === null) {
    const remaining = toNumber(obj.remaining)
    if (remaining !== null && limit !== null) used = limit - remaining
  }
  if (limit === null || limit <= 0 || used === null) return null
  const reset = obj.resetTime ?? obj.resetAt
  return { usedPercentage: clampPercent((used / limit) * 100), resetsAt: resetSeconds(reset, nowMs) }
}

/** The monthly pool is a 0..1 ratio rather than an allowance pair. */
function mapRatio(entry: unknown, nowMs: number): UsageWindow | null {
  const obj = isRecord(entry) ? entry : null
  const ratio = toNumber(obj?.used_ratio)
  if (ratio === null) return null
  return { usedPercentage: clampPercent(ratio * 100), resetsAt: resetSeconds(obj?.reset_time, nowMs) }
}

/** Orca maps the top-level `usage` to the weekly window and picks the limit closest to 5 hours for the session.
 * We keep the same choice but also place clearly weekly/monthly limits in their own slot. */
function mapResponse(data: unknown, nowMs: number): MutableWindows {
  const root = isRecord(data) ? data : null
  if (root === null) return emptyWindows()

  const windows = emptyWindows()
  const distance: Record<Bucket, number> = { fiveHour: Infinity, sevenDay: Infinity, monthly: Infinity }
  const keep = (bucket: Bucket, minutes: number, window: UsageWindow | null): void => {
    if (window === null) return
    const diff = Math.abs(minutes - NOMINAL_MINUTES[bucket])
    if (diff < distance[bucket]) {
      distance[bucket] = diff
      windows[bucket] = window
    }
  }

  // The endpoint's top-level usage is the rolling 7-day pool; `limits` carries the shorter windows.
  keep('sevenDay', SEVEN_DAY_MINUTES, mapDetail(root.usage, nowMs))
  const limits = Array.isArray(root.limits) ? root.limits : []
  for (const entry of limits) {
    const limit = isRecord(entry) ? entry : null
    if (limit === null) continue
    const minutes = windowMinutes(limit.window)
    const bucket = bucketFor(minutes)
    if (bucket === null) continue
    keep(bucket, minutes, mapDetail(limit.detail, nowMs))
  }
  const usages = isRecord(root.usages) ? root.usages : null
  keep('monthly', MONTHLY_MINUTES, mapRatio(usages?.limit_month_total, nowMs))
  return windows
}

type CredentialRead =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'ok'; token: string }

function readCredentials(raw: string | null, nowMs: number): CredentialRead {
  if (raw === null) return { status: 'missing' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'invalid' }
  }
  if (!isRecord(parsed)) return { status: 'invalid' }
  const value = parsed.access_token
  const token = typeof value === 'string' ? value.trim() : ''
  if (token === '') return { status: 'missing' }
  const expiresAt = toNumber(parsed.expires_at)
  // A missing expiry is inconclusive (the endpoint can still reject it); an expired one will not refresh itself here.
  if (expiresAt !== null && expiresAt - Math.floor(nowMs / 1000) <= EXPIRY_SKEW_SECONDS) {
    return { status: 'expired' }
  }
  return { status: 'ok', token }
}

/** Read Kimi's own login and map GET /usages to the plan windows the status bar already understands.
 * Never throws: every failure is a reason the poller can act on, with no token or response body attached. */
export async function fetchKimiUsage(deps: ProviderUsageDeps): Promise<ProviderUsageResult> {
  try {
    const path = join(deps.homeDir, '.kimi-code', 'credentials', 'kimi-code.json')
    const raw = await deps.readTextFile(path)
    const read = readCredentials(raw, deps.now())
    if (read.status === 'missing') return failure('not-signed-in')
    if (read.status === 'invalid') return failure('unavailable')
    // An expired token is the one local failure that means "stop polling until the login changes".
    if (read.status === 'expired') return failure('unauthorized')

    const response = await deps.http(USAGE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${read.token}`, Accept: 'application/json' },
      timeoutMs: PROVIDER_HTTP_TIMEOUT_MS
    })
    const problem = httpProblem(response, deps.now())
    if (problem !== null) return problem

    const windows = mapResponse(await response.json(), deps.now())
    return windows.fiveHour === null && windows.sevenDay === null && windows.monthly === null
      ? failure('unavailable')
      : { ok: true, windows }
  } catch {
    // A thrown error may quote the URL, headers or body; never let its text into a result or a log.
    return failure('unavailable')
  }
}
