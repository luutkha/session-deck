import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { CODEX_USAGE_URL, fetchCodexUsage } from './codexUsage'
import {
  PROVIDER_HTTP_TIMEOUT_MS,
  type ProviderHttpInit,
  type ProviderHttpResponse,
  type ProviderUsageDeps
} from './providerUsageTypes'

const HOME = 'C:\\Users\\me'
const AUTH_PATH = join(HOME, '.codex', 'auth.json')
const TOKEN = 'eyJhbGciOi-SECRET-TOKEN-DO-NOT-LEAK'
const ACCOUNT_ID = 'acct-SECRET-ID-DO-NOT-LEAK'
const NOW_MS = Date.parse('2026-11-27T12:00:00Z')
const NOW_SECONDS = Math.floor(NOW_MS / 1000)

function auth(tokens: Record<string, unknown> = { access_token: TOKEN, account_id: ACCOUNT_ID }): string {
  return JSON.stringify({ tokens })
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): ProviderHttpResponse {
  const lower: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value
  return {
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

const DEFAULT_BODY = { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18_000 } } }

/** Fakes are built inline: no real files, no network, no machine paths. */
function makeDeps(options: {
  auth?: string | null
  response?: ProviderHttpResponse | Error
  env?: NodeJS.ProcessEnv
} = {}) {
  const readTextFile = vi.fn(async (_path: string): Promise<string | null> =>
    options.auth === undefined ? auth() : options.auth
  )
  const http = vi.fn(async (_url: string, _init: ProviderHttpInit): Promise<ProviderHttpResponse> => {
    const response = options.response ?? jsonResponse(DEFAULT_BODY)
    if (response instanceof Error) throw response
    return response
  })
  const deps: ProviderUsageDeps = {
    platform: 'win32',
    homeDir: HOME,
    env: options.env ?? {},
    now: () => NOW_MS,
    readTextFile,
    readBinaryFile: vi.fn(async () => null),
    http
  }
  return { deps, readTextFile, http }
}

function bodyWithPrimary(primary: Record<string, unknown>): ProviderHttpResponse {
  return jsonResponse({ plan_type: 'plus', rate_limit: { primary_window: primary } })
}

