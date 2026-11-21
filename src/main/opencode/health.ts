/**
 * Pure decisions about the injected OpenCode plugin: is it reporting at all (plugin-health check with status
 * fallback, D79), and does a failure text mean the provider/plan usage limit was hit (usage-limit detection for the
 * autopilot, D79). No timers, no Electron, no I/O: the wiring owns the clock and the event flag, so both rules are
 * testable on their own.
 *
 * The plugin (see pluginSource.ts) posts its first hook/statusline body as soon as OpenCode runs it, and every
 * failure in the plugin is swallowed ("post NOTHING") because the app may be gone. Silence past the grace window is
 * therefore the plugin-missing signal, not an error the app can read from OpenCode.
 */

/** How long a freshly started OpenCode session may stay silent before its plugin is reported missing. */
export const OPENCODE_PLUGIN_HEALTH_GRACE_MS = 20_000

/** 'starting' = still inside the grace window, 'ok' = at least one plugin event arrived, 'missing' = silent too long. */
export type OpencodePluginHealth = 'starting' | 'ok' | 'missing'

export interface OpencodePluginHealthInput {
  /** When this OpenCode session's process was started (ms since epoch). */
  readonly startedAtMs: number
  /** The current time (ms since epoch); injected so tests never wait. */
  readonly nowMs: number
  /** True once any event from the injected plugin was received for this session. */
  readonly sawPluginEvent: boolean
  /** Override for the grace window; defaults to OPENCODE_PLUGIN_HEALTH_GRACE_MS. */
  readonly graceMs?: number
}

/**
 * The plugin-health decision. Any plugin event means the plugin is loaded and talking, so the session is 'ok' at
 * once; without one the session is 'starting' inside the grace window and 'missing' only after it. A clock that went
 * backwards (now before the start) cannot prove the window passed, so it stays 'starting'.
 */
export function opencodePluginHealth(input: OpencodePluginHealthInput): OpencodePluginHealth {
  if (input.sawPluginEvent) return 'ok'
  const graceMs =
    input.graceMs !== undefined && Number.isFinite(input.graceMs) && input.graceMs >= 0
      ? input.graceMs
      : OPENCODE_PLUGIN_HEALTH_GRACE_MS
  const elapsedMs = input.nowMs - input.startedAtMs
  if (!Number.isFinite(elapsedMs)) return 'starting'
  return elapsedMs < graceMs ? 'starting' : 'missing'
}

/**
 * Provider/plan limit wording. Conservative on purpose: "limit" alone, "retry limit reached" in user code or a file
 * name like `rate-limit.ts` must not stop a session, so every pattern names the limited thing (usage, rate, quota,
 * credits) or a plan window. A bare 429 is not enough: the status code counts only next to limit wording.
 */
export const OPENCODE_USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /\busage[\s_-]+limits?\b(?!\.\w)/i,
  /\brate[\s_-]+limit(?:ed|s)?\b(?!\.\w)/i,
  /\btoo many requests\b/i,
  /\bquota\b[^\n]{0,40}\b(?:exceeded|exhausted|reached)\b/i,
  /\b(?:exceeded|exhausted|reached)\b[^\n]{0,40}\bquota\b/i,
  /\binsufficient[\s_-]?(?:quota|credits?|balance|funds)\b/i,
  /\bout of (?:credits?|funds)\b/i,
  /\bno (?:remaining )?credits\b/i,
  /\bcredit balance\b[^\n]{0,30}\b(?:too low|empty|zero|exhausted)\b/i,
  /\b(?:daily|weekly|monthly|hourly|5-hour|five-hour|rolling|free|trial|plan|subscription)[\s_-]+(?:usage[\s_-]+)?limits?\b/i,
  /\byou(?:['’]ve|\s+have)\s+hit\s+your\s+(?:usage\s+)?limit\b/i,
  /\b429\b[^\n]{0,40}\blimits?\b|\blimits?\b[^\n]{0,40}\b429\b/i
]

/**
 * Whether a failure text (an OpenCode error message, a plugin error payload, stderr) says the provider or plan
 * usage limit was hit: "Free usage limit reached", "rate limit", "quota exceeded", "insufficient credits", or a 429
 * carrying limit wording. Ordinary failures (network reset, syntax error, a stray "limit" in code or a file name)
 * return false, so the autopilot never sleeps a session for the wrong reason.
 */
export function isOpencodeUsageLimit(text: string): boolean {
  if (typeof text !== 'string' || text.trim().length === 0) return false
  return OPENCODE_USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))
}
