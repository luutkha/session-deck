// Unified diff of one file of a worktree. Only paths already listed in the changes are ever diffed.
import { type ChangedFile, DIFF_MAX_BYTES, type FileDiff, type WorktreeChanges } from '../../shared/types'
import { type GitRun, runGit } from './gitRunner'
import { diffBase, type WorktreeRef } from './worktreeChanges'

const LF = 0x0a
const BINARY_LINE = /^Binary files /m
const HUNK_MARKER = '@@'
/** Flags that keep the output plain: no colour codes, no external diff tools. */
const PLAIN_DIFF_FLAGS = ['--no-color', '--no-ext-diff'] as const

interface CappedText {
  readonly text: string
  readonly truncated: boolean
}

/** Git prints "Binary files ... differ" and no hunks for binary content. */
function isBinaryDiff(raw: string): boolean {
  return BINARY_LINE.test(raw) && !raw.includes(HUNK_MARKER)
}

/** Keeps at most DIFF_MAX_BYTES, cut after the last line break that fits. */
function capDiff(text: string): CappedText {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= DIFF_MAX_BYTES) return { text, truncated: false }
  const head = bytes.subarray(0, DIFF_MAX_BYTES)
  const lastBreak = head.lastIndexOf(LF)
  const kept = lastBreak < 0 ? Buffer.alloc(0) : head.subarray(0, lastBreak + 1)
  return { text: kept.toString('utf8'), truncated: true }
}

/** Untracked files are compared with /dev/null (git accepts it on Windows too). */
async function untrackedDiff(wt: WorktreeRef, file: ChangedFile, run: GitRun): Promise<string> {
  const result = await run(['diff', '--no-index', ...PLAIN_DIFF_FLAGS, '--', '/dev/null', file.path], {
    cwd: wt.path,
    okCodes: [0, 1]
  })
  return result.stdout
}

/** Tracked files: base commit against the working tree; a rename lists both paths. */
async function trackedDiff(wt: WorktreeRef, file: ChangedFile, run: GitRun): Promise<string> {
  const base = await diffBase(wt, run)
  const paths = file.oldPath === undefined ? [file.path] : [file.oldPath, file.path]
  const result = await run(['diff', '-M', ...PLAIN_DIFF_FLAGS, base, '--', ...paths], { cwd: wt.path })
  return result.stdout
}

async function rawDiff(wt: WorktreeRef, file: ChangedFile, run: GitRun): Promise<string> {
  return file.kind === 'untracked' ? untrackedDiff(wt, file, run) : trackedDiff(wt, file, run)
}

/**
 * Diff of one file from the changes list. Rejects paths that are not in `current.files`, so the renderer can never
 * ask for an arbitrary file on disk.
 */
export async function readFileDiff(
  wt: WorktreeRef,
  filePath: string,
  current: WorktreeChanges,
  run: GitRun = runGit
): Promise<FileDiff> {
  const file = current.files.find((candidate) => candidate.path === filePath)
  if (file === undefined) throw new Error('File is not in the changes list')
  const raw = await rawDiff(wt, file, run)
  if (isBinaryDiff(raw)) {
    return { worktreeId: wt.id, path: filePath, diff: '', binary: true, truncated: false }
  }
  const capped = capDiff(raw)
  return { worktreeId: wt.id, path: filePath, diff: capped.text, binary: false, truncated: capped.truncated }
}
