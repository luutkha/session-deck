// What differs between a worktree and its base: tracked changes (committed, staged, unstaged) plus untracked files.
import path from 'node:path'
import { CHANGES_MAX_FILES, type ChangedFile, type Id, type WorktreeChanges } from '../../shared/types'
import { isDirectory } from './fsCheck'
import { GIT_FATAL_EXIT_CODE, type GitRun, runGit } from './gitRunner'
import { countUntrackedAdditions } from './untrackedCount'
import {
  type LineCounts,
  type NameStatusEntry,
  parseNameStatusZ,
  parseNumstatZ,
  parseUntrackedZ
} from './worktreeParse'
import { errorMessage } from '../../shared/guards'

export interface WorktreeRef {
  readonly id: Id
  readonly path: string
  readonly baseBranch: string
  readonly baseCommit: string
}

const SHA_PATTERN = /^[0-9a-f]{40}$/
const NO_COUNTS: LineCounts = { additions: null, deletions: null }

/**
 * The commit the worktree is compared with: merge-base(baseBranch, HEAD), so later commits on the base do not show up.
 * Falls back to the commit stored at creation when the base branch is gone or there is no merge-base.
 */
export async function diffBase(wt: WorktreeRef, run: GitRun = runGit): Promise<string> {
  const result = await run(['merge-base', wt.baseBranch, 'HEAD'], {
    cwd: wt.path,
    okCodes: [0, 1, GIT_FATAL_EXIT_CODE]
  })
  const sha = result.stdout.trim()
  return result.code === 0 && SHA_PATTERN.test(sha) ? sha : wt.baseCommit
}

function toChangedFile(entry: NameStatusEntry, counts: LineCounts): ChangedFile {
  const file = { path: entry.path, kind: entry.kind, additions: counts.additions, deletions: counts.deletions }
  return entry.oldPath === undefined ? file : { ...file, oldPath: entry.oldPath }
}

function trackedFiles(numstatOutput: string, nameStatusOutput: string): ChangedFile[] {
  const counts = parseNumstatZ(numstatOutput)
  return parseNameStatusZ(nameStatusOutput).map((entry) => toChangedFile(entry, counts.get(entry.path) ?? NO_COUNTS))
}

/** Untracked files only add lines; when their count is unknown (binary, huge) the deletions are unknown too. */
async function untrackedFile(worktreePath: string, filePath: string): Promise<ChangedFile> {
  const additions = await countUntrackedAdditions(path.join(worktreePath, filePath))
  return { path: filePath, kind: 'untracked', additions, deletions: additions === null ? null : 0 }
}

async function untrackedFiles(worktreePath: string, lsFilesOutput: string): Promise<ChangedFile[]> {
  return Promise.all(parseUntrackedZ(lsFilesOutput).map((filePath) => untrackedFile(worktreePath, filePath)))
}

function compareByPath(a: ChangedFile, b: ChangedFile): number {
  if (a.path === b.path) return 0
  return a.path < b.path ? -1 : 1
}

function sumOf(files: readonly ChangedFile[], key: 'additions' | 'deletions'): number {
  return files.reduce((total, file) => total + (file[key] ?? 0), 0)
}

/** Sorts, caps the list and totals every file (the totals include files cut by the cap). */
function buildChanges(worktreeId: Id, files: readonly ChangedFile[], computedAt: number): WorktreeChanges {
  const sorted = [...files].sort(compareByPath)
  return {
    worktreeId,
    files: sorted.slice(0, CHANGES_MAX_FILES),
    truncated: sorted.length > CHANGES_MAX_FILES,
    additions: sumOf(sorted, 'additions'),
    deletions: sumOf(sorted, 'deletions'),
    computedAt
  }
}

async function collectChanges(wt: WorktreeRef, now: () => number, run: GitRun): Promise<WorktreeChanges> {
  if (!(await isDirectory(wt.path))) throw new Error(`Worktree folder not found: ${wt.path}`)
  const base = await diffBase(wt, run)
  const options = { cwd: wt.path }
  const [numstat, nameStatus, untracked] = await Promise.all([
    run(['diff', '--numstat', '-z', '-M', base], options),
    run(['diff', '--name-status', '-z', '-M', base], options),
    run(['ls-files', '--others', '--exclude-standard', '-z'], options)
  ])
  const files = [
    ...trackedFiles(numstat.stdout, nameStatus.stdout),
    ...(await untrackedFiles(wt.path, untracked.stdout))
  ]
  return buildChanges(wt.id, files, now())
}

/**
 * Every change of the worktree against its base. Never throws: a failure (folder missing, git missing, unreadable
 * output) comes back as `error` with no files.
 */
export async function readWorktreeChanges(
  wt: WorktreeRef,
  now: () => number,
  run: GitRun = runGit
): Promise<WorktreeChanges> {
  try {
    return await collectChanges(wt, now, run)
  } catch (error) {
    return {
      worktreeId: wt.id,
      files: [],
      truncated: false,
      additions: 0,
      deletions: 0,
      computedAt: now(),
      error: errorMessage(error)
    }
  }
}
