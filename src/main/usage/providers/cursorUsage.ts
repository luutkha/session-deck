// Cursor plan quota (D96): read cursor-agent's own login from disk and ask the cursor.com dashboard for its
// usage summary. Ported from Orca's cursor provider, adapted to ProviderUsageDeps. Read-only: nothing is written,
// no login flow is started, and the token stays here (never in a result, error or log).
import { dirname, join } from 'node:path'
import { isRecord } from '../../../shared/guards'
import { parseRetryAfterMs } from '../oauthUsage'
import {
  PROVIDER_HTTP_TIMEOUT_MS,
  type ProviderHttpResponse,
  type ProviderUsageDeps,
  type ProviderUsageResult,
  type ProviderWindows
} from './providerUsageTypes'

const DASHBOARD_ORIGIN = 'https://cursor.com'
export const USAGE_SUMMARY_URL = `${DASHBOARD_ORIGIN}/api/usage-summary`
export const CURRENT_PERIOD_URL = `${DASHBOARD_ORIGIN}/api/dashboard/get-current-period-usage`
export const LEGACY_USAGE_URL = `${DASHBOARD_ORIGIN}/api/usage`

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** Numeric dashboard dates mix epoch seconds and milliseconds; ISO strings are accepted too. */
const SECONDS_THRESHOLD = 1e12

function fail(
  reason: 'not-signed-in' | 'unauthorized' | 'rate-limited' | 'unavailable',
  retryAfterMs?: number
): ProviderUsageResult {
  return retryAfterMs === undefined ? { ok: false, reason } : { ok: false, reason, retryAfterMs }
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function percent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

type WindowSlot = keyof ProviderWindows

/** Config dirs used by `cursor-agent`: Windows keeps auth next to the Roaming IDE folder. */
function cursorAuthPath(deps: ProviderUsageDeps): string {
  if (deps.platform === 'win32') {
    const roaming = deps.env.APPDATA?.trim() || join(deps.homeDir, 'AppData', 'Roaming')
    return join(roaming, 'Cursor', 'auth.json')
  }
  if (deps.platform === 'darwin') {
    return join(deps.homeDir, '.cursor', 'auth.json')
  }
  const config = deps.env.XDG_CONFIG_HOME?.trim() || join(deps.homeDir, '.config')
  return join(config, 'cursor', 'auth.json')
}

interface CursorLogin {
  readonly token: string
  /** WorkOS subject: the first half of the dashboard session cookie, also used by the legacy endpoint. */
  readonly subject: string | null
  readonly expiresAtMs: number | null
}

type LoginRead =
  | { readonly status: 'ok'; readonly login: CursorLogin }
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable' }

function tokenFromDocument(value: unknown): string | null {
  const token = isRecord(value) ? value.accessToken : null
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null
}

/**
 * cursor-agent stores a JWT; its `sub` builds the dashboard cookie and `exp` tells us the login is stale before
 * spending an HTTP call. A non-JWT token is still usable as a bearer credential, so it is kept without a subject.
 */
function loginFromToken(raw: string): CursorLogin {
  const token = raw.trim()
  const parts = token.split('.')
  let subject: string | null = null
  let expiresAtMs: number | null = null
  if (parts.length >= 2 && parts[1]) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
      const payload: unknown = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
      if (isRecord(payload)) {
        subject = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : null
        const exp = readNumber(payload.exp)
        expiresAtMs = exp === null ? null : exp * 1000
      }
    } catch {
      // Not a decodable JWT: the token itself may still authenticate, so keep it without metadata.
    }
  }
  return { token, subject, expiresAtMs }
}

/** Decrypted DPAPI plaintext is an auth.json-shaped document (older builds may hold the bare token). */
function tokenFromPlaintext(plain: Buffer): string | null {
  const text = plain.toString('utf8').trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      return tokenFromDocument(JSON.parse(text))
    } catch {
      return null
    }
  }
  return /^[A-Za-z0-9._~+/-]+=*$/.test(text) ? text : null
}

type DpapiRead =
  | { readonly status: 'ok'; readonly token: string }
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable' }

