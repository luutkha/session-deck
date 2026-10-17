// Facts read off the Claude Code screen that no hook reports. The TUI redraws its footer and spinner constantly, so a
// chunk-local match is enough; Claude's output is split by cursor moves, hence the whitespace-tolerant patterns.

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g

// The footer shows "/rc active" while Remote Control is on; the one-off banner reads "/remote-control is active".
const REMOTE_ACTIVE_PATTERN = /\/rc\s*active|\/remote-control\s*is\s*active/i

// The spinner line of a running turn: "Kerfuffling… (3s · ↓ 25 tokens)". It is absent while Claude waits for input.
const WORKING_SPINNER_PATTERN = /[↓↑]\s*[\d.,]+\s*k?\s*tokens/i

export interface OutputSignals {
  /** The screen says Remote Control is active for this process. */
  readonly remoteControl: boolean
  /** The spinner of a running turn is on screen. */
  readonly working: boolean
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function detectOutputSignals(chunk: string): OutputSignals {
  const text = stripAnsi(chunk)
  return {
    remoteControl: REMOTE_ACTIVE_PATTERN.test(text),
    working: WORKING_SPINNER_PATTERN.test(text)
  }
}
