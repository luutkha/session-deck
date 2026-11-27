// Polls the four extra agents' plan quotas (D96). Each agent has its own timer and its own in-flight fetch, so a
// slow or broken provider never delays the others. The poller knows nothing about UsageService: it only decides WHEN
// to call a fetcher and hands the result to `ingest`, which the caller wires up.
import type {
  PolledProvider,
  ProviderUsageDeps,
  ProviderUsageFetcher,
  ProviderUsageResult,
  ProviderWindows
} from './providerUsageTypes'

export interface ProviderUsagePollerDeps {
  readonly fetchers: Readonly<Record<PolledProvider, ProviderUsageFetcher>>
  readonly makeDeps: () => ProviderUsageDeps
  /** Called with the windows, or null to clear that provider's bar. */
  readonly ingest: (provider: PolledProvider, windows: ProviderWindows | null) => void
  /** Providers that currently have an open session of that agent AND are enabled; asked on every decision. */
  readonly wanted: () => ReadonlySet<PolledProvider>
  readonly now: () => number
  readonly setTimeout: (cb: () => void, ms: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
  readonly onError: (where: string, error: unknown) => void
}

export interface ProviderUsagePoller {
  /** Re-evaluate which providers are wanted (sessions opened/closed, setting changed): a newly wanted provider is
   * fetched at once, an unwanted one stops polling. */
  refreshWanted(): void
  /** Fetch one provider now if wanted (window focus), ignoring the interval but NOT a 'rate-limited' wait. */
  pollNow(provider: PolledProvider): Promise<void>
  stop(): void
}

/** Normal cadence while an agent has an open session. */
export const POLL_INTERVAL_MS = 5 * 60_000
/** HTTP 429 without a usable Retry-After header: assume ten minutes. */
export const RATE_LIMIT_DEFAULT_RETRY_MS = 10 * 60_000
/** A hostile or broken Retry-After must not stop polling for days. */
export const MAX_RATE_LIMIT_RETRY_MS = 24 * 60 * 60_000
/** First 'unavailable' retry, doubled after each consecutive failure. */
export const UNAVAILABLE_BASE_MS = 30_000
/** Ceiling for the 'unavailable' backoff (with the base above, reached after six failures). */
export const MAX_UNAVAILABLE_RETRY_MS = 15 * 60_000

export const POLLED_PROVIDERS: readonly PolledProvider[] = ['codex', 'cursor', 'kimi', 'grok']

type PendingKind = 'interval' | 'rate-limited' | 'unavailable'

interface ProviderState {
  /** The one pending timer (interval or retry), or null while idle / in flight. */
  timer: unknown | null
  /** What the pending timer is waiting for; only a server-imposed rate limit may not be skipped. */
  pending: PendingKind | null
  /** Has an open session and is enabled. */
  wanted: boolean
  /** 'unauthorized' until the provider becomes unwanted and wanted again (a fresh session re-checks the login). */
  suspended: boolean
  /** Consecutive 'unavailable' results; drives exponential backoff. */
  failures: number
  /** Invalidates timers and results from a previous polling cycle. */
  generation: number
  /** Generation of the running fetch, or null when idle (one fetch at a time per provider). */
  inFlight: number | null
}

function freshState(): ProviderState {
  return { timer: null, pending: null, wanted: false, suspended: false, failures: 0, generation: 0, inFlight: null }
}

export function createProviderUsagePoller(deps: ProviderUsagePollerDeps): ProviderUsagePoller {
  const states: Record<PolledProvider, ProviderState> = {
    codex: freshState(),
    cursor: freshState(),
    kimi: freshState(),
    grok: freshState()
  }
  let stopped = false

  function clearTimer(st: ProviderState): void {
    if (st.timer !== null) {
      deps.clearTimeout(st.timer)
      st.timer = null
    }
    st.pending = null
  }

  /** Cancels pending work and makes any in-flight result stale: used on stop and on wanted transitions. */
  function restart(st: ProviderState): void {
    clearTimer(st)
    st.generation += 1
    st.inFlight = null
    st.suspended = false
    st.failures = 0
  }

  function schedule(
    provider: PolledProvider,
    st: ProviderState,
    gen: number,
    delayMs: number,
    pending: PendingKind
  ): void {
    clearTimer(st)
    st.pending = pending
    st.timer = deps.setTimeout(() => {
      st.timer = null
      st.pending = null
      if (stopped || st.generation !== gen || !st.wanted || st.suspended) return
      void runFetch(provider, gen)
    }, delayMs)
  }

  /** Ingest never throws into a timer: a failure is logged and treated like an unavailable fetch. */
  function tryIngest(provider: PolledProvider, windows: ProviderWindows | null): boolean {
    try {
      deps.ingest(provider, windows)
      return true
    } catch (error) {
      deps.onError(`provider usage ingest ${provider}`, error)
      return false
    }
  }

  function applyUnavailable(provider: PolledProvider, st: ProviderState, gen: number): void {
    const delay = Math.min(UNAVAILABLE_BASE_MS * 2 ** st.failures, MAX_UNAVAILABLE_RETRY_MS)
    st.failures += 1
    schedule(provider, st, gen, delay, 'unavailable')
  }

  function handleResult(provider: PolledProvider, st: ProviderState, gen: number, result: ProviderUsageResult): void {
    if (result.ok) {
      if (!tryIngest(provider, result.windows)) {
        applyUnavailable(provider, st, gen)
        return
      }
      st.failures = 0
      schedule(provider, st, gen, POLL_INTERVAL_MS, 'interval')
      return
    }

    switch (result.reason) {
      case 'not-signed-in':
        // Keep the normal cadence: the user may sign in later without opening a new session.
        if (!tryIngest(provider, null)) {
          applyUnavailable(provider, st, gen)
          return
        }
        st.failures = 0
        schedule(provider, st, gen, POLL_INTERVAL_MS, 'interval')
        return
      case 'unauthorized':
        // Hide the stale bar and go quiet. Only a wanted -> unwanted -> wanted transition re-checks the login.
        if (!tryIngest(provider, null)) {
          applyUnavailable(provider, st, gen)
          return
        }
        st.suspended = true
        clearTimer(st)
        return
      case 'rate-limited': {
        const asked = result.retryAfterMs
        const delay =
          typeof asked === 'number' && Number.isFinite(asked) && asked >= 0 ? asked : RATE_LIMIT_DEFAULT_RETRY_MS
        st.failures = 0
        schedule(provider, st, gen, Math.min(delay, MAX_RATE_LIMIT_RETRY_MS), 'rate-limited')
        return
      }
      case 'unavailable':
        // Keep the last bar: a network hiccup must not make a working quota disappear.
        applyUnavailable(provider, st, gen)
        return
    }
  }

  async function runFetch(provider: PolledProvider, gen: number): Promise<void> {
    const st = states[provider]
    if (stopped || !st.wanted || st.suspended || st.generation !== gen || st.inFlight !== null) return
    st.inFlight = gen
    try {
      let result: ProviderUsageResult
      try {
        result = await deps.fetchers[provider](deps.makeDeps())
      } catch (error) {
        // A throwing fetcher (or a deps build failure) is indistinguishable from 'unavailable' to the user.
        deps.onError(`provider usage ${provider}`, error)
        result = { ok: false, reason: 'unavailable' }
      }
      if (stopped || st.generation !== gen || !st.wanted) return
      handleResult(provider, st, gen, result)
    } finally {
      // A newer cycle may have taken over while this fetch ran; only clear our own marker.
      if (st.inFlight === gen) st.inFlight = null
    }
  }

  function refreshWanted(): void {
    if (stopped) return
    const wanted = deps.wanted()
    for (const provider of POLLED_PROVIDERS) {
      const st = states[provider]
      const next = wanted.has(provider)
      if (next === st.wanted) continue
      st.wanted = next
      restart(st)
      if (next) void runFetch(provider, st.generation)
    }
  }

  async function pollNow(provider: PolledProvider): Promise<void> {
    if (stopped) return
    const st = states[provider]
    if (!st.wanted || st.suspended || st.inFlight !== null) return
    // A 429 carries the server's deadline: a focus event must not override it. An 'unavailable' backoff is ours,
    // so a manual fetch is allowed to try recovering (and will restart the backoff if it fails again).
    if (st.pending === 'rate-limited') return
    clearTimer(st)
    st.generation += 1
    await runFetch(provider, st.generation)
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    for (const provider of POLLED_PROVIDERS) {
      const st = states[provider]
      st.wanted = false
      restart(st)
    }
  }

  return { refreshWanted, pollNow, stop }
}