async function readDpapiToken(deps: ProviderUsageDeps, authPath: string): Promise<DpapiRead> {
  if (deps.platform !== 'win32' || !deps.dpapiUnprotect) return { status: 'missing' }
  const sidecar = join(dirname(authPath), 'auth.dpapi')
  let encoded: string | null = null
  try {
    const text = await deps.readTextFile(sidecar)
    if (text !== null) {
      const parsed: unknown = JSON.parse(text)
      const blob = isRecord(parsed) && parsed.version === 1 && typeof parsed.dpapi === 'string' ? parsed.dpapi : null
      if (blob && /^[A-Za-z0-9+/]+={0,2}$/.test(blob)) encoded = blob
    }
  } catch {
    // A missing/invalid sidecar is handled by the caller as a sign-in that cannot be used here.
  }
  if (encoded === null) {
    // Some installs write the raw blob instead of the JSON sidecar; both arrive through deps.
    try {
      const raw = await deps.readBinaryFile(sidecar)
      if (!raw || raw.length === 0) return { status: 'missing' }
      const plain = await deps.dpapiUnprotect(raw)
      const token = plain === null ? null : tokenFromPlaintext(plain)
      return token === null ? { status: 'unavailable' } : { status: 'ok', token }
    } catch {
      return { status: 'unavailable' }
    }
  }
  try {
    const plain = await deps.dpapiUnprotect(Buffer.from(encoded, 'base64'))
    const token = plain === null ? null : tokenFromPlaintext(plain)
    return token === null ? { status: 'unavailable' } : { status: 'ok', token }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Reads the login without Keychain, secret-tool or the IDE's state.vscdb (out of scope for this provider). */
async function readCursorLogin(deps: ProviderUsageDeps): Promise<LoginRead> {
  const authPath = cursorAuthPath(deps)
  let raw: string | null
  try {
    raw = await deps.readTextFile(authPath)
  } catch {
    return { status: 'unavailable' }
  }
  if (raw === null) return { status: 'missing' }

  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return { status: 'unavailable' }
  }
  if (!isRecord(doc)) return { status: 'missing' }

  const direct = tokenFromDocument(doc)
  if (direct !== null) return { status: 'ok', login: loginFromToken(direct) }
  // cursor-agent 2026.11+ leaves only this marker in auth.json; the token lives in auth.dpapi on Windows.
  if (doc.storedIn !== 'os-secret-store') return { status: 'missing' }
  const decrypted = await readDpapiToken(deps, authPath)
  return decrypted.status === 'ok'
    ? { status: 'ok', login: loginFromToken(decrypted.token) }
    : { status: decrypted.status }
}

/** Dashboard calls need the Origin/Referer pair: a bare session cookie gets 403. */
function requestHeaders(login: CursorLogin, method: 'GET' | 'POST'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Origin: DASHBOARD_ORIGIN,
    Referer: `${DASHBOARD_ORIGIN}/dashboard`
  }
  // encodeURIComponent only on the subject; the JWT is already URL-safe and Orca sends it verbatim.
  if (login.subject !== null) {
    headers.Cookie = `WorkosCursorSessionToken=${encodeURIComponent(login.subject)}%3A%3A${login.token}`
  } else {
    // A token without a decodable WorkOS subject cannot form the dashboard cookie.
    headers.Authorization = `Bearer ${login.token}`
  }
  if (method === 'POST') headers['Content-Type'] = 'application/json'
  return headers
}

type FetchOutcome = { readonly kind: 'data'; readonly data: unknown } | { readonly kind: 'failure'; readonly result: ProviderUsageResult }

