import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import {
  classifyHttpStatus,
  fetchOAuthUsage,
  normalizeResetsAt,
  parseRetryAfterMs,
  parseUsageResponse,
  readClaudeAccessToken,
  USAGE_URL,
  type CredentialsDeps,
  type FetchDeps
} from './oauthUsage'

const SECRET = 'sk-ant-oat01-SECRET-TOKEN-VALUE'
const NOW_MS = Date.parse('2026-10-13T12:00:00Z')
const CREDS_PATH = join('C:\\Users\\me', '.claude', '.credentials.json')

function credentialsDeps(overrides: Partial<CredentialsDeps> = {}): CredentialsDeps {
  return {
    readFile: vi.fn(async () => JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: 'r' } })),
    env: {},
    homedir: () => 'C:\\Users\\me',
    ...overrides
  }
}

function fakeFetch(response: Response | Error): FetchDeps['fetch'] {
  return vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function fetchDeps(fetchImpl: FetchDeps['fetch']): FetchDeps {
  return { fetch: fetchImpl, now: () => NOW_MS }
}

describe('readClaudeAccessToken', () => {
  it('reads accessToken from <homedir>/.claude/.credentials.json', async () => {
    const deps = credentialsDeps()
    const result = await readClaudeAccessToken(deps)
    expect(result).toEqual({ ok: true, token: SECRET })
    expect(deps.readFile).toHaveBeenCalledWith(CREDS_PATH)
  })

  it('honours a non-empty CLAUDE_CONFIG_DIR override', async () => {
    const deps = credentialsDeps({ env: { CLAUDE_CONFIG_DIR: 'D:\\alt-claude' } })
    await readClaudeAccessToken(deps)
    expect(deps.readFile).toHaveBeenCalledWith(join('D:\\alt-claude', '.credentials.json'))
  })

  it('ignores an empty CLAUDE_CONFIG_DIR', async () => {
    const deps = credentialsDeps({ env: { CLAUDE_CONFIG_DIR: '' } })
    await readClaudeAccessToken(deps)
    expect(deps.readFile).toHaveBeenCalledWith(CREDS_PATH)
  })

  it('reports no-credentials with a helpful message when the file is missing', async () => {
    const deps = credentialsDeps({
      readFile: async () => {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      }
    })
    const result = await readClaudeAccessToken(deps)
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'no-credentials',
        message: 'No Claude login found. Sign in with Claude Code first.',
        retryAfterMs: null
      }
    })
  })

  it('reports no-credentials for corrupt JSON', async () => {
    const result = await readClaudeAccessToken(credentialsDeps({ readFile: async () => '{not json' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('no-credentials')
  })

  it('reports no-credentials when accessToken is empty, blank or absent', async () => {
    const bodies = [
      { claudeAiOauth: { accessToken: '', refreshToken: 'r' } },
      { claudeAiOauth: { accessToken: '   ' } },
      { claudeAiOauth: { refreshToken: 'r' } },
      { claudeAiOauth: null },
      { other: true },
      []
    ]
    for (const body of bodies) {
      const result = await readClaudeAccessToken(credentialsDeps({ readFile: async () => JSON.stringify(body) }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('no-credentials')
    }
  })

  it('never puts the token into an error object', async () => {
    const results = [
      await readClaudeAccessToken(credentialsDeps({ readFile: async () => `{"claudeAiOauth":{"accessToken":"${SECRET}",` })),
      await readClaudeAccessToken(credentialsDeps({ readFile: async () => { throw new Error(`EACCES ${SECRET}`) } })),
      await readClaudeAccessToken(credentialsDeps({ readFile: async () => JSON.stringify({ claudeAiOauth: { accessToken: 42, note: SECRET } }) }))
    ]
    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(SECRET)
    }
  })
})

describe('normalizeResetsAt', () => {
  it('keeps epoch seconds', () => {
    expect(normalizeResetsAt(1791894600)).toBe(1791894600)
  })

  it('converts epoch milliseconds (values above 1e10) to seconds', () => {
    expect(normalizeResetsAt(1791894600000)).toBe(1791894600)
  })

  it('parses ISO strings to epoch seconds', () => {
    expect(normalizeResetsAt('2026-10-13T12:00:00Z')).toBe(Date.parse('2026-10-13T12:00:00Z') / 1000)
  })

  it('accepts numeric strings as seconds or milliseconds', () => {
    expect(normalizeResetsAt('1791894600')).toBe(1791894600)
    expect(normalizeResetsAt('1791894600000')).toBe(1791894600)
  })

  it('returns null for missing, invalid, negative or non-finite values', () => {
    expect(normalizeResetsAt(undefined)).toBeNull()
    expect(normalizeResetsAt(null)).toBeNull()
    expect(normalizeResetsAt('')).toBeNull()
    expect(normalizeResetsAt('next tuesday')).toBeNull()
    expect(normalizeResetsAt(-5)).toBeNull()
    expect(normalizeResetsAt(Number.NaN)).toBeNull()
    expect(normalizeResetsAt(Number.POSITIVE_INFINITY)).toBeNull()
    expect(normalizeResetsAt({})).toBeNull()
  })
})

describe('parseRetryAfterMs', () => {
  it('returns null when the header is absent or blank', () => {
    expect(parseRetryAfterMs(null, NOW_MS)).toBeNull()
    expect(parseRetryAfterMs('   ', NOW_MS)).toBeNull()
  })

  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('120', NOW_MS)).toBe(120_000)
    expect(parseRetryAfterMs('0', NOW_MS)).toBe(0)
  })

  it('reads an HTTP date relative to now', () => {
    const header = new Date(NOW_MS + 90_000).toUTCString()
    expect(parseRetryAfterMs(header, NOW_MS)).toBe(90_000)
  })

  it('treats a past HTTP date as no wait', () => {
    const header = new Date(NOW_MS - 60_000).toUTCString()
    expect(parseRetryAfterMs(header, NOW_MS)).toBe(0)
  })

  it('caps very large waits at 24 hours', () => {
    expect(parseRetryAfterMs('999999999999999999999', NOW_MS)).toBe(86_400_000)
    expect(parseRetryAfterMs(new Date(NOW_MS + 365 * 86_400_000).toUTCString(), NOW_MS)).toBe(86_400_000)
  })

  it('returns null for negative, NaN or unparseable values', () => {
    expect(parseRetryAfterMs('-30', NOW_MS)).toBeNull()
    expect(parseRetryAfterMs('NaN', NOW_MS)).toBeNull()
    expect(parseRetryAfterMs('soon', NOW_MS)).toBeNull()
  })
})

