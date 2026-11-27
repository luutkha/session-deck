// Contract shared by the per-provider quota fetchers (Codex, Cursor, Kimi, Grok) and the poller (D96).
// Each fetcher reads the provider's OWN login from disk (the same place the agent CLI keeps it), makes at most a few
// read-only HTTPS GET/POST calls, and maps the answer to the plan windows the status bar already shows. Everything
// that touches the machine comes in through ProviderUsageDeps, so each fetcher is a pure function in tests.
// Secrets (tokens, cookies, keys) stay inside the fetcher: never logged, never returned, never put in an error.
import type { UsageProvider, UsageWindow } from '../../../shared/types'

/** What the poller can ask a provider for. `provider` never includes claude / opencode-go (they have their own paths). */
export type PolledProvider = Extract<UsageProvider, 'codex' | 'cursor' | 'kimi' | 'grok'>

/** The plan windows of one provider. resetsAt is epoch SECONDS (like every UsageWindow); percent is 0..100 USED. */
export interface ProviderWindows {
  readonly fiveHour: UsageWindow | null
  readonly sevenDay: UsageWindow | null
  readonly monthly: UsageWindow | null
}

export type ProviderUsageFailure =
  /** No login on this machine (file missing, no token): the provider simply gets no bar. */
  | 'not-signed-in'
  /** The login was refused (401/403, expired token): hide the bar, do not retry before the login changes. */
  | 'unauthorized'
  /** HTTP 429: back off for retryAfterMs (default decided by the poller). */
  | 'rate-limited'
  /** Anything else (offline, timeout, unusable body, unreadable file). */
  | 'unavailable'

export type ProviderUsageResult =
  | { readonly ok: true; readonly windows: ProviderWindows }
  | { readonly ok: false; readonly reason: ProviderUsageFailure; readonly retryAfterMs?: number }

/** A minimal fetch response, so tests need no network. */
export interface ProviderHttpResponse {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface ProviderHttpInit {
  readonly method?: 'GET' | 'POST'
  readonly headers?: Record<string, string>
  readonly body?: string
  /** Abort after this many ms (the fetcher always passes one). */
  readonly timeoutMs: number
}

export interface ProviderUsageDeps {
  readonly platform: NodeJS.Platform
  /** The user's home folder (os.homedir()). */
  readonly homeDir: string
  readonly env: NodeJS.ProcessEnv
  /** Epoch milliseconds. */
  readonly now: () => number
  /** Whole file as UTF-8, or null when it does not exist / cannot be read. Never throws. */
  readonly readTextFile: (absolutePath: string) => Promise<string | null>
  /** Whole file as bytes, or null when missing/unreadable. Never throws. */
  readonly readBinaryFile: (absolutePath: string) => Promise<Buffer | null>
  readonly http: (url: string, init: ProviderHttpInit) => Promise<ProviderHttpResponse>
  /**
   * Windows only: decrypts a DPAPI blob for the CURRENT user via PowerShell (ProtectedData.Unprotect, CurrentUser scope).
   * Returns the plain bytes, or null on any failure. Absent on other platforms.
   */
  readonly dpapiUnprotect?: (blob: Buffer) => Promise<Buffer | null>
}

/** One fetcher. Never throws: every failure is a ProviderUsageResult with ok:false. */
export type ProviderUsageFetcher = (deps: ProviderUsageDeps) => Promise<ProviderUsageResult>

export const PROVIDER_HTTP_TIMEOUT_MS = 10_000
