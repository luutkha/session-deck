const RESUME_FAILURE_WINDOW_MS = 8000
const REPLAY_TAIL_CHARS = 2000
const NO_CONVERSATION_RE = /no conversation found|could not find|not found/i

export interface ChooseClaudeLaunchInput {
  readonly claudeSessionId: string
  readonly everStarted: boolean
  /**
   * D52: the parent's Claude conversation id for the first start of a fork. Claude copies that conversation into
   * claudeSessionId (`--resume <parent> --fork-session --session-id <new>`) and leaves the parent untouched.
   */
  readonly forkFrom?: string
}

export interface ChooseClaudeLaunchResult {
  readonly args: readonly string[]
  readonly mode: 'new' | 'resume'
}

export function chooseClaudeLaunch(input: ChooseClaudeLaunchInput): ChooseClaudeLaunchResult {
  if (input.forkFrom !== undefined && !input.everStarted) {
    // A fresh id like 'new': if Claude rejects it, the usual "no transcript yet" rotation applies.
    return { args: ['--resume', input.forkFrom, '--fork-session', '--session-id', input.claudeSessionId] as const, mode: 'new' }
  }
  if (input.everStarted) {
    return { args: ['--resume', input.claudeSessionId] as const, mode: 'resume' }
  }
  return { args: ['--session-id', input.claudeSessionId] as const, mode: 'new' }
}

// A resume of an unprompted session says "No conversation found"; starting it fresh under the same id says "already in use".
const UNUSABLE_ID_RE = /no conversation found|session id .* is already in use/i

export interface ShouldRotateSessionIdInput {
  readonly mode: 'new' | 'resume'
  readonly runMs: number
  readonly exitCode: number | null
  readonly outputTail: string
  /** Whether Claude saved a conversation file for the id. */
  readonly hasTranscript: boolean
}

/**
 * A session started but never prompted leaves its id "in use" with nothing to resume: both `--resume` and
 * `--session-id` then fail at once. With no saved conversation the id is worthless, so a fresh one is safe; with a
 * saved conversation the id must be kept (the message then means a real second process).
 */
export function shouldRotateSessionId(input: ShouldRotateSessionIdInput): boolean {
  if (input.hasTranscript) return false
  if (input.runMs >= RESUME_FAILURE_WINDOW_MS) return false
  if (input.exitCode === null || input.exitCode === 0) return false
  return UNUSABLE_ID_RE.test(input.outputTail)
}

export interface ShouldFallbackToNewInput {
  readonly mode: 'new' | 'resume'
  readonly runMs: number
  readonly exitCode: number | null
  readonly outputTail: string
}

export function shouldFallbackToNew(input: ShouldFallbackToNewInput): boolean {
  if (input.mode !== 'resume') {
    return false
  }
  if (input.runMs >= RESUME_FAILURE_WINDOW_MS) {
    return false
  }
  if (input.exitCode === null || input.exitCode === 0) {
    return false
  }
  return NO_CONVERSATION_RE.test(input.outputTail)
}

export { RESUME_FAILURE_WINDOW_MS, REPLAY_TAIL_CHARS, NO_CONVERSATION_RE }