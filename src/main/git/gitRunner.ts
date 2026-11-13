// Runs git with execFile (never a shell). Every git call in the Code mode goes through runGit.
import { execFile } from 'node:child_process'
import { createLimiter } from './limiter'

export interface GitResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

export interface GitRunOptions {
  readonly cwd: string
  readonly timeoutMs?: number
  readonly maxBytes?: number
  /** Exit codes that count as success (default [0]). */
  readonly okCodes?: readonly number[]
}

export type GitRun = (args: readonly string[], options: GitRunOptions) => Promise<GitResult>

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

export const GIT_TIMEOUT_MS = 15000
export const GIT_MAX_BYTES = 16 * 1024 * 1024
/** git exits 128 for "fatal" errors (not a repository, unknown revision, bad path...). */
export const GIT_FATAL_EXIT_CODE = 128
/**
 * At most this many git processes run at once, app-wide: a Code mode refresh of many worktrees used to start ~5 per
 * worktree in one burst (hundreds of child processes). The rest wait in the order they were asked for.
 */
export const GIT_MAX_CONCURRENT = 4
const gitSlots = createLimiter(GIT_MAX_CONCURRENT)

const DEFAULT_OK_CODES: readonly number[] = [0]
const GIT_CONFIG_ARGS = ['-c', 'core.quotepath=false']
const NOT_FOUND_MESSAGE = 'Git was not found. Install Git and restart SessionDeck.'
const GIT_ERROR_LINE = /^(fatal|error): /

interface ExecFailure {
  readonly code?: string | number
  readonly killed?: boolean
}

/**
 * The environment git runs in: inherits the app's, but never prompts (GIT_TERMINAL_PROMPT) and speaks English
 * (LC_ALL=C) so the failureMessage can parse "fatal:"/"error:" lines on a non-English Windows.
 * GIT_OPTIONAL_LOCKS=0 (D60): the Changes panel's background `git status` must not take .git/index.lock to refresh
 * the index, or a Commit (or the user's own git in a terminal) at the same moment fails with "index.lock: File exists".
 * Commands that need the lock (add, commit, merge) still take it.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
}

/** Maps an execFile failure that is not a plain exit code to a short user-facing message. */
function startFailureMessage(error: ExecFailure, subcommand: string): string | null {
  if (error.code === 'ENOENT') return NOT_FOUND_MESSAGE
  if (error.killed === true) return `git ${subcommand} timed out`
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return `git ${subcommand} output is too large`
  return null
}

/**
 * The git error line: the first "fatal:" / "error:" line when git prints one (progress lines such as "Preparing
 * worktree" can come before it), else the first non-empty stderr line. Falls back to a generic message.
 */
function failureMessage(stderr: string, subcommand: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const errorLine = lines.find((line) => GIT_ERROR_LINE.test(line))
  return errorLine ?? lines[0] ?? `git ${subcommand} failed`
}

/**
 * Runs `git <args>` in options.cwd. Resolves when the exit code is in okCodes; otherwise rejects with a GitError
 * carrying the first stderr line. Git never prompts (GIT_TERMINAL_PROMPT=0) and its console window stays hidden.
 */
export const runGit: GitRun = (args, options) => gitSlots(() => spawnGit(args, options))

function spawnGit(args: readonly string[], options: GitRunOptions): Promise<GitResult> {
  return new Promise<GitResult>((resolve, reject) => {
    const subcommand = args[0] ?? ''
    const okCodes = options.okCodes ?? DEFAULT_OK_CODES
    execFile(
      'git',
      [...GIT_CONFIG_ARGS, ...args],
      {
        cwd: options.cwd,
        windowsHide: true,
        timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
        maxBuffer: options.maxBytes ?? GIT_MAX_BYTES,
        encoding: 'utf8',
        env: gitEnv()
      },
      (error, stdout, stderr) => {
        const failure = error as ExecFailure | null
        if (failure === null) {
          resolve({ stdout, stderr, code: 0 })
          return
        }
        const failed = startFailureMessage(failure, subcommand)
        if (failed !== null) {
          reject(new GitError(failed))
          return
        }
        // Only a numeric exit code can be judged against okCodes; a signal-killed process never counts as success.
        if (typeof failure.code === 'number' && okCodes.includes(failure.code)) {
          resolve({ stdout, stderr, code: failure.code })
          return
        }
        reject(new GitError(failureMessage(stderr, subcommand)))
      }
    )
  })
}
