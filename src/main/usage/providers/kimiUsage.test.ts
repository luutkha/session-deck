import { describe, expect, it, vi } from 'vitest'
import { fetchKimiUsage } from './kimiUsage'
import { PROVIDER_HTTP_TIMEOUT_MS } from './providerUsageTypes'
import type { ProviderHttpInit, ProviderHttpResponse, ProviderUsageDeps } from './providerUsageTypes'

const NOW_MS = Date.parse('2026-11-27T12:00:00Z')
const NOW_SECONDS = Math.floor(NOW_MS / 1000)
const HOME = 'C:\\Users\\Test User'
const CREDENTIAL_PATH = `${HOME}\\.kimi-code\\credentials\\kimi-code.json`
const USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
// A deliberately fake token: whatever the fetcher returns must not contain it.
const TOKEN = 'kimi-secret-token-12345'

function credentials(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ access_token: TOKEN, expires_at: NOW_SECONDS + 3600, ...overrides })
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
  readonly raw?: string | null
  readonly status?: number
  readonly body?: unknown
  readonly headers?: Record<string, string>
  readonly httpError?: Error
  readonly jsonError?: Error
}

function harness(options: Options = {}): { deps: ProviderUsageDeps; http: ReturnType<typeof vi.fn>; readTextFile: ReturnType<typeof vi.fn> } {
  const readTextFile = vi.fn<(path: string) => Promise<string | null>>(async () =>
    options.raw === undefined ? credentials() : options.raw
  )
  const http = vi.fn<(url: string, init: ProviderHttpInit) => Promise<ProviderHttpResponse>>(async () => {
    if (options.httpError) throw options.httpError
    return response(options.status ?? 200, options.body ?? {}, options.headers, options.jsonError)
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

const FULL_USAGE = {
  usage: { limit: 100, used: 34, resetTime: '2026-11-27T17:00:00Z' },
  limits: [
    { window: { duration: 5, timeUnit: 'HOUR' }, detail: { limit: 50, remaining: 42, resetTime: '2026-11-27T13:00:00Z' } },
    { window: { duration: 7, timeUnit: 'DAY' }, detail: { limit: 100, used: 90 } }
  ],
  usages: { limit_month_total: { used_ratio: 0.25, reset_time: '2026-12-01T00:00:00Z' } }
}

describe('fetchKimiUsage', () => {
  it('maps the three plan windows from the CLI credential and usage endpoint', async () => {
    const h = harness({ body: FULL_USAGE })
    expect(await fetchKimiUsage(h.deps)).toEqual({
      ok: true,
      windows: {
        fiveHour: { usedPercentage: 16, resetsAt: Date.parse('2026-11-27T13:00:00Z') / 1000 },
        sevenDay: { usedPercentage: 34, resetsAt: Date.parse('2026-11-27T17:00:00Z') / 1000 },
        monthly: { usedPercentage: 25, resetsAt: Date.parse('2026-12-01T00:00:00Z') / 1000 }
      }
    })
  })

  it('reads only the CLI credential path and sends GET with the token and a timeout', async () => {
    const h = harness({ body: FULL_USAGE })
    await fetchKimiUsage(h.deps)
    expect(h.readTextFile).toHaveBeenCalledWith(CREDENTIAL_PATH)
    expect(h.http).toHaveBeenCalledTimes(1)
    const [url, init] = h.http.mock.calls[0]
    expect(url).toBe(USAGE_URL)
    expect(init).toEqual({
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      timeoutMs: PROVIDER_HTTP_TIMEOUT_MS
    })
  })

  it('never includes the token in a success or a failure result', async () => {
    const ok = await fetchKimiUsage(harness({ body: FULL_USAGE }).deps)
    expect(JSON.stringify(ok)).not.toContain(TOKEN)
    for (const options of [
      { status: 401 },
      { status: 429, headers: { 'Retry-After': '10' } },
      { httpError: new Error(`request failed for Bearer ${TOKEN}`) },
      { jsonError: new Error(`bad body from ${TOKEN}`) },
      { raw: credentials({ access_token: TOKEN }) }
    ]) {
      const result = await fetchKimiUsage(harness(options).deps)
      expect(JSON.stringify(result)).not.toContain(TOKEN)
    }
  })

  it('reports not-signed-in when the login file or token is missing', async () => {
    const cases: Options[] = [
      { raw: null },
      { raw: JSON.stringify({ expires_at: NOW_SECONDS + 3600 }) },
      { raw: credentials({ access_token: '   ' }) },
      { raw: JSON.stringify({ access_token: 1234 }) }
    ]
    for (const options of cases) {
      const h = harness(options)
      expect(await fetchKimiUsage(h.deps)).toEqual({ ok: false, reason: 'not-signed-in' })
      expect(h.http).not.toHaveBeenCalled()
    }
  })

  it('reports unauthorized for 401/403 and for an already expired local token', async () => {
    expect(await fetchKimiUsage(harness({ status: 401 }).deps)).toEqual({ ok: false, reason: 'unauthorized' })
    expect(await fetchKimiUsage(harness({ status: 403 }).deps)).toEqual({ ok: false, reason: 'unauthorized' })
    const h = harness({ raw: credentials({ expires_at: NOW_SECONDS - 10 }) })
    expect(await fetchKimiUsage(h.deps)).toEqual({ ok: false, reason: 'unauthorized' })
    expect(h.http).not.toHaveBeenCalled()
  })

  it('reports rate-limited and parses Retry-After as seconds or an HTTP date', async () => {
    expect(await fetchKimiUsage(harness({ status: 429 }).deps)).toEqual({ ok: false, reason: 'rate-limited' })
    expect(await fetchKimiUsage(harness({ status: 429, headers: { 'Retry-After': '30' } }).deps)).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterMs: 30_000
    })
    const at = new Date(NOW_MS + 5 * 60_000).toUTCString()
    expect(await fetchKimiUsage(harness({ status: 429, headers: { 'retry-after': at } }).deps)).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterMs: 300_000
    })
    expect(await fetchKimiUsage(harness({ status: 429, headers: { 'Retry-After': 'not-a-date' } }).deps)).toEqual({
      ok: false,
      reason: 'rate-limited'
    })
  })

  it('reports unavailable for bad JSON, network errors, server errors and unusable windows', async () => {
    const cases: Options[] = [
      { raw: '{not json' },
      { raw: JSON.stringify(['not an object']) },
      { status: 500 },
      { status: 200, httpError: new Error('offline') },
      { body: {}, jsonError: new Error('bad json') },
      { body: null },
      { body: { usage: { limit: 0, used: 3 } } },
      { body: { limits: [{ window: { duration: 1, timeUnit: 'DAY' }, detail: { limit: 10, used: 1 } }] } }
    ]
    for (const options of cases) {
      expect(await fetchKimiUsage(harness(options).deps)).toEqual({ ok: false, reason: 'unavailable' })
    }
  })

  it('tolerates missing fields and keeps the windows that remain usable', async () => {
    const result = await fetchKimiUsage(harness({
      body: {
        usage: { limit: 10, used: 1 }, // no reset time
        limits: [
          { window: { duration: 5, timeUnit: 'HOUR' }, detail: { limit: 10 } }, // no used/remaining
          { window: { duration: 5, timeUnit: 'HOUR' }, detail: { limit: 10, remaining: 9, resetAt: '2026-11-27T13:00:00Z' } }
        ],
        usages: { limit_month_total: {} }
      }
    }).deps)
    expect(result).toEqual({
      ok: true,
      windows: {
        fiveHour: { usedPercentage: 10, resetsAt: Date.parse('2026-11-27T13:00:00Z') / 1000 },
        sevenDay: { usedPercentage: 10, resetsAt: null },
        monthly: null
      }
    })
  })

  it('classifies windows by duration with tolerance and prefers the one nearest 5 hours', async () => {
    // The exact 300-minute window (written in seconds) wins over the 280/310-minute candidates.
    const duration = (value: number, timeUnit: string, used: number) => ({
      window: { duration: value, timeUnit },
      detail: { limit: 100, used }
    })
    const result = await fetchKimiUsage(harness({
      body: {
        limits: [
          duration(240, 'MINUTE', 11), // too far from 5h to win
          duration(280, 'MINUTE', 22), // nearest to 5h
          duration(310, 'MINUTE', 33),
          duration(18_000, 'SECOND', 44), // seconds are converted to minutes
          duration(7, 'DAY', 55),
          duration(30, 'DAY', 66),
          duration(1, 'DAY', 77), // no bucket: ignored
          duration(5, 'FORTNIGHT', 88), // unlabelled unit: minutes, also ignored
          { detail: { limit: 100, used: 99 } } // no window: Orca's 5h default
        ]
      }
    }).deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.windows.fiveHour?.resetsAt).toBeNull()
    expect(result.windows.fiveHour?.usedPercentage).toBeCloseTo(44)
    expect(result.windows.sevenDay?.resetsAt).toBeNull()
    expect(result.windows.sevenDay?.usedPercentage).toBeCloseTo(55)
    expect(result.windows.monthly?.resetsAt).toBeNull()
    expect(result.windows.monthly?.usedPercentage).toBeCloseTo(66)
  })

  it('converts reset times from ISO, epoch milliseconds and relative seconds', async () => {
    const result = await fetchKimiUsage(harness({
      body: {
        usage: { limit: 10, used: 1, resetTime: 1_791_894_600_000 }, // epoch ms
        limits: [{ window: { duration: 5, timeUnit: 'HOUR' }, detail: { limit: 10, used: 2, resetAt: 1_791_894_600 } }],
        usages: { limit_month_total: { used_ratio: 0.1, reset_time: '600' } } // 10 minutes from now
      }
    }).deps)
    expect(result).toEqual({
      ok: true,
      windows: {
        fiveHour: { usedPercentage: 20, resetsAt: 1_791_894_600 },
        sevenDay: { usedPercentage: 10, resetsAt: 1_791_894_600 },
        monthly: { usedPercentage: 10, resetsAt: NOW_SECONDS + 600 }
      }
    })
  })

  it('clamps percentages into 0..100', async () => {
    const result = await fetchKimiUsage(harness({
      body: {
        usage: { limit: 10, used: 30 },
        limits: [{ window: { duration: 5, timeUnit: 'HOUR' }, detail: { limit: 10, used: -2 } }],
        usages: { limit_month_total: { used_ratio: 2 } }
      }
    }).deps)
    expect(result).toEqual({
      ok: true,
      windows: {
        fiveHour: { usedPercentage: 0, resetsAt: null },
        sevenDay: { usedPercentage: 100, resetsAt: null },
        monthly: { usedPercentage: 100, resetsAt: null }
      }
    })
  })
})