async function requestJson(
  deps: ProviderUsageDeps,
  login: CursorLogin,
  url: string,
  method: 'GET' | 'POST'
): Promise<FetchOutcome> {
  let response: ProviderHttpResponse
  try {
    response = await deps.http(url, {
      method,
      headers: requestHeaders(login, method),
      ...(method === 'POST' ? { body: '{}' } : {}),
      timeoutMs: PROVIDER_HTTP_TIMEOUT_MS
    })
  } catch {
    return { kind: 'failure', result: fail('unavailable') }
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: 'failure', result: fail('unauthorized') }
  }
  if (response.status === 429) {
    let retryAfterMs: number | undefined
    try {
      const parsed = parseRetryAfterMs(response.headers.get('retry-after'), deps.now())
      if (parsed !== null) retryAfterMs = parsed
    } catch {
      // A hostile header implementation must not turn a rate limit into a thrown error.
    }
    return { kind: 'failure', result: fail('rate-limited', retryAfterMs) }
  }
  if (response.status < 200 || response.status >= 300) {
    return { kind: 'failure', result: fail('unavailable') }
  }
  try {
    return { kind: 'data', data: await response.json() }
  } catch {
    return { kind: 'failure', result: fail('unavailable') }
  }
}

interface CursorPool {
  readonly enabled: boolean
  readonly total: number | null
  readonly used: number | null
  readonly limit: number | null
  readonly auto: number | null
  readonly api: number | null
}

function readPool(value: unknown): CursorPool | null {
  const obj = isRecord(value) ? value : null
  if (!obj) return null
  return {
    enabled: obj.enabled !== false,
    total: readNumber(obj.totalPercentUsed),
    used: readNumber(obj.used),
    limit: readNumber(obj.limit),
    auto: readNumber(obj.autoPercentUsed),
    api: readNumber(obj.apiPercentUsed)
  }
}

/** The effective percentage: Cursor's computed total wins over its raw used/limit base. */
function planPercent(pool: CursorPool | null): number | null {
  if (!pool) return null
  if (pool.total !== null) return pool.total
  return pool.used !== null && pool.limit !== null && pool.limit > 0 ? (pool.used / pool.limit) * 100 : null
}

/** On-demand is metered separately, so its raw allowance is the better percentage there. */
function onDemandPercent(pool: CursorPool): number | null {
  return pool.used !== null && pool.limit !== null && pool.limit > 0 ? (pool.used / pool.limit) * 100 : pool.total
}

