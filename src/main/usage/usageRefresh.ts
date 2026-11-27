// Manual usage refresh orchestration: single flight and 429 cool-down. Every refresh fetches again. Never throws.
import type { UsageRefreshError, UsageRefreshResult } from '../../shared/types'
import { logMainError } from '../app/errorLog'
import type { TokenResult, UsageFetchResult } from './oauthUsage'
import type { UsageService } from './UsageService'
import { errorMessage } from '../../shared/guards'

export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000

const UNEXPECTED_MESSAGE = 'Usage refresh failed unexpectedly. Details were written to the error log.'
const REDACTED = '[redacted]'

export interface UsageRefresherDeps {
  readonly readToken: () => Promise<TokenResult>
  readonly fetchUsage: (token: string) => Promise<UsageFetchResult>
  readonly service: Pick<UsageService, 'ingestAccount'>
  readonly now: () => number
  /** Directory of main-errors.log. */
  readonly userDataDir: string
}

export interface UsageRefresher {
  /** Asks the usage endpoint once (or returns the in-flight result while one is running). */
  refresh(): Promise<UsageRefreshResult>
}

/** Removes every occurrence of the secret and returns a fresh Error that carries only the sanitized text. */
function redact(error: unknown, secret: string | null): Error {
  const name = error instanceof Error ? error.name : 'Error'
  let raw = 'unprintable error'
  try {
    raw = errorMessage(error)
  } catch {
    // Keep the placeholder; logging must not fail here.
  }
  const message = secret === null ? raw : raw.split(secret).join(REDACTED)
  const sanitized = new Error(message)
  sanitized.name = name
  return sanitized
}

export function createUsageRefresher(deps: UsageRefresherDeps): UsageRefresher {
  let inFlight: Promise<UsageRefreshResult> | null = null
  let cooldown: { readonly until: number; readonly error: UsageRefreshError } | null = null

  function startCooldown(error: UsageRefreshError): void {
    const waitMs = error.retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS
    cooldown = { until: deps.now() + waitMs, error }
  }

  async function runAttempt(): Promise<UsageRefreshResult> {
    let secret: string | null = null
    try {
      const token = await deps.readToken()
      if (!token.ok) {
        return { ok: false, error: token.error }
      }
      secret = token.token

      const usage = await deps.fetchUsage(token.token)
      if (!usage.ok) {
        if (usage.error.kind === 'rate-limited') {
          startCooldown(usage.error)
        }
        return { ok: false, error: usage.error }
      }

      deps.service.ingestAccount({ fiveHour: usage.fiveHour, sevenDay: usage.sevenDay })
      return { ok: true }
    } catch (error) {
      logMainError(deps.userDataDir, 'usage refresh', redact(error, secret))
      return { ok: false, error: { kind: 'unavailable', message: UNEXPECTED_MESSAGE, retryAfterMs: null } }
    }
  }

  async function decide(): Promise<UsageRefreshResult> {
    const t = deps.now()

    if (cooldown !== null && t < cooldown.until) {
      return { ok: false, error: { ...cooldown.error, retryAfterMs: cooldown.until - t } }
    }

    return runAttempt()
  }

  return {
    refresh(): Promise<UsageRefreshResult> {
      if (inFlight !== null) return inFlight
      const pending = decide()
        .catch((error: unknown): UsageRefreshResult => {
          logMainError(deps.userDataDir, 'usage refresh', redact(error, null))
          return { ok: false, error: { kind: 'unavailable', message: UNEXPECTED_MESSAGE, retryAfterMs: null } }
        })
        .finally(() => {
          inFlight = null
        })
      inFlight = pending
      return pending
    }
  }
}
