import { statSync } from 'node:fs'
import type { Session } from '../../shared/types'
import type { StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention'
import { chooseClaudeLaunch } from './claudeLaunch'

export const YOLO_FLAG = '--dangerously-skip-permissions'

function hasPermissionFlag(args: readonly string[]): boolean {
  return args.some((a) => a === YOLO_FLAG || a === '--permission-mode' || a.startsWith('--permission-mode=') || a === '--allow-dangerously-skip-permissions')
}

export const INITIAL_COLS = 120
export const INITIAL_ROWS = 30

/** Throws `Directory not found: <cwd>` when the session folder is missing or not a directory. */
export function validateCwd(cwd: string): void {
  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(cwd)
  } catch {
    throw new Error(`Directory not found: ${cwd}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Directory not found: ${cwd}`)
  }
}

/** Builds the pty launch options for `claude`. `everStarted` picks `--resume` (true) or `--session-id` (false). */
export function buildStartOptions(
  session: Session,
  everStarted: boolean,
  attention: AttentionService
): StartOptions {
  if (session.agent === 'opencode') {
    return buildOpencodeStartOptions(session, attention)
  }
  const chosen = chooseClaudeLaunch({ claudeSessionId: session.claudeSessionId!, everStarted })
  const userArgs = session.claudeArgs ?? []
  return {
    sessionId: session.id,
    cwd: session.cwd,
    // Sessions always run in yolo mode (no permission prompts) unless the user already chose a permission flag.
    claudeArgs: hasPermissionFlag(userArgs) ? userArgs : [YOLO_FLAG, ...userArgs],
    internalArgs: [...attention.claudeArgs(), ...chosen.args],
    env: attention.envFor(session.id),
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS
  }
}

/**
 * Builds the pty launch options for `opencode`. OpenCode sessions never prompt (the injected plugin config sets
 * permission "*": "allow"), so no Claude flags are used. A new session starts plain `opencode` (plus `--model`
 * when a model is set); resume starts `opencode -s <opencodeSessionId>` when the conversation id is known.
 */
export function buildOpencodeStartOptions(
  session: Session,
  attention: AttentionService
): StartOptions {
  const internalArgs: string[] = []
  if (session.opencodeSessionId !== undefined && session.opencodeSessionId.length > 0) {
    internalArgs.push('-s', session.opencodeSessionId)
  }
  if (session.model !== undefined && session.model.length > 0) {
    internalArgs.push('--model', session.model)
  }
  return {
    sessionId: session.id,
    cwd: session.cwd,
    claudeArgs: [],
    internalArgs,
    command: 'opencode',
    env: { ...attention.envFor(session.id), ...attention.opencodeEnv() },
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS
  }
}
