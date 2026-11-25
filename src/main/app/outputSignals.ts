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

// Every signal needs one of these literal fragments after ANSI stripping: "/" (both Remote Control variants),
// "↓"/"↑" (the spinner) or "limit" (all three usage-limit wordings). Stripping can only remove characters, never
// add them, so a chunk with none of them cannot match: the cheap scan skips the replace and the detailed regexes.
const SIGNAL_FRAGMENT_PATTERN = /\/|[↓↑]|limit/i

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

/** Longest wording snippet kept for the log; the rest of the line is not useful once the start is known. */
export const USAGE_LIMIT_LINE_MAX = 200

/** Control characters (the TUI emits \r, \b, cursor moves) would break a log line; collapse them to spaces. */
function cleanCapturedLine(line: string): string {
  return line.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The first line of `chunk` that shows Claude's plan-limit message, cleaned and cut to USAGE_LIMIT_LINE_MAX; null
 * when the chunk has no such line. Used to capture the REAL wording in `main-errors.log`, because the pattern list
 * is known to be incomplete ("wording unverified").
 */
export function findUsageLimitLine(chunk: string): string | null {
  const text = stripAnsi(chunk)
  for (const line of text.split(/\r?\n/)) {
    if (!USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(line))) continue
    const cleaned = cleanCapturedLine(line)
    if (cleaned.length > 0) return cleaned.slice(0, USAGE_LIMIT_LINE_MAX)
  }
  // The patterns are whitespace-tolerant and may match across a line break; fall back to the whole chunk.
  if (!USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) return null
  const cleaned = cleanCapturedLine(text)
  return cleaned.length === 0 ? null : cleaned.slice(0, USAGE_LIMIT_LINE_MAX)
}

export function detectOutputSignals(chunk: string): OutputSignals {
  // stripAnsi is the identity when there is no ESC byte: skip the 64KB global replace on plain output entirely.
  const text = chunk.indexOf('\x1b') === -1 ? chunk : stripAnsi(chunk)
  if (!SIGNAL_FRAGMENT_PATTERN.test(text)) {
    return { remoteControl: false, working: false, usageLimit: false }
  }
  return {
    remoteControl: REMOTE_ACTIVE_PATTERN.test(text),
    working: WORKING_SPINNER_PATTERN.test(text),
    usageLimit: USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))
  }
}
