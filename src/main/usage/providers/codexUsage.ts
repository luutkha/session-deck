// Codex plan-quota fetcher (provider bars, D96). Reads Codex's own ChatGPT login from
// <CODEX_HOME or ~/.codex>/auth.json and asks the same read-only backend endpoint Orca asks.
// Every machine touch goes through ProviderUsageDeps, so the fetcher is pure in tests.
// The token and account id live only in the request headers: no result, error or log carries them.
import { join } from 'node:path'
import type { UsageWindow } from '../../../shared/types'
import { parseRetryAfterMs } from '../oauthUsage'
import { clampPercent } from '../statusLineParser'
import {
  PROVIDER_HTTP_TIMEOUT_MS,
  type ProviderHttpResponse,
  type ProviderUsageDeps,
  type ProviderUsageResult,
  type ProviderWindows
} from './providerUsageTypes'

export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

const USER_AGENT = 'codex-cli'
const OPENAI_BETA = 'codex-1'
const ORIGINATOR = 'Codex Desktop'

// Orca's bucket lengths in minutes. Older builds drift by one minute, so tolerate exactly that.
const FIVE_HOUR_MINUTES = 300
const SEVEN_DAY_MINUTES = 10_080
const MONTHLY_MINUTES = 43_200
const DURATION_TOLERANCE_MINUTES = 1

/** Epoch values at or above this are milliseconds; below it they are seconds. */
const MILLISECOND_THRESHOLD = 1e10
/** A smaller positive number cannot be a real epoch date; Orca-style countdowns are seconds from now. */
const RELATIVE_SECONDS_MAX = 1e8
const SECONDS_TEXT = /^\d+(\.\d+)?$/

type JsonObject = Record<string, unknown>
type WindowKind = 'fiveHour' | 'sevenDay' | 'monthly' | null

interface CodexTokens {
  readonly accessToken: string
  readonly accountId: string | null
}

interface RateWindowSnapshot {
  readonly usedPercent: number | null
  readonly windowMinutes: number | null
  readonly resetsAt: unknown
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null
}

function codexHome(deps: ProviderUsageDeps): string {
  // An empty CODEX_HOME is not a usable folder; the CLI default is the reliable fallback.
  const override = deps.env.CODEX_HOME
  return override !== undefined && override.trim().length > 0 ? override : join(deps.homeDir, '.codex')
}

/** Throws only on malformed JSON (mapped to 'unavailable'); a login without a ChatGPT token returns null. */
function readTokens(raw: string): CodexTokens | null {
  const tokens = asObject(asObject(JSON.parse(raw) as unknown)?.tokens)
  const accessToken = tokens?.access_token
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) return null
  const accountId = tokens?.account_id
  return {
    accessToken: accessToken.trim(),
    accountId: typeof accountId === 'string' && accountId.trim().length > 0 ? accountId.trim() : null
  }
}

/** Orca's exact header set; the account id is sent only when the login carries one. */
function authHeaders(tokens: CodexTokens): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    'User-Agent': USER_AGENT,
    'OpenAI-Beta': OPENAI_BETA,
    originator: ORIGINATOR
  }
  if (tokens.accountId !== null) headers['ChatGPT-Account-Id'] = tokens.accountId
  return headers
}

function numberToEpochSeconds(value: number, nowMs: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  if (value >= MILLISECOND_THRESHOLD) return Math.floor(value / 1000)
  if (value >= RELATIVE_SECONDS_MAX) return Math.floor(value)
  return Math.floor(nowMs / 1000) + Math.floor(value)
}

/** Every resetsAt becomes epoch SECONDS: epoch seconds/ms, numeric strings, ISO dates, or seconds until reset. */
function toEpochSeconds(value: unknown, nowMs: number): number | null {
  if (typeof value === 'number') return numberToEpochSeconds(value, nowMs)
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (SECONDS_TEXT.test(text)) return numberToEpochSeconds(Number(text), nowMs)
  const ms = Date.parse(text)
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 1000) : null
}

function snapshot(value: unknown): RateWindowSnapshot | null {
  const obj = asObject(value)
  if (obj === null) return null
  const used = obj.used_percent
  const seconds = obj.limit_window_seconds
  return {
    usedPercent: typeof used === 'number' && Number.isFinite(used) ? used : null,
    // Orca rounds the backend's seconds up, then tolerates a one-minute drift in the classification.
    windowMinutes: typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null,
    resetsAt: obj.reset_at
  }
}

/** Only a finite used_percent can produce a bar. */
function mappable(raw: RateWindowSnapshot | null): RateWindowSnapshot | null {
  return raw !== null && raw.usedPercent !== null ? raw : null
}