describe('classifyHttpStatus', () => {
  it('maps 401 and 403 to stale-token', () => {
    expect(classifyHttpStatus(401, null, NOW_MS)).toMatchObject({ kind: 'stale-token', retryAfterMs: null })
    expect(classifyHttpStatus(403, null, NOW_MS)).toMatchObject({ kind: 'stale-token', retryAfterMs: null })
  })

  it('maps 429 to rate-limited with the parsed Retry-After', () => {
    expect(classifyHttpStatus(429, '30', NOW_MS)).toMatchObject({ kind: 'rate-limited', retryAfterMs: 30_000 })
    expect(classifyHttpStatus(429, null, NOW_MS)).toMatchObject({ kind: 'rate-limited', retryAfterMs: null })
  })

  it('maps 5xx to server', () => {
    expect(classifyHttpStatus(500, null, NOW_MS)).toMatchObject({ kind: 'server' })
    expect(classifyHttpStatus(503, null, NOW_MS)).toMatchObject({ kind: 'server' })
  })

  it('maps any other status to unavailable', () => {
    expect(classifyHttpStatus(404, null, NOW_MS)).toMatchObject({ kind: 'unavailable', retryAfterMs: null })
    expect(classifyHttpStatus(400, null, NOW_MS)).toMatchObject({ kind: 'unavailable' })
  })

  it('messages are short sentences without numbers from the server or secrets', () => {
    const error = classifyHttpStatus(429, '30', NOW_MS)
    expect(error.message.length).toBeGreaterThan(0)
    expect(error.message.length).toBeLessThan(200)
  })
})

describe('parseUsageResponse', () => {
  it('reads utilization and used_percentage shapes', () => {
    const parsed = parseUsageResponse({
      five_hour: { utilization: 42, resets_at: 1791894600 },
      seven_day: { used_percentage: 17, resets_at: '2026-10-20T00:00:00Z' }
    })
    expect(parsed).toEqual({
      fiveHour: { usedPercentage: 42, resetsAt: 1791894600 },
      sevenDay: { usedPercentage: 17, resetsAt: Date.parse('2026-10-20T00:00:00Z') / 1000 }
    })
  })

  it('prefers utilization over used_percentage when both are present', () => {
    const parsed = parseUsageResponse({ five_hour: { utilization: 10, used_percentage: 90 } })
    expect(parsed.fiveHour?.usedPercentage).toBe(10)
  })

  it('clamps percentages to 0..100', () => {
    const parsed = parseUsageResponse({
      five_hour: { utilization: 150 },
      seven_day: { utilization: -4 }
    })
    expect(parsed.fiveHour?.usedPercentage).toBe(100)
    expect(parsed.sevenDay?.usedPercentage).toBe(0)
  })

  it('normalises epoch milliseconds resets_at', () => {
    const parsed = parseUsageResponse({ five_hour: { utilization: 5, resets_at: 1791894600000 } })
    expect(parsed.fiveHour?.resetsAt).toBe(1791894600)
  })

  it('gives resetsAt null when it is absent', () => {
    const parsed = parseUsageResponse({ five_hour: { utilization: 5 } })
    expect(parsed.fiveHour).toEqual({ usedPercentage: 5, resetsAt: null })
  })

  it('returns one window when only one is present', () => {
    expect(parseUsageResponse({ seven_day: { utilization: 3 } })).toEqual({
      fiveHour: null,
      sevenDay: { usedPercentage: 3, resetsAt: null }
    })
  })

  it('returns no windows for unusable input', () => {
    const inputs: unknown[] = [null, 'text', 7, [], {}, { five_hour: 'x' }, { five_hour: { utilization: 'high' } }, { five_hour: {} }]
    for (const input of inputs) {
      expect(parseUsageResponse(input)).toEqual({ fiveHour: null, sevenDay: null })
    }
  })
})