/** A disabled primary pool must not hide the fallback pool Cursor actually meters. */
function preferredPool(primary: CursorPool | null, fallback: CursorPool | null): CursorPool | null {
  return primary?.enabled === false && fallback?.enabled === true ? fallback : (primary ?? fallback)
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? (value > SECONDS_THRESHOLD ? value : value * 1000) : null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  if (/^\d+(\.\d+)?$/.test(text)) return parseTimestampMs(Number(text))
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Classify by the reported period length, not by field name: unified plans can bill weekly or monthly.
 * Tolerance covers Cursor's 28-31 day months and slightly long 5-hour/7-day periods.
 */
export function classifyCursorWindow(startMs: number | null, endMs: number | null): WindowSlot {
  if (startMs === null || endMs === null || endMs <= startMs) return 'monthly'
  const durationMs = endMs - startMs
  if (durationMs <= 6 * HOUR_MS) return 'fiveHour'
  if (durationMs <= 9 * DAY_MS) return 'sevenDay'
  return 'monthly'
}

function makeWindow(slot: WindowSlot, used: number, resetsAt: number | null): ProviderWindows {
  const window = { usedPercentage: percent(used), resetsAt }
  return {
    fiveHour: slot === 'fiveHour' ? window : null,
    sevenDay: slot === 'sevenDay' ? window : null,
    monthly: slot === 'monthly' ? window : null
  }
}

function hasWindow(windows: ProviderWindows): boolean {
  return windows.fiveHour !== null || windows.sevenDay !== null || windows.monthly !== null
}

/** Maps /api/usage-summary and /api/dashboard/get-current-period-usage (the same pool shape). */
export function mapCursorUsagePayload(payload: unknown): ProviderWindows | null {
  const root = isRecord(payload) ? payload : null
  if (!root) return null
  const startMs = parseTimestampMs(root.billingCycleStart)
  const endMs = parseTimestampMs(root.billingCycleEnd)
  const slot = classifyCursorWindow(startMs, endMs)
  const resetsAt = endMs === null ? null : Math.floor(endMs / 1000)

  const individual = isRecord(root.individualUsage) ? root.individualUsage : null
  const plan = preferredPool(readPool(individual?.plan), readPool(individual?.overall))
  let used = plan && plan.enabled !== false ? planPercent(plan) : null
  // Orca also exposes separate model pools; use them when the primary total is absent or disabled.
  if (used === null && plan && plan.enabled !== false) used = plan.auto ?? plan.api
  if (used === null) {
    const onDemand = readPool(individual?.onDemand)
    if (onDemand?.enabled === true) used = onDemandPercent(onDemand)
  }
  // The current-period endpoint names the pool directly instead of nesting it under individualUsage.
  if (used === null) used = planPercent(readPool(root.planUsage))
  return used === null ? null : makeWindow(slot, used, resetsAt)
}

/** Clamp month-end in UTC so January 31 advances into February, not March. */
function addOneMonthUtc(startMs: number): number {
  const start = new Date(startMs)
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth()
  const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate()
  return Date.UTC(
    year,
    month + 1,
    Math.min(start.getUTCDate(), lastDayOfNextMonth),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds()
  )
}

/** Older plans report per-model request quotas instead of a currency allowance. */
export function mapCursorLegacyUsage(payload: unknown): ProviderWindows | null {
  const root = isRecord(payload) ? payload : null
  if (!root) return null
  let chosen: { readonly used: number; readonly limit: number } | null = null
  for (const [name, value] of Object.entries(root)) {
    const entry = isRecord(value) ? value : null
    if (!entry) continue
    const used = readNumber(entry.numRequests)
    const limit = readNumber(entry.maxRequestUsage)
    if (used === null || limit === null || limit <= 0) continue
    // Legacy premium plans meter gpt-4; otherwise the largest ceiling is the member's allowance.
    if (name === 'gpt-4') {
      chosen = { used, limit }
      break
    }
    if (chosen === null || limit > chosen.limit) chosen = { used, limit }
  }
  if (chosen === null) return null
  const startMs = parseTimestampMs(root.startOfMonth)
  const resetMs = startMs === null ? null : addOneMonthUtc(startMs)
  return makeWindow('monthly', (chosen.used / chosen.limit) * 100, resetMs === null ? null : Math.floor(resetMs / 1000))
}

/** Read Cursor's allowance with as few dashboard calls as possible; never throws. */
export async function fetchCursorUsage(deps: ProviderUsageDeps): Promise<ProviderUsageResult> {
  try {
    const read = await readCursorLogin(deps)
    if (read.status === 'missing') return fail('not-signed-in')
    if (read.status === 'unavailable') return fail('unavailable')
    const login = read.login
    // An expired token is a stale login: hide the bar rather than spending a request that will be refused.
    if (login.expiresAtMs !== null && login.expiresAtMs <= deps.now()) return fail('unauthorized')

    // The summary already carries a percentage and the billing-cycle reset for most plans: stop after one call.
    const summary = await requestJson(deps, login, USAGE_SUMMARY_URL, 'GET')
    if (summary.kind === 'failure') return summary.result
    const mapped = mapCursorUsagePayload(summary.data)
    if (mapped && hasWindow(mapped)) return { ok: true, windows: mapped }

    // Unified/weekly plans can leave the summary's plan pool empty: ask for the current period instead.
    const current = await requestJson(deps, login, CURRENT_PERIOD_URL, 'POST')
    if (current.kind === 'failure') return current.result
    const currentWindows = mapCursorUsagePayload(current.data)
    if (currentWindows && hasWindow(currentWindows)) return { ok: true, windows: currentWindows }

    if (login.subject !== null) {
      const legacy = await requestJson(deps, login, `${LEGACY_USAGE_URL}?user=${encodeURIComponent(login.subject)}`, 'GET')
      if (legacy.kind === 'failure') return legacy.result
      const legacyWindows = mapCursorLegacyUsage(legacy.data)
      if (legacyWindows && hasWindow(legacyWindows)) return { ok: true, windows: legacyWindows }
    }
    return fail('unavailable')
  } catch {
    return fail('unavailable')
  }
}
