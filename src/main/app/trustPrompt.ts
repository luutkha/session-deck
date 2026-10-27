// Opt-in auto-answer for Claude Code's "Do you trust the files in this folder?" prompt (W6). The text and the
// answer sequence are the exact ones the e2e harness has used against the real TUI: "No, exit" starts selected, so
// Down moves to "Yes, I trust this folder" and Enter confirms it.
//
// Scope rules (all must hold): the user turned the setting on, the session is Claude, it lives in a Code-mode
// worktree, and this process was started fresh (a resumed conversation never asks again). One answer per process.
import type { AgentKind, Id } from '../../shared/types'
import { stripAnsi } from './outputSignals'

/** Claude's menu labels, whitespace-tolerant because the TUI emits cursor moves between words. */
const TRUST_YES_PATTERN = /Yes,\s*I\s*trust\s*this\s*folder/i
const TRUST_NO_PATTERN = /No,\s*exit/i

/** Down (move from the preselected "No, exit" to "Yes") then Enter. */
export const TRUST_ANSWER_INPUT = '\x1b[B\r'

/** How much recent output is kept per session so a prompt split across writes is still recognised. */
export const TRUST_BUFFER_MAX = 4000

export function isTrustPrompt(text: string): boolean {
  const plain = stripAnsi(text)
  return TRUST_YES_PATTERN.test(plain) && TRUST_NO_PATTERN.test(plain)
}

export interface TrustPromptContext {
  /** Settings > Code: off by default. */
  readonly enabled: boolean
  readonly agent: AgentKind | undefined
  /** Present only for Code-mode (worktree) sessions. */
  readonly worktreeId: Id | undefined
  /** True when this pty was started with a fresh conversation, not resumed or restarted. */
  readonly firstStart: boolean
  /** True once this process has already been answered. */
  readonly answered: boolean
}

/** True when the watcher is allowed to act on a trust prompt in this session. */
export function shouldAnswerTrustPrompt(context: TrustPromptContext): boolean {
  return (
    context.enabled &&
    context.worktreeId !== undefined &&
    (context.agent === undefined || context.agent === 'claude') &&
    context.firstStart &&
    !context.answered
  )
}

/** Keeps the tail of a session's output (ANSI stripped) for prompt detection across chunk boundaries. */
export function appendTrustBuffer(previous: string, chunk: string): string {
  return (previous + stripAnsi(chunk)).slice(-TRUST_BUFFER_MAX)
}
