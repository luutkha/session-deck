import { describe, expect, it, vi } from 'vitest'
import { fetchGrokUsage } from './grokUsage'
import { PROVIDER_HTTP_TIMEOUT_MS } from './providerUsageTypes'
import type { ProviderHttpInit, ProviderHttpResponse, ProviderUsageDeps } from './providerUsageTypes'

const NOW_MS = Date.parse('2026-11-27T12:00:00Z')
const HOME = 'C:\\Users\\Test User'
const AUTH_PATH = `${HOME}\\.grok\\auth.json`
const CREDITS_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const DEFAULT_URL = 'https://cli-chat-proxy.grok.com/v1/billing'
const ISSUER = 'https://auth.x.ai'
const TOKEN = 'grok-secret-token-12345'
const USER_ID = 'user-account-999'

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { key: TOKEN, user_id: USER_ID, expires_at: '2099-01-01T00:00:00Z', ...overrides }
}

function auth(entries: Record<string, unknown> = { [ISSUER]: entry() }): string {
  return JSON.stringify(entries)
}

function response(status: number, body: unknown, headers: Record<string, string> = {}, jsonError?: Error): ProviderHttpResponse {
  // Fetch headers are case-insensitive; normalise the keys so fakes behave like a real Response.
  const lookup: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) lookup[name.toLowerCase()] = value
  return {
    status,
    headers: { get: (name: string) => lookup[name.toLowerCase()] ?? null },
    json: async () => {
      if (jsonError) throw jsonError
      return body
    },
    text: async () => JSON.stringify(body)
  }
}

interface Options {
  /** Raw auth.json contents; undefined means a valid default login. */
  readonly raw?: string | null
  /** One body per HTTP call (credits first, default billing second). A single body applies to both. */
  readonly bodies?: readonly unknown[]
  readonly statuses?: readonly number[]
  readonly headers?: readonly Record<string, string>[]
  readonly httpError?: Error
  readonly jsonError?: Error
}

function harness(options: Options = {}): { deps: ProviderUsageDeps; http: ReturnType<typeof vi.fn>; readTextFile: ReturnType<typeof vi.fn> } {
  const readTextFile = vi.fn<(path: string) => Promise<string | null>>(async () =>
    options.raw === undefined ? auth() : options.raw
  )
  let call = 0
  const http = vi.fn<(url: string, init: ProviderHttpInit) => Promise<ProviderHttpResponse>>(async () => {
    const index = call++
    if (options.httpError) throw options.httpError
    const status = options.statuses?.[index] ?? options.statuses?.[0] ?? 200
    const body = options.bodies?.[index] ?? options.bodies?.[0] ?? {}
    const headers = options.headers?.[index] ?? options.headers?.[0] ?? {}
    return response(status, body, headers, index === 0 ? options.jsonError : undefined)
  })
  return {
    http,
    readTextFile,
    deps: {
      platform: 'win32',
      homeDir: HOME,
      env: {},
      now: () => NOW_MS,
      readTextFile,
      readBinaryFile: async () => null,
      http
    }
  }
}

const WEEK = {
  currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-24T00:00:00Z', end: '2026-12-01T00:00:00Z' },
  billingPeriodStart: '2026-11-24T00:00:00Z',
  billingPeriodEnd: '2026-12-01T00:00:00Z'
}

