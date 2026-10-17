import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logMainError } from '../app/errorLog'
import { createUsageRefresher, DEFAULT_RATE_LIMIT_COOLDOWN_MS, MIN_REFRESH_INTERVAL_MS, type UsageRefresher } from './usageRefresh'
import { createUsageService, type UsageService } from './UsageService'
import type { TokenResult, UsageFetchResult } from './oauthUsage'
import type { UsageRefreshResult, UsageState } from '../../shared/types'

vi.mock('../app/errorLog', () => ({ logMainError: vi.fn() }))

const SECRET = 'sk-ant-oat01-REFRESH-SECRET'
const DIR = 'C:\\userdata'

const okToken: TokenResult = { ok: true, token: SECRET }
const okUsage: UsageFetchResult = {
  ok: true,
  fiveHour: { usedPercentage: 38, resetsAt: 1791894600 },
  sevenDay: { usedPercentage: 34, resetsAt: 1792332000 }
}

interface Harness {
  readonly refresher: UsageRefresher
  readonly service: UsageService
  readonly readToken: ReturnType<typeof vi.fn<() => Promise<TokenResult>>>
  readonly fetchUsage: ReturnType<typeof vi.fn<(token: string) => Promise<UsageFetchResult>>>
  readonly emitted: UsageState[]
  readonly setNow: (ms: number) => void
}

function harness(overrides: {
  readToken?: () => Promise<TokenResult>
  fetchUsage?: (token: string) => Promise<UsageFetchResult>
} = {}): Harness {
  let clock = 1_000_000
  const service = createUsageService({ now: () => clock })
  const emitted: UsageState[] = []
  service.onChange((state) => emitted.push(state))
  const readToken = vi.fn<() => Promise<TokenResult>>(overrides.readToken ?? (async () => okToken))
  const fetchUsage = vi.fn<(token: string) => Promise<UsageFetchResult>>(overrides.fetchUsage ?? (async () => okUsage))
  const refresher = createUsageRefresher({
    readToken,
    fetchUsage,
    service,
    now: () => clock,
    userDataDir: DIR
  })
  return {
    refresher,
    service,
    readToken,
    fetchUsage,
    emitted,
    setNow: (ms: number) => {
      clock = ms
    }
  }
}

describe('createUsageRefresher', () => {
  beforeEach(() => {
    vi.mocked(logMainError).mockClear()
  })

  it('updates the service on success and emits exactly once', async () => {
    const h = harness()
    const result = await h.refresher.refresh()
    expect(result).toEqual({ ok: true })
    expect(h.fetchUsage).toHaveBeenCalledWith(SECRET)
    expect(h.service.getState().account).toMatchObject({
      fiveHour: okUsage.ok ? okUsage.fiveHour : null,
      sevenDay: okUsage.ok ? okUsage.sevenDay : null
    })
    expect(h.emitted).toHaveLength(1)
  })

  it('returns the login error without calling the endpoint', async () => {
    const error = { kind: 'no-credentials', message: 'No Claude login found. Sign in with Claude Code first.', retryAfterMs: null } as const
    const h = harness({ readToken: async () => ({ ok: false, error }) })
    const result = await h.refresher.refresh()
    expect(result).toEqual({ ok: false, error })
    expect(h.fetchUsage).not.toHaveBeenCalled()
    expect(h.emitted).toHaveLength(0)
  })

  it('passes endpoint errors through and leaves the service untouched', async () => {
    const error = { kind: 'stale-token', message: 'expired', retryAfterMs: null } as const
    const h = harness({ fetchUsage: async () => ({ ok: false, error }) })
    expect(await h.refresher.refresh()).toEqual({ ok: false, error })
    expect(h.service.getState().account).toBeNull()
  })

  it('returns the same promise for a call made while one is in flight', async () => {
    const h = harness()
    const first = h.refresher.refresh()
    const second = h.refresher.refresh()
    expect(second).toBe(first)
    await first
    expect(h.fetchUsage).toHaveBeenCalledTimes(1)
  })

  it('enforces a minimum interval and returns the last result in between', async () => {
    const h = harness()
    await h.refresher.refresh()
    h.setNow(1_000_000 + MIN_REFRESH_INTERVAL_MS - 1)
    const again = await h.refresher.refresh()
    expect(again).toEqual({ ok: true })
    expect(h.fetchUsage).toHaveBeenCalledTimes(1)

    h.setNow(1_000_000 + MIN_REFRESH_INTERVAL_MS)
    await h.refresher.refresh()
    expect(h.fetchUsage).toHaveBeenCalledTimes(2)
  })

  it('after a 429 makes no request until Retry-After has passed, then reports the remaining wait', async () => {
    const limited = { kind: 'rate-limited', message: 'Usage service is rate limited. Try again later.', retryAfterMs: 30_000 } as const
    const h = harness({ fetchUsage: async () => ({ ok: false, error: limited }) })
    expect(await h.refresher.refresh()).toEqual({ ok: false, error: limited })

    h.setNow(1_000_000 + 10_000)
    const during = await h.refresher.refresh()
    expect(during).toEqual({ ok: false, error: { ...limited, retryAfterMs: 20_000 } })
    expect(h.fetchUsage).toHaveBeenCalledTimes(1)
    expect(h.readToken).toHaveBeenCalledTimes(1)

    h.setNow(1_000_000 + 30_000)
    await h.refresher.refresh()
    expect(h.fetchUsage).toHaveBeenCalledTimes(2)
  })

  it('uses the default cool-down when a 429 has no Retry-After', async () => {
    const limited = { kind: 'rate-limited', message: 'Usage service is rate limited. Try again later.', retryAfterMs: null } as const
    const h = harness({ fetchUsage: async () => ({ ok: false, error: limited }) })
    await h.refresher.refresh()

    h.setNow(1_000_000 + DEFAULT_RATE_LIMIT_COOLDOWN_MS - 1)
    const during = await h.refresher.refresh()
    expect(during).toMatchObject({ ok: false, error: { kind: 'rate-limited', retryAfterMs: 1 } })
    expect(h.fetchUsage).toHaveBeenCalledTimes(1)
  })

  it('turns an unexpected exception from the endpoint into unavailable and logs it without the token', async () => {
    const h = harness({
      fetchUsage: async () => {
        throw new Error(`exploded while using ${SECRET}`)
      }
    })
    const result = await h.refresher.refresh()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ kind: 'unavailable', retryAfterMs: null })

    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(logMainError).toHaveBeenCalledTimes(1)
    const [dir, context, logged] = vi.mocked(logMainError).mock.calls[0]
    expect(dir).toBe(DIR)
    expect(context).toBe('usage refresh')
    expect(logged).toBeInstanceOf(Error)
    expect((logged as Error).message).not.toContain(SECRET)
    expect((logged as Error).message).toContain('[redacted]')
  })

  it('maps an exception from reading the token to unavailable without throwing', async () => {
    const h = harness({
      readToken: async () => {
        throw new Error('disk on fire')
      }
    })
    const result = await h.refresher.refresh()
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } })
    expect(logMainError).toHaveBeenCalledTimes(1)
  })

  it('maps an exception from the service to unavailable', async () => {
    const service = {
      ingestAccount: () => {
        throw new Error('store broke')
      }
    }
    const refresher = createUsageRefresher({
      readToken: async () => okToken,
      fetchUsage: async () => okUsage,
      service,
      now: () => 1,
      userDataDir: DIR
    })
    const result: UsageRefreshResult = await refresher.refresh()
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } })
  })
})
