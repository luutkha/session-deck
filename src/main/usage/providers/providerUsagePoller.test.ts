import { describe, it, expect, vi, afterEach } from 'vitest'
import { createProviderUsagePoller, type ProviderUsagePoller } from './providerUsagePoller'
import {
  MAX_RATE_LIMIT_RETRY_MS,
  MAX_UNAVAILABLE_RETRY_MS,
  POLL_INTERVAL_MS,
  RATE_LIMIT_DEFAULT_RETRY_MS,
  UNAVAILABLE_BASE_MS
} from './providerUsagePoller'
import type {
  PolledProvider,
  ProviderUsageDeps,
  ProviderUsageFetcher,
  ProviderUsageResult,
  ProviderWindows
} from './providerUsageTypes'

const PROVIDERS: readonly PolledProvider[] = ['codex', 'cursor', 'kimi', 'grok']

function windows(used: number): ProviderWindows {
  return { fiveHour: { usedPercentage: used, resetsAt: 1000 }, sevenDay: null, monthly: null }
}

type ResultFactory = () => ProviderUsageResult | Promise<ProviderUsageResult>

interface Harness {
  poller: ProviderUsagePoller
  wanted: Set<PolledProvider>
  results: Map<PolledProvider, ResultFactory>
  calls: PolledProvider[]
  delays: number[]
  cleared: unknown[]
  ingests: { provider: PolledProvider; windows: ProviderWindows | null }[]
  errors: { where: string; error: unknown }[]
  config: { ingestError: unknown | null }
  flush(): Promise<void>
  advance(ms: number): Promise<void>
}