describe('fetchGrokUsage', () => {
  it('maps creditUsagePercent to the 7-day window with an epoch-second reset', async () => {
    const h = harness({ bodies: [{ ...WEEK, creditUsagePercent: 42 }] })
    expect(await fetchGrokUsage(h.deps)).toEqual({
      ok: true,
      windows: {
        fiveHour: null,
        sevenDay: { usedPercentage: 42, resetsAt: Date.parse('2026-12-01T00:00:00Z') / 1000 },
        monthly: null
      }
    })
  })

  it('reads only the CLI auth path and sends the CLI headers with a timeout', async () => {
    const h = harness({ bodies: [{ creditUsagePercent: 1 }] })
    await fetchGrokUsage(h.deps)
    expect(h.readTextFile).toHaveBeenCalledWith(AUTH_PATH)
    expect(h.http).toHaveBeenCalledTimes(1)
    const [url, init] = h.http.mock.calls[0]
    expect(url).toBe(CREDITS_URL)
    expect(init).toEqual({
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'X-XAI-Token-Auth': 'xai-grok-cli',
        Accept: 'application/json',
        'x-userid': USER_ID
      },
      timeoutMs: PROVIDER_HTTP_TIMEOUT_MS
    })
  })

  it('accepts a nested config and a flat billing response', async () => {
    const nested = await fetchGrokUsage(harness({ bodies: [{ config: { creditUsagePercent: 7 } }] }).deps)
    const flat = await fetchGrokUsage(harness({ bodies: [{ creditUsagePercent: 7 }] }).deps)
    expect(nested).toEqual(flat)
    expect(nested).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: { usedPercentage: 7, resetsAt: null }, monthly: null }
    })
  })

  it('maps a monthly spend/limit pair in the credits response without a second call', async () => {
    const h = harness({
      bodies: [{ monthlyLimit: { val: '100.00' }, used: { val: 25 }, billingPeriodEnd: '2026-12-01T00:00:00Z' }]
    })
    expect(await fetchGrokUsage(h.deps)).toEqual({
      ok: true,
      windows: {
        fiveHour: null,
        sevenDay: null,
        monthly: { usedPercentage: 25, resetsAt: Date.parse('2026-12-01T00:00:00Z') / 1000 }
      }
    })
    expect(h.http).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default billing view for monthly quota and checks both timeouts', async () => {
    const h = harness({
      bodies: [{ subscriptionTier: 'super' }, {
        config: { monthlyLimit: { val: 200 }, used: { val: 50 }, billingPeriodEnd: '2026-12-01T00:00:00Z' }
      }]
    })
    expect(await fetchGrokUsage(h.deps)).toEqual({
      ok: true,
      windows: {
        fiveHour: null,
        sevenDay: null,
        monthly: { usedPercentage: 25, resetsAt: Date.parse('2026-12-01T00:00:00Z') / 1000 }
      }
    })
    expect(h.http).toHaveBeenCalledTimes(2)
    expect(h.http.mock.calls.map((call) => call[0])).toEqual([CREDITS_URL, DEFAULT_URL])
    for (const [, init] of h.http.mock.calls) expect(init.timeoutMs).toBe(PROVIDER_HTTP_TIMEOUT_MS)
  })

  it('does not invent a window from a credits balance alone', async () => {
    const h = harness({ bodies: [{ prepaidBalance: { val: 12.5 }, subscriptionTier: 'super' }, {}] })
    expect(await fetchGrokUsage(h.deps)).toEqual({ ok: false, reason: 'unavailable' })
    expect(h.http).toHaveBeenCalledTimes(2)
  })

  it('derives a zero weekly window only from a confirmed weekly period', async () => {
    expect(await fetchGrokUsage(harness({ bodies: [WEEK] }).deps)).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: { usedPercentage: 0, resetsAt: Date.parse('2026-12-01T00:00:00Z') / 1000 }, monthly: null }
    })
    // Matching bounds are required: an unconfirmed period must not become a fake 0% window.
    expect(await fetchGrokUsage(harness({ bodies: [{ ...WEEK, billingPeriodEnd: '2026-12-02T00:00:00Z' }] }).deps)).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('does not report weekly zero when a zero cap hides positive spend', async () => {
    const h = harness({ bodies: [{ onDemandCap: { val: 0 }, onDemandUsed: { val: 5 } }, {}] })
    expect(await fetchGrokUsage(h.deps)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('clamps percentages and converts epoch-millisecond and relative resets', async () => {
    for (const [percent, expected] of [[150, 100], [-5, 0]] as const) {
      const result = await fetchGrokUsage(harness({ bodies: [{ creditUsagePercent: percent }] }).deps)
      expect(result).toEqual({
        ok: true,
        windows: { fiveHour: null, sevenDay: { usedPercentage: expected, resetsAt: null }, monthly: null }
      })
    }
    const ms = await fetchGrokUsage(harness({
      bodies: [{ creditUsagePercent: 1, billingPeriodEnd: '1791894600000' }]
    }).deps)
    expect(ms).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: { usedPercentage: 1, resetsAt: 1_791_894_600 }, monthly: null }
    })
    const relative = await fetchGrokUsage(harness({
      bodies: [{ creditUsagePercent: 1, billingPeriodEnd: '600' }]
    }).deps)
    expect(relative).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: { usedPercentage: 1, resetsAt: Math.floor(NOW_MS / 1000) + 600 }, monthly: null }
    })
  })

  it('prefers the default x.ai login and keeps an alternate issuer as fallback', async () => {
    const h = harness({
      raw: auth({
        'https://other.example': entry({ key: 'alternate-token' }),
        [ISSUER]: entry({ key: TOKEN }),
        [`${ISSUER}::web`]: entry({ key: 'web-token' })
      }),
      bodies: [{ creditUsagePercent: 3 }]
    })
    await fetchGrokUsage(h.deps)
    expect(h.http.mock.calls[0][1].headers?.Authorization).toBe(`Bearer ${TOKEN}`)

    const fallback = harness({
      raw: auth({ 'https://other.example': entry({ key: 'alternate-token' }) }),
      bodies: [{ creditUsagePercent: 3 }]
    })
    await fetchGrokUsage(fallback.deps)
    expect(fallback.http.mock.calls[0][1].headers?.Authorization).toBe('Bearer alternate-token')
  })

  it('omits x-userid when the login has no user id', async () => {
    const h = harness({ raw: auth({ [ISSUER]: entry({ user_id: undefined }) }), bodies: [{ creditUsagePercent: 1 }] })
    await fetchGrokUsage(h.deps)
    expect(h.http.mock.calls[0][1].headers?.['x-userid']).toBeUndefined()
  })

  it('reports not-signed-in for a missing file, no token or a keyed logout', async () => {
    const cases: Options[] = [
      { raw: null },
      { raw: JSON.stringify({ [ISSUER]: { expires_at: '2099-01-01T00:00:00Z' } }) },
      { raw: auth({ [ISSUER]: entry({ key: '' }) }) },
      { raw: auth({ 'https://other.example': entry({ key: 'x' }), [ISSUER]: entry({ key: '' }) }) }
    ]
    for (const options of cases) {
      const h = harness(options)
      expect(await fetchGrokUsage(h.deps)).toEqual({ ok: false, reason: 'not-signed-in' })
      expect(h.http).not.toHaveBeenCalled()
    }
  })

  it('reports unauthorized for 401/403, an expired login and a stale preferred issuer', async () => {
    expect(await fetchGrokUsage(harness({ statuses: [401] }).deps)).toEqual({ ok: false, reason: 'unauthorized' })
    expect(await fetchGrokUsage(harness({ statuses: [403] }).deps)).toEqual({ ok: false, reason: 'unauthorized' })
    const expired = harness({ raw: auth({ [ISSUER]: entry({ expires_at: '2020-01-01T00:00:00Z' }) }) })
    expect(await fetchGrokUsage(expired.deps)).toEqual({ ok: false, reason: 'unauthorized' })
    expect(expired.http).not.toHaveBeenCalled()
    // Orca prefers the default issuer even when expired; a fresh alternate does not override it.
    const preferred = harness({
      raw: auth({ 'https://other.example': entry({ key: 'fresh-alternate' }), [ISSUER]: entry({ expires_at: '2020-01-01T00:00:00Z' }) })
    })
    expect(await fetchGrokUsage(preferred.deps)).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('reports rate-limited with parsed Retry-After, including on the fallback call', async () => {
    expect(await fetchGrokUsage(harness({ statuses: [429] }).deps)).toEqual({ ok: false, reason: 'rate-limited' })
    expect(await fetchGrokUsage(harness({ statuses: [429], headers: [{ 'Retry-After': '45' }] }).deps)).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterMs: 45_000
    })
    const at = new Date(NOW_MS + 120_000).toUTCString()
    expect(await fetchGrokUsage(harness({ statuses: [429], headers: [{ 'retry-after': at }] }).deps)).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterMs: 120_000
    })
    expect(await fetchGrokUsage(harness({ statuses: [429], headers: [{ 'Retry-After': 'garbage' }] }).deps)).toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    expect(await fetchGrokUsage(harness({
      statuses: [200, 429],
      bodies: [{ subscriptionTier: 'super' }, {}],
      headers: [{}, { 'Retry-After': '9' }]
    }).deps)).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterMs: 9_000
    })
  })

  it('reports unavailable for bad auth JSON, network errors, bad response JSON and server errors', async () => {
    const cases: Options[] = [
      { raw: 'not json' },
      { raw: JSON.stringify([]) },
      { statuses: [500] },
      { statuses: [200, 500], bodies: [{}, {}] },
      { httpError: new Error('offline') },
      { jsonError: new Error('bad response') },
      { bodies: [null] },
      { bodies: [{ unrelatedField: true }] }
    ]
    for (const options of cases) {
      expect(await fetchGrokUsage(harness(options).deps)).toEqual({ ok: false, reason: 'unavailable' })
    }
  })

  it('never includes the token or account id in any result', async () => {
    const cases: Options[] = [
      { bodies: [{ creditUsagePercent: 12 }] },
      { statuses: [401] },
      { statuses: [429], headers: [{ 'Retry-After': '5' }] },
      { httpError: new Error(`failed for Bearer ${TOKEN} / ${USER_ID}`) },
      { raw: 'not json' },
      { bodies: [{ creditUsagePercent: 1 }, { monthlyLimit: { val: 1 }, used: { val: 1 } }] }
    ]
    for (const options of cases) {
      const text = JSON.stringify(await fetchGrokUsage(harness(options).deps))
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(USER_ID)
    }
  })
})
