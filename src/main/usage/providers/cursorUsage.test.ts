import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  classifyCursorWindow,
  CURRENT_PERIOD_URL,
  fetchCursorUsage,
  LEGACY_USAGE_URL,
  mapCursorUsagePayload,
  USAGE_SUMMARY_URL
} from './cursorUsage'
import {
  PROVIDER_HTTP_TIMEOUT_MS,
  type ProviderHttpInit,
  type ProviderHttpResponse,
  type ProviderUsageDeps
} from './providerUsageTypes'

const HOME = 'C:\\Users\\me'
const APPDATA = join(HOME, 'AppData', 'Roaming')
const WIN_AUTH = join(APPDATA, 'Cursor', 'auth.json')
const WIN_DPAPI = join(APPDATA, 'Cursor', 'auth.dpapi')
const MAC_AUTH = join(HOME, '.cursor', 'auth.json')
const LINUX_AUTH = join(HOME, '.config', 'cursor', 'auth.json')
const NOW_MS = Date.parse('2026-11-27T12:00:00Z')
const SUBJECT = 'auth0|user_1'
const SECRET = 'SECRET-TOKEN-VALUE'

function jwt(sub: string = SUBJECT, exp?: number): string {
  const payload = exp === undefined ? { sub } : { sub, exp }
  return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${SECRET}`
}

const TOKEN = jwt()
const START = '2026-11-01T00:00:00Z'
const END = '2026-12-01T00:00:00Z'
const RESET_S = Math.floor(Date.parse(END) / 1000)

function summary(percent: number = 42): Record<string, unknown> {
  return {
    billingCycleStart: START,
    billingCycleEnd: END,
    membershipType: 'pro',
    individualUsage: {
      plan: { enabled: true, totalPercentUsed: percent, autoPercentUsed: 12, apiPercentUsed: 3 },
      onDemand: { enabled: false }
    }
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {}
): ProviderHttpResponse {
  return {
    status,
    headers: {
      get: (name) => {
        const wanted = name.toLowerCase()
        const match = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted)
        return match?.[1] ?? null
      }
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }
}

interface FakeOptions {
  readonly platform?: NodeJS.Platform
  readonly homeDir?: string
  readonly env?: NodeJS.ProcessEnv
  readonly files?: Readonly<Record<string, string | Buffer>>
  readonly http?: ProviderUsageDeps['http']
  readonly dpapiUnprotect?: (blob: Buffer) => Promise<Buffer | null>
}

function makeDeps(options: FakeOptions = {}): ProviderUsageDeps {
  const files = options.files ?? {}
  const http = vi.fn(options.http ?? (async () => jsonResponse(summary())))
  return {
    platform: options.platform ?? 'win32',
    homeDir: options.homeDir ?? HOME,
    env: options.env ?? { APPDATA },
    now: () => NOW_MS,
    readTextFile: vi.fn(async (path: string) => {
      const value = files[path]
      return typeof value === 'string' ? value : null
    }),
    readBinaryFile: vi.fn(async (path: string) => {
      const value = files[path]
      return Buffer.isBuffer(value) ? value : null
    }),
    http,
    dpapiUnprotect: options.dpapiUnprotect ? vi.fn(options.dpapiUnprotect) : undefined
  }
}

function calls(deps: ProviderUsageDeps): readonly (readonly [string, ProviderHttpInit])[] {
  return vi.mocked(deps.http).mock.calls
}

function authJson(token: string): Record<string, string> {
  return { [WIN_AUTH]: JSON.stringify({ accessToken: token, refreshToken: 'ignored' }) }
}

describe('fetchCursorUsage — reading the login', () => {
  it('reads %APPDATA%\\Cursor\\auth.json and needs only one dashboard call', async () => {
    const deps = makeDeps({ files: authJson(TOKEN) })
    const result = await fetchCursorUsage(deps)

    expect(result).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: null, monthly: { usedPercentage: 42, resetsAt: RESET_S } }
    })
    expect(calls(deps)).toHaveLength(1)
    const [url, init] = calls(deps)[0]
    expect(url).toBe(USAGE_SUMMARY_URL)
    expect(init.method).toBe('GET')
    expect(init.timeoutMs).toBe(PROVIDER_HTTP_TIMEOUT_MS)
    expect(init.headers?.Cookie).toBe(`WorkosCursorSessionToken=${encodeURIComponent(SUBJECT)}%3A%3A${TOKEN}`)
    expect(init.headers?.Origin).toBe('https://cursor.com')
    expect(init.headers?.Referer).toBe('https://cursor.com/dashboard')
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('falls back to <home>\\AppData\\Roaming when APPDATA is blank', async () => {
    const deps = makeDeps({ env: { APPDATA: '  ' }, files: authJson(TOKEN) })
    const result = await fetchCursorUsage(deps)
    expect(result.ok).toBe(true)
    expect(vi.mocked(deps.readTextFile).mock.calls[0][0]).toBe(WIN_AUTH)
  })

  it('decrypts the auth.dpapi blob when auth.json only holds the OS-secret-store marker', async () => {
    const blob = Buffer.from('DPAPI-BLOB-BYTES')
    const plain = Buffer.from(JSON.stringify({ accessToken: TOKEN, refreshToken: 'r' }))
    const decrypt = vi.fn(async (_blob: Buffer) => plain)
    const deps = makeDeps({
      files: {
        [WIN_AUTH]: JSON.stringify({ storedIn: 'os-secret-store' }),
        [WIN_DPAPI]: JSON.stringify({ version: 1, dpapi: blob.toString('base64') })
      },
      dpapiUnprotect: decrypt
    })

    const result = await fetchCursorUsage(deps)

    expect(result.ok).toBe(true)
    expect(decrypt).toHaveBeenCalledTimes(1)
    expect(vi.mocked(decrypt).mock.calls[0][0]).toEqual(blob)
    expect(calls(deps)[0][1].headers?.Cookie).toContain(TOKEN)
  })

  it('accepts a raw DPAPI blob when the sidecar has no JSON wrapper', async () => {
    const blob = Buffer.from('RAW-BLOB')
    const decrypt = vi.fn(async (_blob: Buffer) => Buffer.from(TOKEN))
    const deps = makeDeps({
      files: { [WIN_AUTH]: JSON.stringify({ storedIn: 'os-secret-store' }), [WIN_DPAPI]: blob },
      dpapiUnprotect: decrypt
    })
    expect((await fetchCursorUsage(deps)).ok).toBe(true)
    expect(vi.mocked(decrypt).mock.calls[0][0]).toEqual(blob)
  })

  it('reads plain auth.json on macOS and Linux without a keychain or secret-tool', async () => {
    const cases: readonly (readonly [NodeJS.Platform, NodeJS.ProcessEnv, string])[] = [
      ['darwin', {}, MAC_AUTH],
      ['linux', {}, LINUX_AUTH],
      ['linux', { XDG_CONFIG_HOME: 'D:\\config' }, join('D:\\config', 'cursor', 'auth.json')]
    ]
    for (const [platform, env, expected] of cases) {
      const deps = makeDeps({ platform, env, files: { [expected]: JSON.stringify({ accessToken: TOKEN }) } })
      expect((await fetchCursorUsage(deps)).ok).toBe(true)
      expect(vi.mocked(deps.readTextFile).mock.calls[0][0]).toBe(expected)
    }
  })

  it('uses a bearer header for a token with no decodable WorkOS subject', async () => {
    const deps = makeDeps({ files: authJson('plain-token') })
    expect((await fetchCursorUsage(deps)).ok).toBe(true)
    const headers = calls(deps)[0][1].headers
    expect(headers?.Authorization).toBe('Bearer plain-token')
    expect(headers?.Cookie).toBeUndefined()
  })

  it('reports not-signed-in when auth.json is missing or has no usable token', async () => {
    const bodies = [
      '{}',
      JSON.stringify({ accessToken: '' }),
      JSON.stringify({ accessToken: '   ' }),
      JSON.stringify({ accessToken: 42 }),
      JSON.stringify({ storedIn: 'something-else' }),
      JSON.stringify([TOKEN])
    ]
    for (const file of [undefined, ...bodies]) {
      const deps = makeDeps({ files: file === undefined ? {} : { [WIN_AUTH]: file } })
      expect(await fetchCursorUsage(deps)).toEqual({ ok: false, reason: 'not-signed-in' })
      expect(calls(deps)).toHaveLength(0)
    }
  })

  it('does not follow the DPAPI marker on non-Windows platforms', async () => {
    const deps = makeDeps({
      platform: 'linux',
      files: { [LINUX_AUTH]: JSON.stringify({ storedIn: 'os-secret-store' }) }
    })
    expect(await fetchCursorUsage(deps)).toEqual({ ok: false, reason: 'not-signed-in' })
    expect(deps.dpapiUnprotect).toBeUndefined()
    expect(calls(deps)).toHaveLength(0)
  })

  it('reports not-signed-in when Windows has a marker but no sidecar', async () => {
    const deps = makeDeps({
      files: { [WIN_AUTH]: JSON.stringify({ storedIn: 'os-secret-store' }) },
      dpapiUnprotect: vi.fn(async () => null)
    })
    expect(await fetchCursorUsage(deps)).toEqual({ ok: false, reason: 'not-signed-in' })
    expect(calls(deps)).toHaveLength(0)
  })

  it('reports unavailable for a corrupt auth.json or a failed decryption', async () => {
    const badFile = makeDeps({ files: { [WIN_AUTH]: `{broken ${SECRET}` } })
    expect(await fetchCursorUsage(badFile)).toEqual({ ok: false, reason: 'unavailable' })

    const encrypted = makeDeps({
      files: {
        [WIN_AUTH]: JSON.stringify({ storedIn: 'os-secret-store' }),
        [WIN_DPAPI]: JSON.stringify({ version: 1, dpapi: Buffer.from('x').toString('base64') })
      },
      dpapiUnprotect: vi.fn(async () => null)
    })
    expect(await fetchCursorUsage(encrypted)).toEqual({ ok: false, reason: 'unavailable' })
    expect(calls(badFile)).toHaveLength(0)
    expect(calls(encrypted)).toHaveLength(0)
  })

  it('treats an expired JWT as a stale login without calling the dashboard', async () => {
    const expired = jwt(SUBJECT, Math.floor(NOW_MS / 1000) - 10)
    const deps = makeDeps({ files: authJson(expired) })
    expect(await fetchCursorUsage(deps)).toEqual({ ok: false, reason: 'unauthorized' })
    expect(calls(deps)).toHaveLength(0)
  })
})

describe('fetchCursorUsage — HTTP failures', () => {
  it('maps 401 and 403 to unauthorized', async () => {
    for (const status of [401, 403]) {
      const deps = makeDeps({ files: authJson(TOKEN), http: vi.fn(async () => jsonResponse({}, status)) })
      expect(await fetchCursorUsage(deps)).toEqual({ ok: false, reason: 'unauthorized' })
    }
  })

  it('maps 429 to rate-limited with Retry-After as seconds or an HTTP date', async () => {
    const delta = makeDeps({
      files: authJson(TOKEN),
      http: vi.fn(async () => jsonResponse({}, 429, { 'retry-after': '45' }))
    })
    expect(await fetchCursorUsage(delta)).toEqual({ ok: false, reason: 'rate-limited', retryAfterMs: 45_000 })

    const date = makeDeps({
      files: authJson(TOKEN),
      http: vi.fn(async () => jsonResponse({}, 429, { 'Retry-After': new Date(NOW_MS + 90_000).toUTCString() }))
    })
    expect(await fetchCursorUsage(date)).toEqual({ ok: false, reason: 'rate-limited', retryAfterMs: 90_000 })
  })

  it('omits retryAfterMs when 429 has no usable Retry-After', async () => {
    const headerCases: readonly Record<string, string>[] = [{}, { 'retry-after': 'soon' }]
    for (const header of headerCases) {
      const deps = makeDeps({
        files: authJson(TOKEN),
        http: vi.fn(async () => jsonResponse({}, 429, header))
      })
      expect(await fetchCursorUsage(deps)).toEqual({ ok: false, reason: 'rate-limited' })
    }
  })

  it('maps network errors, bad bodies and server errors to unavailable without leaking the token', async () => {
    const throwing = makeDeps({
      files: authJson(TOKEN),
      http: vi.fn(async () => {
        throw new Error(`connect failed with ${TOKEN}`)
      })
    })
    const badJson = makeDeps({
      files: authJson(TOKEN),
      http: vi.fn(async () => ({
        status: 200,
        headers: { get: () => null },
        json: async () => {
          throw new Error(`bad JSON: ${TOKEN}`)
        },
        text: async () => TOKEN
      }))
    })
    const server = makeDeps({ files: authJson(TOKEN), http: vi.fn(async () => jsonResponse({}, 500)) })
    for (const deps of [throwing, badJson, server]) {
      const result = await fetchCursorUsage(deps)
      expect(result).toEqual({ ok: false, reason: 'unavailable' })
      expect(JSON.stringify(result)).not.toContain(SECRET)
    }
  })

  it('reports unavailable when the dashboard returns no usable window', async () => {
    const deps = makeDeps({ files: authJson(TOKEN) })
    vi.mocked(deps.http)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ billingCycleEnd: END }))
      .mockResolvedValueOnce(jsonResponse({ random: true }))
    expect(await fetchCursorUsage(deps)).toEqual({ ok: false, reason: 'unavailable' })
    expect(calls(deps)).toHaveLength(3)
  })

  it('returns only the current-period window when the summary has none (second call is a POST)', async () => {
    const deps = makeDeps({ files: authJson(TOKEN) })
    vi.mocked(deps.http)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        billingCycleStart: START,
        billingCycleEnd: END,
        planUsage: { totalPercentUsed: 18 }
      }))

    expect(await fetchCursorUsage(deps)).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: null, monthly: { usedPercentage: 18, resetsAt: RESET_S } }
    })
    expect(calls(deps)).toHaveLength(2)
    expect(calls(deps)[1][0]).toBe(CURRENT_PERIOD_URL)
    expect(calls(deps)[1][1].method).toBe('POST')
    expect(calls(deps)[1][1].body).toBe('{}')
    expect(calls(deps)[1][1].timeoutMs).toBe(PROVIDER_HTTP_TIMEOUT_MS)
  })

  it('falls back to the legacy per-model quota only as a last resort', async () => {
    const deps = makeDeps({ files: authJson(TOKEN) })
    vi.mocked(deps.http)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        'gpt-4': { numRequests: 7, maxRequestUsage: 10 },
        startOfMonth: START
      }))

    expect(await fetchCursorUsage(deps)).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: null, monthly: { usedPercentage: 70, resetsAt: RESET_S } }
    })
    expect(calls(deps)).toHaveLength(3)
    expect(calls(deps)[2][0]).toBe(`${LEGACY_USAGE_URL}?user=${encodeURIComponent(SUBJECT)}`)
  })
})

describe('window mapping', () => {
  it('classifies by period length with tolerance', () => {
    const fiveHours = Date.parse(START)
    expect(classifyCursorWindow(fiveHours, fiveHours + 5 * 3600_000)).toBe('fiveHour')
    expect(classifyCursorWindow(fiveHours, fiveHours + 6 * 3600_000)).toBe('fiveHour')
    expect(classifyCursorWindow(fiveHours, fiveHours + 7 * 86_400_000)).toBe('sevenDay')
    expect(classifyCursorWindow(fiveHours, fiveHours + 9 * 86_400_000)).toBe('sevenDay')
    expect(classifyCursorWindow(fiveHours, fiveHours + 28 * 86_400_000)).toBe('monthly')
    expect(classifyCursorWindow(null, fiveHours)).toBe('monthly')
    expect(classifyCursorWindow(fiveHours, fiveHours)).toBe('monthly')
  })

  it('puts a 7-day billing cycle in the sevenDay slot', async () => {
    const start = Date.parse(START)
    const end = start + 7 * 86_400_000
    const deps = makeDeps({
      files: authJson(TOKEN),
      http: vi.fn(async () => jsonResponse({
        billingCycleStart: start / 1000,
        billingCycleEnd: end / 1000,
        individualUsage: { plan: { totalPercentUsed: 33 } }
      }))
    })
    expect(await fetchCursorUsage(deps)).toEqual({
      ok: true,
      windows: { fiveHour: null, sevenDay: { usedPercentage: 33, resetsAt: Math.floor(end / 1000) }, monthly: null }
    })
  })

  it('clamps percentages and accepts epoch-second billing dates', () => {
    const base = {
      billingCycleStart: Date.parse(START) / 1000,
      billingCycleEnd: Date.parse(END) / 1000
    }
    expect(mapCursorUsagePayload({ ...base, individualUsage: { plan: { totalPercentUsed: 140 } } })).toEqual({
      fiveHour: null,
      sevenDay: null,
      monthly: { usedPercentage: 100, resetsAt: RESET_S }
    })
    expect(mapCursorUsagePayload({ ...base, individualUsage: { plan: { totalPercentUsed: -9 } } })).toEqual({
      fiveHour: null,
      sevenDay: null,
      monthly: { usedPercentage: 0, resetsAt: RESET_S }
    })
  })

  it('derives used from used/limit and prefers an enabled fallback pool', () => {
    const base = { billingCycleStart: START, billingCycleEnd: END }
    expect(mapCursorUsagePayload({
      ...base,
      individualUsage: { plan: { used: 6, limit: 8 } }
    })?.monthly?.usedPercentage).toBe(75)
    expect(mapCursorUsagePayload({
      ...base,
      individualUsage: {
        plan: { enabled: false, totalPercentUsed: 99 },
        overall: { enabled: true, totalPercentUsed: 20 }
      }
    })?.monthly?.usedPercentage).toBe(20)
    expect(mapCursorUsagePayload({
      ...base,
      individualUsage: { plan: { autoPercentUsed: 55 }, onDemand: { enabled: true, used: 4, limit: 5 } }
    })?.monthly?.usedPercentage).toBe(55)
  })

  it('returns null for missing fields and unusable bodies', () => {
    for (const body of [null, [], {}, { billingCycleEnd: END, individualUsage: null }, { individualUsage: { plan: {} } }]) {
      expect(mapCursorUsagePayload(body)).toBeNull()
    }
  })
})
