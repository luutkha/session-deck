import { statSync } from 'node:fs'
import type { Session, ShellKind } from '../../shared/types'
import type { StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention'
import { chooseClaudeLaunch } from './claudeLaunch'
import { OPENCODE_PLUGIN_ENV_VAR, applyConfigPatch } from '../opencode'

export const YOLO_FLAG = '--dangerously-skip-permissions'

/** Arguments that keep a shell interactive and quiet: no banner for PowerShell, nothing for cmd. */
const SHELL_ARGS: Record<ShellKind, readonly string[]> = {
  powershell: ['-NoLogo'],
  pwsh: ['-NoLogo'],
  cmd: []
}

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

/**
 * Builds the pty launch options for `claude`. `everStarted` picks `--resume` (true) or `--session-id` (false).
 * A shell session starts a fresh `shell` program (there is no conversation to resume); `shell` is used only by it.
 */
export function buildStartOptions(
  session: Session,
  everStarted: boolean,
  attention: AttentionService,
  shell: ShellKind = 'powershell',
  /** D52: first start of a fork; see chooseClaudeLaunch. */
  forkFrom?: string
): StartOptions {
  if (session.agent === 'shell') {
    return buildShellStartOptions(session, attention, shell)
  }
  if (session.agent === 'opencode') {
    return buildOpencodeStartOptions(session, attention)
  }
  const chosen = chooseClaudeLaunch({ claudeSessionId: session.claudeSessionId!, everStarted, ...(forkFrom !== undefined ? { forkFrom } : {}) })
  const userArgs = session.claudeArgs ?? []
  return {
    sessionId: session.id,
    cwd: session.cwd,
    // Sessions always run in yolo mode (no permission prompts) unless the user already chose a permission flag.
    claudeArgs: hasPermissionFlag(userArgs) ? userArgs : [YOLO_FLAG, ...userArgs],
    internalArgs: [...attention.claudeArgs(), ...chosen.args],
    // Any `opencode` started from this terminal loads the worker plugin and shows up as a read-only worker tab.
    env: { ...attention.envFor(session.id), ...attention.workerEnv() },
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS
  }
}

/**
 * Builds the pty launch options for a plain shell (Code mode). A shell has no hooks, so only the worker env is set;
 * no Claude flags and no conversation id are used.
 */
export function buildShellStartOptions(
  session: Session,
  attention: AttentionService,
  shell: ShellKind
): StartOptions {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    claudeArgs: [],
    internalArgs: [...SHELL_ARGS[shell]],
    command: shell,
    env: { ...attention.workerEnv() },
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS
  }
}

/**
 * Builds the pty launch options for `opencode`. OpenCode sessions never prompt (the injected plugin config sets
 * permission "*": "allow"), so no Claude flags are used. `--standalone` gives the session a PRIVATE OpenCode server
 * that honors this process' injected plugin environment: by default the TUI would attach to a shared background
 * service, which reads its own (user-global) config and never sees the per-session plugins (OpenCode v2.1.4).
 * A new session starts `opencode --standalone`; resume starts `opencode --standalone -s <opencodeSessionId>` when
 * the conversation id is known. The session's model travels in the OPENCODE_CONFIG_CONTENT value (`model` key):
 * the TUI CLI has no --model flag — with one the process prints help and exits immediately ("ShowHelp: Help
 * requested" on v2.1.4). The env carries BOTH plugins (report + worker), so child opencode processes of this
 * session show as worker tabs while the parent reports itself as the owner (see WorkerHub ownerProcs).
 */
export function buildOpencodeStartOptions(
  session: Session,
  attention: AttentionService
): StartOptions {
  const internalArgs: string[] = ['--standalone']
  if (session.opencodeSessionId !== undefined && session.opencodeSessionId.length > 0) {
    internalArgs.push('-s', session.opencodeSessionId)
  }
  const env: Record<string, string> = { ...attention.envFor(session.id), ...attention.opencodeEnv() }
  const key = OPENCODE_PLUGIN_ENV_VAR
  if (typeof session.model === 'string' && session.model.length > 0) {
    env[key] = applyConfigPatch(env[key], { model: session.model })
  }
  return {
    sessionId: session.id,
    cwd: session.cwd,
    claudeArgs: [],
    internalArgs,
    command: 'opencode',
    env,
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS
  }
}
