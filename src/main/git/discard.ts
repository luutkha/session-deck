// D86: discard uncommitted changes of one file or one hunk. Only paths already listed in the changes are ever touched.
import { randomUUID } from 'node:crypto'
import { lstat, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { errorMessage } from '../../shared/guards'
import { type DiscardResult, type WorktreeChanges } from '../../shared/types'
import { type GitRun, runGit } from './gitRunner'
import { readFileDiff } from './worktreeFileDiff'
import { type WorktreeRef } from './worktreeChanges'

const NOT_LISTED = 'File is not in the changes list.'
const INVALID_PATH = 'Invalid file path.'
const NOT_UNCOMMITTED = 'Nothing uncommitted to discard in this file.'
const STALE = 'This file changed since the diff was shown. Reload and try again.'
const NO_MATCH = 'The working copy no longer matches this hunk.'
const UNTRACKED_HUNK = 'Cannot discard one hunk of an untracked file. Discard the whole file instead.'
const BINARY_HUNK = 'Cannot discard one hunk of a binary file. Discard the whole file instead.'
const DIRECTORY = 'Refusing to delete a directory.'
const HUNK_PREFIX = '@@ '
const LF = '\n'

function failed(error: string): DiscardResult {
  return { ok: false, error }
}

function succeeded(): DiscardResult {
  return { ok: true }
}

/** Git paths are relative and use forward slashes; no segment may escape the worktree. */
function isSafeRelative(filePath: string): boolean {
  if (filePath.length === 0 || path.isAbsolute(filePath)) return false
  return filePath.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
}

/** Resolved path must be strictly below the worktree root, never the root itself or a sibling of it. */
function insideWorktree(wt: WorktreeRef, relative: string): string | null {
  const root = path.resolve(wt.path)
  const full = path.resolve(root, relative)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  return full !== root && full.startsWith(prefix) ? full : null
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Restores the index and the working tree to HEAD for the listed paths (a deleted file is recreated). */
export async function discardFile(
  wt: WorktreeRef,
  filePath: string,
  current: WorktreeChanges,
  run: GitRun = runGit
): Promise<DiscardResult> {
  const file = current.files.find((candidate) => candidate.path === filePath)
  if (file === undefined) return failed(NOT_LISTED)
  if (!isSafeRelative(filePath)) return failed(INVALID_PATH)
  const target = insideWorktree(wt, filePath)
  if (target === null) return failed(INVALID_PATH)
  if (file.uncommitted !== true) return failed(NOT_UNCOMMITTED)

  try {
    if (file.kind === 'untracked') {
      // rm(force) removes only this file; lstat first so a directory can never be removed by mistake.
      try {
        if ((await lstat(target)).isDirectory()) return failed(DIRECTORY)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await rm(target, { force: true })
      return succeeded()
    }
    // A file added to the index is not in HEAD, so git restore would remove it; git rm drops both index and disk copy.
    if (file.kind === 'added') {
      await run(['rm', '-f', '--', filePath], { cwd: wt.path })
      return succeeded()
    }
    const paths = file.kind === 'renamed' && file.oldPath !== undefined ? [file.oldPath, filePath] : [filePath]
    if (paths.some((candidate) => !isSafeRelative(candidate) || insideWorktree(wt, candidate) === null)) {
      return failed(INVALID_PATH)
    }
    // For a rename this brings the old path back and removes the new one from both index and working tree.
    await run(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths], { cwd: wt.path })
    return succeeded()
  } catch (error) {
    return failed(`Could not discard changes: ${errorMessage(error)}`)
  }
}

export interface DiffParts {
  /** Everything before the first hunk: diff --git, index, --- / +++ lines. */
  readonly header: string
  /** One entry per hunk, including its trailing "\ No newline at end of file" line when present. */
  readonly hunks: readonly string[]
}

/** Splits a unified diff without changing its line endings or dropping any line. */
export function splitHunks(diff: string): DiffParts {
  const headerLines: string[] = []
  const hunkLines: string[][] = []
  let current: string[] | undefined
  let start = 0
  while (start < diff.length) {
    const breakAt = diff.indexOf(LF, start)
    const end = breakAt === -1 ? diff.length : breakAt + 1
    const line = diff.slice(start, end)
    const bare = line.endsWith(LF) ? line.slice(0, -1) : line
    if (bare.startsWith(HUNK_PREFIX)) {
      current = []
      hunkLines.push(current)
    }
    if (current === undefined) headerLines.push(line)
    else current.push(line)
    start = end
  }
  return { header: headerLines.join(''), hunks: hunkLines.map((lines) => lines.join('')) }
}

/** The hunk header without its line ending, as shown in the UI. */
function hunkHeading(hunk: string): string {
  const breakAt = hunk.indexOf(LF)
  const line = breakAt === -1 ? hunk : hunk.slice(0, breakAt)
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function withFinalNewline(text: string): string {
  return text.endsWith(LF) ? text : text + LF
}

/** Reverses one hunk in the working tree only (the index is untouched), after checking the patch still applies. */
export async function discardHunk(
  wt: WorktreeRef,
  filePath: string,
  hunkIndex: number,
  hunkHeader: string,
  current: WorktreeChanges,
  run: GitRun = runGit
): Promise<DiscardResult> {
  const file = current.files.find((candidate) => candidate.path === filePath)
  if (file === undefined) return failed(NOT_LISTED)
  if (!isSafeRelative(filePath) || insideWorktree(wt, filePath) === null) return failed(INVALID_PATH)
  if (file.kind === 'untracked') return failed(UNTRACKED_HUNK)

  let diff: string
  try {
    const shown = await readFileDiff(wt, filePath, current, run)
    if (shown.binary) return failed(BINARY_HUNK)
    diff = shown.diff
  } catch (error) {
    return failed(`Could not read the diff: ${errorMessage(error)}`)
  }
  const { header, hunks } = splitHunks(diff)
  const hunk = Number.isInteger(hunkIndex) ? hunks[hunkIndex] : undefined
  if (hunk === undefined || hunkHeading(hunk) !== hunkHeader) return failed(STALE)

  // git apply needs a file; a unique name avoids collisions between worktrees and concurrent requests.
  const patchPath = path.join(tmpdir(), `sd-discard-${randomUUID()}.patch`)
  try {
    await writeFile(patchPath, withFinalNewline(header + hunk), 'utf8')
    try {
      await run(['apply', '--reverse', '--check', patchPath], { cwd: wt.path })
    } catch {
      return failed(NO_MATCH)
    }
    try {
      await run(['apply', '--reverse', patchPath], { cwd: wt.path })
    } catch (error) {
      return failed(`Could not discard hunk: ${errorMessage(error)}`)
    }
    return succeeded()
  } catch (error) {
    return failed(`Could not discard hunk: ${errorMessage(error)}`)
  } finally {
    await rm(patchPath, { force: true }).catch(() => undefined)
  }
}
