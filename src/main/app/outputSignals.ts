// Facts read off the Claude Code screen that no hook reports. The TUI redraws its footer and spinner constantly, so a
// chunk-local match is enough; Claude's output is split by cursor moves, hence the whitespace-tolerant patterns.

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g

// The footer shows "/rc active" while Remote Control is on; the one-off banner reads "/remote-control is active".
const REMOTE_ACTIVE_PATTERN = /\/rc\s*active|\/remote-control\s*is\s*active/i

// The spinner line of a running turn: "Kerfuffling… (3s · ↓ 25 tokens)". It is absent while Claude waits for input.
const WORKING_SPINNER_PATTERN = /[↓↑]\s*[\d.,]+\s*k?\s*tokens/i

/**
 * Claude's plan-limit message, as printed when a turn is cut off: "Claude usage limit reached. Your limit will reset at
 * 5pm", "5-hour limit reached ∙ resets 3pm", "You've hit your limit · resets 7pm". "limit reached" alone is too generic
 * (it also appears in user code), so it must be followed by "reset" within 40 characters.
 */
export const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage\s*limit\s*reached/i,
  /limit\s*reached[\s\S]{0,40}?reset/i,
  /you(?:['’]ve|\s+have)\s*hit\s*your\s*(?:usage\s*)?limit/i
]

export interface OutputSignals {
  /** The screen says Remote Control is active for this process. */
  readonly remoteControl: boolean
  /** The spinner of a running turn is on screen. */
  readonly working: boolean
  /** The screen shows Claude's usage-limit message (the turn was cut off by the plan limit). */
  readonly usageLimit: boolean
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function detectOutputSignals(chunk: string): OutputSignals {
  const text = stripAnsi(chunk)
  return {
    remoteControl: REMOTE_ACTIVE_PATTERN.test(text),
    working: WORKING_SPINNER_PATTERN.test(text),
    usageLimit: USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))
  }
}
