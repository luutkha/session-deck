// Repository queries: which folder is the repo root, which branches exist, what a ref points at.
import path from 'node:path'
import type { RepoBranches } from '../../shared/types'
import { isDirectory } from './fsCheck'
import { GIT_FATAL_EXIT_CODE, type GitRun, runGit } from './gitRunner'

const FATAL_OK_CODES: readonly number[] = [0, GIT_FATAL_EXIT_CODE]
const SHA_PATTERN = /^[0-9a-f]{40}$/

/** Windows paths use backslashes; git prints forward slashes. */
function normalisePath(p: string): string {
  return process.platform === 'win32' ? path.win32.normalize(p) : path.resolve(p)
}

/** Same location? Windows paths compare case-insensitively. */
function samePath(a: string, b: string): boolean {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

async function assertNotBare(folder: string, run: GitRun): Promise<void> {
  const result = await run(['rev-parse', '--is-bare-repository'], { cwd: folder, okCodes: FATAL_OK_CODES })
  if (result.stdout.trim() === 'true') throw new Error('Bare repositories are not supported.')
}

async function showToplevel(folder: string, run: GitRun): Promise<string> {
  const result = await run(['rev-parse', '--show-toplevel'], { cwd: folder, okCodes: FATAL_OK_CODES })
  const top = result.stdout.trim()
  if (result.code !== 0 || top === '') throw new Error(`Not a git repository: ${folder}`)
  return top
}

async function absoluteGitDir(folder: string, flag: string, run: GitRun): Promise<string> {
  const result = await run(['rev-parse', '--path-format=absolute', flag], { cwd: folder })
  return path.resolve(result.stdout.trim())
}

/** A linked worktree has its own git dir (.git/worktrees/<name>) that differs from the common dir. */
async function assertMainWorktree(folder: string, run: GitRun): Promise<void> {
  const gitDir = await absoluteGitDir(folder, '--git-dir', run)
  const commonDir = await absoluteGitDir(folder, '--git-common-dir', run)
  if (!samePath(gitDir, commonDir)) {
    throw new Error('This folder is a git worktree. Add its main repository instead.')
  }
}

/**
 * Top-level folder of the repository that `folder` belongs to (any subfolder works).
 * Rejects missing folders, plain folders, bare repositories and linked worktrees.
 */
export async function resolveRepoRoot(folder: string, run: GitRun = runGit): Promise<string> {
  if (!(await isDirectory(folder))) throw new Error(`Folder not found: ${folder}`)
  await assertNotBare(folder, run)
  const top = await showToplevel(folder, run)
  await assertMainWorktree(folder, run)
  return normalisePath(top)
}

/** Local branches (sorted) and the branch checked out in the repository (null when HEAD is detached). */
export async function listBranches(repoPath: string, run: GitRun = runGit): Promise<RepoBranches> {
  const refs = await run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: repoPath })
  const branches = refs.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort()
  const head = await run(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: repoPath, okCodes: [0, 1] })
  const headName = head.stdout.trim()
  const current = head.code === 0 && headName !== '' ? headName : null
  return { current, branches }
}

/** True when refs/heads/<branch> exists. */
export async function branchExists(repoPath: string, branch: string, run: GitRun = runGit): Promise<boolean> {
  const result = await run(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repoPath,
    okCodes: [0, 1]
  })
  return result.code === 0
}

/** Full 40-character commit sha of `ref`. Rejects unknown revisions (and refs that look like options). */
export async function resolveCommit(cwd: string, ref: string, run: GitRun = runGit): Promise<string> {
  const unknown = new Error(`Unknown revision: ${ref}`)
  if (ref.startsWith('-')) throw unknown
  const result = await run(['rev-parse', '--verify', `${ref}^{commit}`], { cwd, okCodes: FATAL_OK_CODES })
  const sha = result.stdout.trim()
  if (result.code !== 0 || !SHA_PATTERN.test(sha)) throw unknown
  return sha
}