describe('fetchCodexUsage — request and success mapping', () => {
  it('reads the Codex login and sends Orca\'s exact GET with both rate windows', async () => {
    const f = makeDeps({
      response: jsonResponse({
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 37, limit_window_seconds: 18_000, reset_at: NOW_SECONDS + 1800 },
          secondary_window: { used_percent: 12, limit_window_seconds: 604_800, reset_at: NOW_SECONDS + 7200 }
        }
      })
    })
    expect(await fetchCodexUsage(f.deps)).toEqual({
      ok: true,
      windows: {
        fiveHour: { usedPercentage: 37, resetsAt: NOW_SECONDS + 1800 },
        sevenDay: { usedPercentage: 12, resetsAt: NOW_SECONDS + 7200 },
        monthly: null
      }
    })
    expect(f.readTextFile).toHaveBeenCalledWith(AUTH_PATH)
    expect(f.http).toHaveBeenCalledWith(CODEX_USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'User-Agent': 'codex-cli',
        'OpenAI-Beta': 'codex-1',
        originator: 'Codex Desktop',
        'ChatGPT-Account-Id': ACCOUNT_ID
      },
      timeoutMs: PROVIDER_HTTP_TIMEOUT_MS
    })
  })

  it('uses CODEX_HOME when set, and the home default when it is blank', async () => {
    const override = makeDeps({ env: { CODEX_HOME: 'D:\\codex home' } })
    await fetchCodexUsage(override.deps)
    expect(override.readTextFile).toHaveBeenCalledWith(join('D:\\codex home', 'auth.json'))

    const blank = makeDeps({ env: { CODEX_HOME: '   ' } })
    await fetchCodexUsage(blank.deps)
    expect(blank.readTextFile).toHaveBeenCalledWith(AUTH_PATH)
  })

  it('omits the account header when the login carries no account id', async () => {
    const f = makeDeps({ auth: auth({ access_token: TOKEN }) })
    expect((await fetchCodexUsage(f.deps)).ok).toBe(true)
    const init = f.http.mock.calls[0][1]
    expect(init.headers).not.toHaveProperty('ChatGPT-Account-Id')
  })

  it('classifies the two windows by duration, not by their field names', async () => {
    const f = makeDeps({
      response: jsonResponse({
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 20, limit_window_seconds: 604_800 },
          secondary_window: { used_percent: 80, limit_window_seconds: 18_000 }
        }
      })
    })
    const result = await fetchCodexUsage(f.deps)
    expect(result).toEqual({
      ok: true,
      windows: {
        fiveHour: { usedPercentage: 80, resetsAt: null },
        sevenDay: { usedPercentage: 20, resetsAt: null },
        monthly: null
      }
    })
  })

  it.each([
    { seconds: 5 * 3600 - 60, slot: 'fiveHour' as const, percent: 41 },
    { seconds: 5 * 3600, slot: 'fiveHour' as const, percent: 42 },
    { seconds: 5 * 3600 + 60, slot: 'fiveHour' as const, percent: 43 },
    { seconds: 7 * 86_400 - 60, slot: 'sevenDay' as const, percent: 44 },
    { seconds: 7 * 86_400, slot: 'sevenDay' as const, percent: 45 },
    { seconds: 7 * 86_400 + 60, slot: 'sevenDay' as const, percent: 46 },
    { seconds: 30 * 86_400, slot: 'monthly' as const, percent: 47 }
  ])('classifies $seconds seconds as $slot (one-minute tolerance)', async ({ seconds, slot, percent }) => {
    const f = makeDeps({ response: bodyWithPrimary({ used_percent: percent, limit_window_seconds: seconds }) })
    const result = await fetchCodexUsage(f.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.windows[slot]).toEqual({ usedPercentage: percent, resetsAt: null })
    for (const other of ['fiveHour', 'sevenDay', 'monthly'] as const) {
      if (other !== slot) expect(result.windows[other]).toBeNull()
    }
  })

  it('rejects a duration two minutes off instead of absorbing it', async () => {
    const f = makeDeps({
      response: jsonResponse({
        rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 604_800 }, secondary_window: { used_percent: 10, limit_window_seconds: 5 * 3600 + 120 } }
      })
    })
    // The secondary window is neither 5h nor 7d, so it falls back to the legacy secondary=weekly slot, which is taken.
    expect(await fetchCodexUsage(f.deps)).toEqual({
      ok: true,
      windows: {
        fiveHour: null,
        sevenDay: { usedPercentage: 20, resetsAt: null },
        monthly: null
      }
    })
  })

  it('keeps legacy primary/secondary mapping when durations are missing or unknown', async () => {
    const f = makeDeps({
      response: jsonResponse({
        rate_limit: {
          primary_window: { used_percent: 21 },
          secondary_window: { used_percent: 22, limit_window_seconds: 1000 }
        }
      })
    })
    const result = await fetchCodexUsage(f.deps)
    expect(result).toEqual({
      ok: true,
      windows: {
        fiveHour: { usedPercentage: 21, resetsAt: null },
        sevenDay: { usedPercentage: 22, resetsAt: null },
        monthly: null
      }
    })
  })

  it('clamps used percentages into 0..100', async () => {
    const f = makeDeps({
      response: jsonResponse({
        rate_limit: {
          primary_window: { used_percent: -12, limit_window_seconds: 18_000 },
          secondary_window: { used_percent: 180, limit_window_seconds: 604_800 }
        }
      })
    })
    const result = await fetchCodexUsage(f.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.windows.fiveHour?.usedPercentage).toBe(0)
    expect(result.windows.sevenDay?.usedPercentage).toBe(100)
  })

  it.each([
    { label: 'epoch seconds', value: NOW_SECONDS + 600, expected: NOW_SECONDS + 600 },
    { label: 'epoch milliseconds', value: (NOW_SECONDS + 600) * 1000, expected: NOW_SECONDS + 600 },
    { label: 'an ISO string', value: new Date((NOW_SECONDS + 600) * 1000).toISOString(), expected: NOW_SECONDS + 600 },
    { label: 'a numeric string', value: String(NOW_SECONDS + 600), expected: NOW_SECONDS + 600 },
    { label: 'seconds until reset', value: 600, expected: NOW_SECONDS + 600 },
    { label: 'garbage', value: 'not a date', expected: null },
    { label: 'zero', value: 0, expected: null },
    { label: 'a missing field', value: undefined, expected: null }
  ])('normalizes $label resetsAt to epoch seconds', async ({ value, expected }) => {
    const f = makeDeps({ response: bodyWithPrimary({ used_percent: 10, limit_window_seconds: 18_000, reset_at: value }) })
    const result = await fetchCodexUsage(f.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.windows.fiveHour?.resetsAt).toBe(expected)
  })

  it('maps the spend cap to monthly and converts REMAINING to USED', async () => {
    const f = makeDeps({
      response: jsonResponse({
        plan_type: 'business',
        spend_control: { individual_limit: { remaining_percent: 12.5, reset_at: NOW_SECONDS + 3600 } }
      })
    })
    expect(await fetchCodexUsage(f.deps)).toEqual({
      ok: true,
      windows: {
        fiveHour: null,
        sevenDay: null,
        monthly: { usedPercentage: 87.5, resetsAt: NOW_SECONDS + 3600 }
      }
    })
  })

  it('does not let a spend cap overwrite a live rate window', async () => {
    const f = makeDeps({
      response: jsonResponse({
        plan_type: 'business',
        rate_limit: { primary_window: { used_percent: 9, limit_window_seconds: 18_000 } },
        spend_control: { individual_limit: { remaining_percent: 5 } }
      })
    })
    const result = await fetchCodexUsage(f.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.windows.fiveHour?.usedPercentage).toBe(9)
    expect(result.windows.monthly).toBeNull()
  })
})

