// Manual usage refresh: asks Anthropic's OAuth usage endpoint with the local Claude Code login.
// Main process only. The token is read here, sent only in the Authorization header, and never returned,
// logged or put into an error object (the success result of readClaudeAccessToken is the one exception).
import { join } from 'node:path'
import type { UsageRefreshError, UsageWindow } from '../../shared/types'
import { clampPercent, type ParsedAccountWindows } from './statusLineParser'

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const USAGE_TIMEOUT_MS = 10_000
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
export const USER_AGENT = 'claude-code/2.1.0'

const CREDENTIALS_FILE = '.credentials.json'
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000
/** Epoch values at or above this are milliseconds; below it they are seconds. */
const MILLISECOND_THRESHOLD = 1e10

const NO_CREDENTIALS_MESSAGE = 'No Claude login found. Sign in with Claude Code first.'
const STALE_TOKEN_MESSAGE = 'Claude login has expired. Use Claude Code once to refresh it, then try again.'
const RATE_LIMITED_MESSAGE = 'Usage service is rate limited. Try again later.'
const SERVER_MESSAGE = 'Anthropic usage service had an error. Try again later.'
const NETWORK_MESSAGE = 'Could not reach the Anthropic usage service. Check your connection and try again.'
const UNAVAILABLE_MESSAGE = 'Anthropic returned no usable usage data.'

export interface CredentialsDeps {
  readonly readFile: (path: string) => Promise<string>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homedir: () => string
}

export type TokenResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly error: UsageRefreshError }

export interface FetchDeps {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly now: () => number
}

export type UsageFetchResult =
  | { readonly ok: true; readonly fiveHour: UsageWindow | null; readonly sevenDay: UsageWindow | null }
  | { readonly ok: false; readonly error: UsageRefreshError }

type JsonObject = Record<string, unknown>

function asRecord(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null
}

function failure(kind: UsageRefreshError['kind'], message: string, retryAfterMs: number | null = null): UsageRefreshError {
  return { kind, message, retryAfterMs }
}

function claudeConfigDir(env: Readonly<Record<string, string | undefined>>, homedir: () => string): string {
  const override = env.CLAUDE_CONFIG_DIR
  return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.claude')
}

/** The access token from a Claude Code credentials document, or null. Never throws. */
function extractToken(raw: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const token = asRecord(asRecord(parsed)?.claudeAiOauth)?.accessToken
  if (typeof token !== 'string') return null
  const trimmed = token.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Reads the Claude Code login token from `<CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json`.
 * Missing, unreadable, corrupt and empty-token cases are all reported as 'no-credentials' without detail.
 */
export async function readClaudeAccessToken(deps: CredentialsDeps): Promise<TokenResult> {
  const noCredentials: TokenResult = {
    ok: false,
    error: failure('no-credentials', NO_CREDENTIALS_MESSAGE)
  }

  let raw: string
  try {
    raw = await deps.readFile(join(claudeConfigDir(deps.env, deps.homedir), CREDENTIALS_FILE))
  } catch {
    return noCredentials
  }

  const token = extractToken(raw)
  return token === null ? noCredentials : { ok: true, token }
}

const SECONDS_TEXT = /^\d+(\.\d+)?$/

/** Retry-After as milliseconds from now: delta-seconds or an HTTP date. Capped at 24 h. Null when absent or invalid. */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null
  const text = header.trim()
  if (text.length === 0) return null

  if (SECONDS_TEXT.test(text)) {
    return Math.min(Math.floor(Number(text) * 1000), MAX_RETRY_AFTER_MS)
  }
  // A signed or otherwise numeric value is not a usable date; reject it before Date.parse can misread it.
  if (/^[+-]?[\d.]+$/.test(text)) return null

  const at = Date.parse(text)
  if (Number.isNaN(at)) return null
  return Math.min(Math.floor(Math.max(0, at - nowMs)), MAX_RETRY_AFTER_MS)
}

function secondsFromEpoch(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  return Math.floor(value >= MILLISECOND_THRESHOLD ? value / 1000 : value)
}

/** A reset time as epoch SECONDS. Accepts epoch seconds, epoch milliseconds, numeric strings and ISO strings. */
export function normalizeResetsAt(value: unknown): number | null {
  if (typeof value === 'number') return secondsFromEpoch(value)
  if (typeof value !== 'string') return null

  const text = value.trim()
  if (text.length === 0) return null
  if (SECONDS_TEXT.test(text)) return secondsFromEpoch(Number(text))

  const ms = Date.parse(text)
  return Number.isNaN(ms) || ms < 0 ? null : Math.floor(ms / 1000)
}

function parseWindow(value: unknown): UsageWindow | null {
  const obj = asRecord(value)
  if (obj === null) return null
  // `utilization` is the current key; `used_percentage` is accepted for the older shape.
  const usedPercentage = clampPercent(obj.utilization) ?? clampPercent(obj.used_percentage)
  if (usedPercentage === null) return null
  return { usedPercentage, resetsAt: normalizeResetsAt(obj.resets_at) }
}

/** Both windows from the usage response body. Anything unusable yields null for that window. */
export function parseUsageResponse(json: unknown): ParsedAccountWindows {
  const root = asRecord(json)
  if (root === null) return { fiveHour: null, sevenDay: null }
  return { fiveHour: parseWindow(root.five_hour), sevenDay: parseWindow(root.seven_day) }
}

/** Maps a non-OK HTTP status to the refresh error the user sees. */
export function classifyHttpStatus(status: number, retryAfterHeader: string | null, nowMs: number): UsageRefreshError {
  if (status === 401 || status === 403) {
    return failure('stale-token', STALE_TOKEN_MESSAGE)
  }
  if (status === 429) {
    return failure('rate-limited', RATE_LIMITED_MESSAGE, parseRetryAfterMs(retryAfterHeader, nowMs))
  }
  if (status >= 500) {
    return failure('server', SERVER_MESSAGE)
  }
  return failure('unavailable', UNAVAILABLE_MESSAGE)
}

/** Requests the account usage windows. Every failure is mapped to a UsageRefreshError; nothing throws. */
export async function fetchOAuthUsage(token: string, deps: FetchDeps): Promise<UsageFetchResult> {
  let response: Response
  try {
    response = await deps.fetch(USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        'User-Agent': USER_AGENT
      },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS)
    })
  } catch {
    // DNS, offline, abort and timeout all arrive here. The thrown error is dropped on purpose: it may echo the request.
    return { ok: false, error: failure('network', NETWORK_MESSAGE) }
  }

  if (!response.ok) {
    return { ok: false, error: classifyHttpStatus(response.status, response.headers.get('retry-after'), deps.now()) }
  }

  let text: string
  try {
    text = await response.text()
  } catch {
    return { ok: false, error: failure('network', NETWORK_MESSAGE) }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: failure('unavailable', UNAVAILABLE_MESSAGE) }
  }

  const windows = parseUsageResponse(json)
  if (windows.fiveHour === null && windows.sevenDay === null) {
    return { ok: false, error: failure('unavailable', UNAVAILABLE_MESSAGE) }
  }
  return { ok: true, fiveHour: windows.fiveHour, sevenDay: windows.sevenDay }
}