function setup(): Harness {
  vi.useFakeTimers()
  const wanted = new Set<PolledProvider>()
  const calls: PolledProvider[] = []
  const delays: number[] = []
  const cleared: unknown[] = []
  const ingests: Harness['ingests'] = []
  const errors: Harness['errors'] = []
  const config: Harness['config'] = { ingestError: null }
  const results = new Map<PolledProvider, ResultFactory>()
  for (const provider of PROVIDERS) results.set(provider, () => ({ ok: true, windows: windows(1) }))

  const fetchers = Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider,
      (): Promise<ProviderUsageResult> => {
        calls.push(provider)
        const next = results.get(provider)
        if (next === undefined) throw new Error(`no result queued for ${provider}`)
        return Promise.resolve(next())
      }
    ])
  ) as unknown as Record<PolledProvider, ProviderUsageFetcher>

  const fakeDeps: ProviderUsageDeps = {
    platform: 'win32',
    homeDir: 'C:\\Users\\tester',
    env: {},
    now: () => Date.now(),
    readTextFile: async () => null,
    readBinaryFile: async () => null,
    http: async () => {
      throw new Error('tests never use the network')
    }
  }

  const poller = createProviderUsagePoller({
    fetchers,
    makeDeps: () => fakeDeps,
    ingest: (provider, bars) => {
      if (config.ingestError !== null) throw config.ingestError
      ingests.push({ provider, windows: bars })
    },
    wanted: () => wanted,
    now: () => Date.now(),
    setTimeout: (cb, ms) => {
      delays.push(ms)
      return setTimeout(cb, ms)
    },
    clearTimeout: (handle) => {
      cleared.push(handle)
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    onError: (where, error) => errors.push({ where, error })
  })

  return {
    poller,
    wanted,
    results,
    calls,
    delays,
    cleared,
    ingests,
    errors,
    config,
    async flush(): Promise<void> {
      await vi.advanceTimersByTimeAsync(0)
    },
    async advance(ms: number): Promise<void> {
      await vi.advanceTimersByTimeAsync(ms)
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('providerUsagePoller', () => {
  it('fetches each newly wanted provider at once and ingests its windows', async () => {
    const h = setup()
    h.wanted.add('grok')
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.calls).toEqual(['codex', 'grok'])
    expect(h.ingests).toEqual([
      { provider: 'codex', windows: windows(1) },
      { provider: 'grok', windows: windows(1) }
    ])
  })

  it('polls each wanted provider every five minutes', async () => {
    const h = setup()
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.calls).toHaveLength(1)
    await h.advance(POLL_INTERVAL_MS - 1)
    expect(h.calls).toHaveLength(1)
    await h.advance(1)
    expect(h.calls).toHaveLength(2)
    await h.advance(POLL_INTERVAL_MS * 2)
    expect(h.calls).toHaveLength(4)
    expect(h.delays).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS, POLL_INTERVAL_MS, POLL_INTERVAL_MS])
  })

  it('never starts a second fetch of one provider while one is in flight', async () => {
    const h = setup()
    let release!: (result: ProviderUsageResult) => void
    h.results.set('codex', () => new Promise<ProviderUsageResult>((resolve) => { release = resolve }))
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    await h.advance(POLL_INTERVAL_MS)
    expect(h.calls).toHaveLength(1)
    release({ ok: true, windows: windows(7) })
    await h.flush()
    expect(h.ingests.at(-1)?.windows?.fiveHour?.usedPercentage).toBe(7)
    await h.advance(POLL_INTERVAL_MS)
    expect(h.calls).toHaveLength(2)
  })

  it('not-signed-in clears the bar and keeps the normal interval', async () => {
    const h = setup()
    h.results.set('cursor', () => ({ ok: false, reason: 'not-signed-in' }))
    h.wanted.add('cursor')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.ingests).toEqual([{ provider: 'cursor', windows: null }])
    expect(h.delays.at(-1)).toBe(POLL_INTERVAL_MS)
    await h.advance(POLL_INTERVAL_MS)
    await h.flush()
    expect(h.calls).toHaveLength(2)
  })

  it('unauthorized clears the bar and stays quiet until unwanted then wanted again', async () => {
    const h = setup()
    h.results.set('kimi', () => ({ ok: false, reason: 'unauthorized' }))
    h.wanted.add('kimi')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.ingests.at(-1)).toEqual({ provider: 'kimi', windows: null })
    expect(h.delays).toHaveLength(0) // the first fetch was direct; no follow-up timer was scheduled
    await h.advance(POLL_INTERVAL_MS * 20)
    expect(h.calls).toHaveLength(1)
    await h.poller.pollNow('kimi')
    expect(h.calls).toHaveLength(1)

    h.wanted.delete('kimi')
    h.poller.refreshWanted()
    h.results.set('kimi', () => ({ ok: true, windows: windows(9) }))
    h.wanted.add('kimi')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.calls).toHaveLength(2)
    expect(h.ingests.at(-1)?.windows?.fiveHour?.usedPercentage).toBe(9)
  })

  it('rate-limited keeps the bar and waits ten minutes by default', async () => {
    const h = setup()
    h.results.set('grok', () => ({ ok: false, reason: 'rate-limited' }))
    h.wanted.add('grok')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.ingests).toHaveLength(0)
    expect(h.delays.at(-1)).toBe(RATE_LIMIT_DEFAULT_RETRY_MS)
    await h.advance(RATE_LIMIT_DEFAULT_RETRY_MS - 1)
    expect(h.calls).toHaveLength(1)
    await h.advance(1)
    await h.flush()
    expect(h.calls).toHaveLength(2)
  })

  it('rate-limited honours retryAfterMs but caps it at 24 hours', async () => {
    const h = setup()
    h.results.set('grok', () => ({ ok: false, reason: 'rate-limited', retryAfterMs: 7_000 }))
    h.wanted.add('grok')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.delays.at(-1)).toBe(7_000)
    h.results.set('grok', () => ({ ok: false, reason: 'rate-limited', retryAfterMs: 48 * 60 * 60_000 }))
    await h.advance(7_000)
    await h.flush()
    expect(h.delays.at(-1)).toBe(MAX_RATE_LIMIT_RETRY_MS)
  })

  it('pollNow fetches early and restarts the interval', async () => {
    const h = setup()
    h.wanted.add('cursor')
    h.poller.refreshWanted()
    await h.flush()
    await h.advance(1_000)
    await h.poller.pollNow('cursor')
    await h.flush()
    expect(h.calls).toHaveLength(2)
    expect(h.delays.at(-1)).toBe(POLL_INTERVAL_MS)
    await h.advance(POLL_INTERVAL_MS - 1)
    expect(h.calls).toHaveLength(2)
    await h.advance(1)
    await h.flush()
    expect(h.calls).toHaveLength(3)
  })

  it('pollNow never bypasses a rate-limit wait', async () => {
    const h = setup()
    h.results.set('cursor', () => ({ ok: false, reason: 'rate-limited', retryAfterMs: 60_000 }))
    h.wanted.add('cursor')
    h.poller.refreshWanted()
    await h.flush()
    await h.poller.pollNow('cursor')
    await h.flush()
    expect(h.calls).toHaveLength(1)
    await h.advance(60_000)
    await h.flush()
    expect(h.calls).toHaveLength(2)
  })

  it('pollNow ignores an unwanted provider', async () => {
    const h = setup()
    await h.poller.pollNow('codex')
    expect(h.calls).toHaveLength(0)
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    h.wanted.delete('codex')
    h.poller.refreshWanted()
    await h.poller.pollNow('codex')
    expect(h.calls).toHaveLength(1)
  })

  it('unavailable keeps the bar and backs off from 30 s, doubling and capping at 15 min', async () => {
    const h = setup()
    h.wanted.add('kimi')
    h.poller.refreshWanted()
    await h.flush()
    h.results.set('kimi', () => ({ ok: false, reason: 'unavailable' }))
    await h.advance(POLL_INTERVAL_MS)
    await h.flush()
    expect(h.ingests).toHaveLength(1)
    expect(h.delays.at(-1)).toBe(UNAVAILABLE_BASE_MS)
    await h.advance(UNAVAILABLE_BASE_MS)
    await h.flush()
    expect(h.delays.at(-1)).toBe(UNAVAILABLE_BASE_MS * 2)
    await h.advance(UNAVAILABLE_BASE_MS * 2)
    await h.flush()
    expect(h.delays.at(-1)).toBe(UNAVAILABLE_BASE_MS * 4)
    for (let i = 0; i < 6; i += 1) {
      await h.advance(h.delays.at(-1) ?? 0)
      await h.flush()
    }
    expect(h.delays.at(-1)).toBe(MAX_UNAVAILABLE_RETRY_MS)
  })

  it('a success resets the unavailable backoff', async () => {
    const h = setup()
    h.wanted.add('kimi')
    h.poller.refreshWanted()
    await h.flush()
    h.results.set('kimi', () => ({ ok: false, reason: 'unavailable' }))
    await h.advance(POLL_INTERVAL_MS)
    await h.flush()
    h.results.set('kimi', () => ({ ok: true, windows: windows(8) }))
    await h.advance(UNAVAILABLE_BASE_MS)
    await h.flush()
    expect(h.ingests.at(-1)?.windows?.fiveHour?.usedPercentage).toBe(8)
    expect(h.delays.at(-1)).toBe(POLL_INTERVAL_MS)
    h.results.set('kimi', () => ({ ok: false, reason: 'unavailable' }))
    await h.advance(POLL_INTERVAL_MS)
    await h.flush()
    expect(h.delays.at(-1)).toBe(UNAVAILABLE_BASE_MS)
  })

  it('a throwing fetcher is reported and counted as unavailable', async () => {
    const h = setup()
    const boom = new Error('read failed')
    h.results.set('codex', () => { throw boom })
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.errors).toEqual([{ where: 'provider usage codex', error: boom }])
    expect(h.ingests).toHaveLength(0)
    expect(h.delays.at(-1)).toBe(UNAVAILABLE_BASE_MS)
  })

  it('a throwing ingest is reported and counted as unavailable', async () => {
    const h = setup()
    const boom = new Error('ingest failed')
    h.config.ingestError = boom
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.errors).toEqual([{ where: 'provider usage ingest codex', error: boom }])
    expect(h.delays.at(-1)).toBe(UNAVAILABLE_BASE_MS)
  })

  it('a slow provider never delays another', async () => {
    const h = setup()
    let release!: (result: ProviderUsageResult) => void
    h.results.set('codex', () => new Promise<ProviderUsageResult>((resolve) => { release = resolve }))
    h.wanted.add('codex')
    h.wanted.add('cursor')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.calls).toEqual(['codex', 'cursor'])
    expect(h.ingests.map((i) => i.provider)).toEqual(['cursor'])
    release({ ok: true, windows: windows(7) })
    await h.flush()
    expect(h.ingests.map((i) => i.provider)).toEqual(['cursor', 'codex'])
  })

  it('an unwanted provider drops its timer and a result already in flight is ignored', async () => {
    const h = setup()
    let release!: (result: ProviderUsageResult) => void
    h.results.set('codex', () => new Promise<ProviderUsageResult>((resolve) => { release = resolve }))
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    h.wanted.delete('codex')
    h.poller.refreshWanted()
    release({ ok: true, windows: windows(9) })
    await h.flush()
    expect(h.ingests).toHaveLength(0)
    expect(h.delays).toEqual([]) // the stale result scheduled neither an ingest nor another timer
    await h.advance(POLL_INTERVAL_MS * 5)
    expect(h.calls).toHaveLength(1)
  })

  it('a wanted provider with a pending timer clears it when it becomes unwanted', async () => {
    const h = setup()
    h.wanted.add('kimi')
    h.poller.refreshWanted()
    await h.flush()
    expect(h.cleared).toHaveLength(0)
    h.wanted.delete('kimi')
    h.poller.refreshWanted()
    expect(h.cleared).toHaveLength(1)
    await h.advance(POLL_INTERVAL_MS * 5)
    expect(h.calls).toHaveLength(1)
  })

  it('stop clears timers and blocks later polls', async () => {
    const h = setup()
    h.wanted.add('codex')
    h.poller.refreshWanted()
    await h.flush()
    h.poller.stop()
    expect(h.cleared).toHaveLength(1)
    await h.advance(POLL_INTERVAL_MS * 10)
    await h.flush()
    expect(h.calls).toHaveLength(1)
    h.wanted.add('grok')
    h.poller.refreshWanted()
    await h.poller.pollNow('codex')
    await h.flush()
    expect(h.calls).toHaveLength(1)
  })
})