function classify(raw: RateWindowSnapshot): WindowKind {
  const minutes = raw.windowMinutes
  if (minutes === null) return null
  if (Math.abs(minutes - FIVE_HOUR_MINUTES) <= DURATION_TOLERANCE_MINUTES) return 'fiveHour'
  if (Math.abs(minutes - SEVEN_DAY_MINUTES) <= DURATION_TOLERANCE_MINUTES) return 'sevenDay'
  if (Math.abs(minutes - MONTHLY_MINUTES) <= DURATION_TOLERANCE_MINUTES) return 'monthly'
  return null
}

function toUsageWindow(raw: RateWindowSnapshot | null, nowMs: number): UsageWindow | null {
  if (raw === null) return null
  const usedPercentage = clampPercent(raw.usedPercent)
  if (usedPercentage === null) return null
  return { usedPercentage, resetsAt: toEpochSeconds(raw.resetsAt, nowMs) }
}

/** Maps the backend body by bucket length, not by field position, so a changed order still yields correct bars. */
function mapWindows(json: unknown, nowMs: number): ProviderWindows {
  const root = asObject(json)
  const rateLimit = asObject(root?.rate_limit)
  const primary = mappable(snapshot(rateLimit?.primary_window))
  const secondary = mappable(snapshot(rateLimit?.secondary_window))

  let fiveHour: RateWindowSnapshot | null = null
  let sevenDay: RateWindowSnapshot | null = null
  let monthly: RateWindowSnapshot | null = null

  for (const raw of [primary, secondary]) {
    if (raw === null) continue
    const kind = classify(raw)
    if (kind === 'fiveHour' && fiveHour === null) fiveHour = raw
    else if (kind === 'sevenDay' && sevenDay === null) sevenDay = raw
    else if (kind === 'monthly' && monthly === null) monthly = raw
  }

  // Unknown or missing durations keep Orca's legacy primary=session / secondary=weekly mapping.
  if (fiveHour === null && primary !== null && classify(primary) === null) fiveHour = primary
  if (sevenDay === null && secondary !== null && classify(secondary) === null) sevenDay = secondary

  // The spend cap is the monthly meter on workspace plans and reports REMAINING, not used. Orca uses it only
  // when no rate window was mapped, so a capped plan does not overwrite a live 5h/7d reading.
  if (fiveHour === null && sevenDay === null && monthly === null) {
    const individual = asObject(asObject(root?.spend_control)?.individual_limit)
    const remaining = individual?.remaining_percent
    if (typeof remaining === 'number' && Number.isFinite(remaining)) {
      monthly = { usedPercent: 100 - remaining, windowMinutes: MONTHLY_MINUTES, resetsAt: individual?.reset_at }
    }
  }

  return {
    fiveHour: toUsageWindow(fiveHour, nowMs),
    sevenDay: toUsageWindow(sevenDay, nowMs),
    monthly: toUsageWindow(monthly, nowMs)
  }
}

/** One Codex quota read. Never throws: every failure is a reason code with no credential or body text. */
export async function fetchCodexUsage(deps: ProviderUsageDeps): Promise<ProviderUsageResult> {
  try {
    const rawAuth = await deps.readTextFile(join(codexHome(deps), 'auth.json'))
    if (rawAuth === null) return { ok: false, reason: 'not-signed-in' }

    let tokens: CodexTokens | null
    try {
      tokens = readTokens(rawAuth)
    } catch {
      // A truncated auth file is bad JSON, not a sign-out: the poller may retry after a rewrite.
      return { ok: false, reason: 'unavailable' }
    }
    if (tokens === null) return { ok: false, reason: 'not-signed-in' }

    let response: ProviderHttpResponse
    try {
      response = await deps.http(CODEX_USAGE_URL, {
        method: 'GET',
        headers: authHeaders(tokens),
        timeoutMs: PROVIDER_HTTP_TIMEOUT_MS
      })
    } catch {
      // DNS, offline and timeouts all arrive here. The thrown error is dropped: it may echo the request.
      return { ok: false, reason: 'unavailable' }
    }

    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'unauthorized' }
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), deps.now())
      return retryAfterMs === null
        ? { ok: false, reason: 'rate-limited' }
        : { ok: false, reason: 'rate-limited', retryAfterMs }
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, reason: 'unavailable' }

    let json: unknown
    try {
      json = await response.json()
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    const windows = mapWindows(json, deps.now())
    if (windows.fiveHour === null && windows.sevenDay === null && windows.monthly === null) {
      return { ok: false, reason: 'unavailable' }
    }
    return { ok: true, windows }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
