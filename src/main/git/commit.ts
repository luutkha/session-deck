// D60: what a worktree has not committed yet (`git status`), and committing chosen files of it.
// Every call is runGit (execFile, no shell). Paths go to git through a NUL-separated pathspec file with literal
// pathspecs, so a name with spaces, quotes or glob characters is never interpreted, and a long list never hits the
// Windows command-line limit. The message goes through a file too (-F).
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CommitResult } from '../../shared/types'
import { GitError, type GitRun, runGit } from './gitRunner'

/** Hooks (pre-commit, commit-msg) can take a while; git itself is quick. */
export const COMMIT_TIMEOUT_MS = 120_000
export const COMMIT_MESSAGE_MAX = 10_000
const LITERAL = '--literal-pathspecs'
/** Another git (the user's terminal, an editor) can hold .git/index.lock for a moment. */
export const INDEX_LOCK_ATTEMPTS = 6
export const INDEX_LOCK_RETRY_MS = 400
const INDEX_LOCK_BUSY = /index\.lock.*exists/i

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs a git command that needs the index lock, retrying a few times while another git holds it. */
export async function withIndexLock<T>(work: () => Promise<T>, wait: (ms: number) => Promise<void> = pause): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= INDEX_LOCK_ATTEMPTS || !INDEX_LOCK_BUSY.test(message)) throw error
      await wait(INDEX_LOCK_RETRY_MS)
    }
  }
}

/**
 * Paths that differ from HEAD, from `git status --porcelain=v1 -z`: staged, unstaged and untracked files, and both
 * sides of a staged rename/copy. Paths are relative to the worktree root, as git prints them (forward slashes).
 */
export function parseStatusZ(output: string): ReadonlySet<string> {
  const paths = new Set<string>()
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i]
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    paths.add(entry.slice(3))
    // A rename or copy is followed by its source path as the next field.
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      const source = fields[i + 1]
      if (source !== undefined && source.length > 0) paths.add(source)
      i += 1
    }
  }
  return paths
}

/** Every path of the worktree that differs from HEAD (empty set for a clean worktree). */
export async function readUncommittedPaths(worktreePath: string, run: GitRun = runGit): Promise<ReadonlySet<string>> {
  const result = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: worktreePath })
  return parseStatusZ(result.stdout)
}

/** git's "who are you" failure in plain words (a fresh PC without user.name / user.email). */
function identityHint(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/auto-detect email|identity unknown|tell me who you are|empty ident/i.test(message)) {
    return new GitError('Git does not know who you are yet. Set your name and email once in a terminal: git config --global user.name "Your Name" and git config --global user.email "you@example.com".')
  }
  return error instanceof Error ? error : new GitError(message)
}

export interface CommitPathsInput {
  readonly worktreePath: string
  readonly message: string
  /** Paths to commit; every one must currently differ from HEAD. */
  readonly paths: readonly string[]
}

/**
 * Stages and commits exactly `paths` (git add -A, then git commit --only through the same pathspec file), leaving any
 * other staged change staged and uncommitted. Throws a GitError with git's reason (hook failed, no identity...).
 */
export async function commitPaths(input: CommitPathsInput, run: GitRun = runGit): Promise<CommitResult> {
  const message = input.message.replace(/\r\n/g, '\n').trim()
  if (message.length === 0) throw new GitError('Write a commit message first.')
  if (message.length > COMMIT_MESSAGE_MAX) throw new GitError(`The commit message is too long (max ${COMMIT_MESSAGE_MAX} characters).`)
  if (input.paths.length === 0) throw new GitError('Choose at least one file to commit.')
  const uncommitted = await readUncommittedPaths(input.worktreePath, run)
  const stale = input.paths.filter((p) => !uncommitted.has(p))
  if (stale.length > 0) throw new GitError(`Nothing to commit for ${stale.slice(0, 3).join(', ')}${stale.length > 3 ? '…' : ''}: refresh the Changes list.`)

  const dir = await mkdtemp(path.join(tmpdir(), 'sd-commit-'))
  try {
    const pathspecFile = path.join(dir, 'paths')
    const messageFile = path.join(dir, 'message')
    await writeFile(pathspecFile, input.paths.join('\0'), 'utf8')
    await writeFile(messageFile, message + '\n', 'utf8')
    const pathspec = [`--pathspec-from-file=${pathspecFile}`, '--pathspec-file-nul']
    const options = { cwd: input.worktreePath, timeoutMs: COMMIT_TIMEOUT_MS }
    await withIndexLock(() => run([LITERAL, 'add', '-A', ...pathspec], options))
    try {
      await withIndexLock(() => run([LITERAL, 'commit', '--only', '-F', messageFile, ...pathspec], options))
    } catch (error) {
      throw identityHint(error)
    }
    const head = await run(['log', '-1', '--format=%H%x00%s'], { cwd: input.worktreePath })
    const [sha = '', subject = ''] = head.stdout.trim().split('\0')
    return { sha, subject, files: input.paths.length }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