describe('fetchOAuthUsage', () => {
  it('sends exactly the documented request', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ five_hour: { utilization: 1 } }))
    await fetchOAuthUsage(SECRET, fetchDeps(fetchImpl))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage')
    expect(USAGE_URL).toBe(url)
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({
      Authorization: `Bearer ${SECRET}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.0'
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns both windows on success', async () => {
    const result = await fetchOAuthUsage(
      SECRET,
      fetchDeps(fakeFetch(jsonResponse({
        five_hour: { utilization: 38, resets_at: 1791894600 },
        seven_day: { used_percentage: 34, resets_at: 1792332000000 }
      })))
    )
    expect(result).toEqual({
      ok: true,
      fiveHour: { usedPercentage: 38, resetsAt: 1791894600 },
      sevenDay: { usedPercentage: 34, resetsAt: 1792332000 }
    })
  })

  it('succeeds with one window and null for the other', async () => {
    const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(jsonResponse({ five_hour: { utilization: 9 } }))))
    expect(result).toEqual({ ok: true, fiveHour: { usedPercentage: 9, resetsAt: null }, sevenDay: null })
  })

  it('is unavailable when the response has neither window', async () => {
    const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(jsonResponse({ something: 'else' }))))
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable', retryAfterMs: null } })
  })

  it('maps 401 and 403 to stale-token', async () => {
    for (const status of [401, 403]) {
      const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response('denied', { status }))))
      expect(result).toMatchObject({ ok: false, error: { kind: 'stale-token' } })
    }
  })

  it('maps 429 with delta-seconds Retry-After', async () => {
    const result = await fetchOAuthUsage(
      SECRET,
      fetchDeps(fakeFetch(new Response('slow down', { status: 429, headers: { 'retry-after': '45' } })))
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'rate-limited', retryAfterMs: 45_000 } })
  })

  it('maps 429 with an HTTP-date Retry-After', async () => {
    const date = new Date(NOW_MS + 300_000).toUTCString()
    const result = await fetchOAuthUsage(
      SECRET,
      fetchDeps(fakeFetch(new Response('', { status: 429, headers: { 'retry-after': date } })))
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'rate-limited', retryAfterMs: 300_000 } })
  })

  it('maps 429 without Retry-After to a null wait', async () => {
    const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response('', { status: 429 }))))
    expect(result).toMatchObject({ ok: false, error: { kind: 'rate-limited', retryAfterMs: null } })
  })

  it('maps 500 to server', async () => {
    const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response('boom', { status: 500 }))))
    expect(result).toMatchObject({ ok: false, error: { kind: 'server' } })
  })

  it('maps other non-OK statuses to unavailable', async () => {
    const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response('nope', { status: 418 }))))
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } })
  })

  it('maps a network failure to network', async () => {
    const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new TypeError('fetch failed'))))
    expect(result).toMatchObject({ ok: false, error: { kind: 'network', retryAfterMs: null } })
  })

  it('maps a timeout or abort to network', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const abort = new DOMException('This operation was aborted', 'AbortError')
    expect(await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(timeout)))).toMatchObject({ error: { kind: 'network' } })
    expect(await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(abort)))).toMatchObject({ error: { kind: 'network' } })
  })

  it('maps invalid JSON in a 200 response to unavailable', async () => {
    const result = await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response('<html>', { status: 200 }))))
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } })
  })

  it('never leaks the token, response body or headers into errors', async () => {
    const leaky = [
      await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new TypeError(`bad header Bearer ${SECRET}`)))),
      await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response(`echo ${SECRET}`, { status: 500 })))),
      await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response(`echo ${SECRET}`, { status: 401 })))),
      await fetchOAuthUsage(SECRET, fetchDeps(fakeFetch(new Response(`{"error":"${SECRET}"`, { status: 200 }))))
    ]
    for (const result of leaky) {
      expect(JSON.stringify(result)).not.toContain(SECRET)
    }
  })
})