describe('fetchCodexUsage — failure reasons', () => {
  it.each([
    { label: 'a missing auth file', auth: null },
    { label: 'no tokens at all', auth: JSON.stringify({ auth_mode: 'apikey' }) },
    { label: 'an empty token', auth: auth({ access_token: '   ' }) },
    { label: 'a non-string token', auth: auth({ access_token: 42 }) }
  ])('reports $label as not-signed-in without making a request', async ({ auth: raw }) => {
    const f = makeDeps({ auth: raw })
    expect(await fetchCodexUsage(f.deps)).toEqual({ ok: false, reason: 'not-signed-in' })
    expect(f.http).not.toHaveBeenCalled()
  })

  it('reports malformed auth JSON as unavailable', async () => {
    const f = makeDeps({ auth: '{not json' })
    expect(await fetchCodexUsage(f.deps)).toEqual({ ok: false, reason: 'unavailable' })
    expect(f.http).not.toHaveBeenCalled()
  })

  it.each([401, 403])('maps HTTP %i to unauthorized', async (status) => {
    expect(await fetchCodexUsage(makeDeps({ response: jsonResponse({}, status) }).deps)).toEqual({
      ok: false,
      reason: 'unauthorized'
    })
  })

  it('maps 429 with delta-seconds Retry-After to rate-limited', async () => {
    const f = makeDeps({ response: jsonResponse({}, 429, { 'retry-after': '45' }) })
    expect(await fetchCodexUsage(f.deps)).toEqual({ ok: false, reason: 'rate-limited', retryAfterMs: 45_000 })
  })

  it('maps 429 with an HTTP-date Retry-After to rate-limited', async () => {
    const header = new Date(NOW_MS + 300_000).toUTCString()
    const f = makeDeps({ response: jsonResponse({}, 429, { 'Retry-After': header }) })
    expect(await fetchCodexUsage(f.deps)).toEqual({ ok: false, reason: 'rate-limited', retryAfterMs: 300_000 })
  })

  it.each<{ label: string; headers: Record<string, string> }>([
    { label: 'no header', headers: {} },
    { label: 'an unusable header', headers: { 'retry-after': 'slow down' } }
  ])('maps 429 with $label to rate-limited with no wait', async ({ headers }) => {
    const f = makeDeps({ response: jsonResponse({}, 429, headers) })
    expect(await fetchCodexUsage(f.deps)).toEqual({ ok: false, reason: 'rate-limited' })
  })

  it.each([404, 500, 503])('maps HTTP %i to unavailable', async (status) => {
    expect(await fetchCodexUsage(makeDeps({ response: jsonResponse({}, status) }).deps)).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('maps a network throw to unavailable', async () => {
    const f = makeDeps({ response: new Error('offline') })
    expect(await fetchCodexUsage(f.deps)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('maps an unparseable response body to unavailable', async () => {
    const badBody: ProviderHttpResponse = {
      status: 200,
      headers: { get: () => null },
      json: async () => { throw new SyntaxError('bad json') },
      text: async () => 'nope'
    }
    const f = makeDeps({ response: badBody })
    expect(await fetchCodexUsage(f.deps)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it.each([
    { label: 'an empty body', body: {} },
    { label: 'no rate_limit', body: { plan_type: 'plus' } },
    { label: 'no windows', body: { plan_type: 'plus', rate_limit: {} } },
    { label: 'no used_percent', body: { rate_limit: { primary_window: { limit_window_seconds: 18_000 } } } },
    { label: 'a non-numeric used_percent', body: { rate_limit: { primary_window: { used_percent: 'lots', limit_window_seconds: 18_000 } } } },
    { label: 'a null body', body: null },
    { label: 'an array body', body: [] }
  ])('reports $label as unavailable (no usable window)', async ({ body }) => {
    expect(await fetchCodexUsage(makeDeps({ response: jsonResponse(body) }).deps)).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('never throws, even when a dep throws unexpectedly', async () => {
    const base = makeDeps()
    const deps: ProviderUsageDeps = {
      ...base.deps,
      readTextFile: vi.fn(async () => { throw new Error(`EACCES ${TOKEN}`) })
    }
    await expect(fetchCodexUsage(deps)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('passes the shared timeout on every HTTP call', async () => {
    const ok = makeDeps()
    const limited = makeDeps({ response: jsonResponse({}, 429, { 'retry-after': '1' }) })
    await fetchCodexUsage(ok.deps)
    await fetchCodexUsage(limited.deps)
    for (const f of [ok, limited]) {
      expect(f.http).toHaveBeenCalledTimes(1)
      expect(f.http.mock.calls[0][1].timeoutMs).toBe(PROVIDER_HTTP_TIMEOUT_MS)
    }
  })
})

describe('fetchCodexUsage — credential safety', () => {
  it('never puts the token or account id into a result', async () => {
    const echoingBody = {
      plan_type: 'plus',
      rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18_000, echo: TOKEN } },
      account_echo: ACCOUNT_ID
    }
    const throwingDeps = {
      ...makeDeps().deps,
      readTextFile: vi.fn(async () => { throw new Error(`EACCES ${TOKEN} ${ACCOUNT_ID}`) })
    }
    const results = [
      await fetchCodexUsage(makeDeps({ response: jsonResponse(echoingBody) }).deps),
      await fetchCodexUsage(makeDeps({ response: jsonResponse({}, 401) }).deps),
      await fetchCodexUsage(makeDeps({ response: jsonResponse({}, 429, { 'retry-after': TOKEN }) }).deps),
      await fetchCodexUsage(makeDeps({ response: new Error(`offline ${TOKEN}`) }).deps),
      await fetchCodexUsage(makeDeps({ auth: `{broken ${TOKEN}` }).deps),
      await fetchCodexUsage(throwingDeps)
    ]
    for (const result of results) {
      const text = JSON.stringify(result)
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(ACCOUNT_ID)
    }
  })
})
