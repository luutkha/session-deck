// Creates a linked git worktree in <root>/<repo folder>/<branch folder>, on a new branch (D31) or on an existing
// local branch (D57). Like Orca, a taken name never fails: the branch and the folder get -2, -3 ... together.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { WORKTREE_NAME_MAX } from '../../shared/types'
import { branchNameFor, folderNameFor, repoFolderName, validateWorktreeName } from './branchName'
import { pathTaken } from './fsCheck'
import { type GitRun, runGit } from './gitRunner'
import { branchExists, listCheckedOutBranches, resolveCommit } from './repoInfo'

const SESSION_DECK_DIR = 'SessionDeck'
const WORKTREES_DIR = 'worktrees'
const FIRST_FREE_SUFFIX = 2
const LAST_FREE_SUFFIX = 99

export function defaultWorktreesRoot(home: string): string {
  return path.join(home, SESSION_DECK_DIR, WORKTREES_DIR)
}

export interface CreateGitWorktreeInput {
  readonly repoPath: string
  readonly repoName: string
  readonly root: string
  readonly name: string
  /** The new branch starts from it (new branch), and changes are shown against it (both kinds). */
  readonly baseBranch: string
  /** D57: check out this existing local branch instead of creating one. */
  readonly existingBranch?: string
}

export interface CreatedGitWorktree {
  /** The worktree name finally used (with -2, -3 ... when the name was taken). */
  readonly name: string
  readonly branch: string
  readonly path: string
  /** Commit of the base branch when the worktree was created. */
  readonly baseCommit: string
}

/** The name for attempt `suffix` (1 = as typed), cut so the suffix still fits WORKTREE_NAME_MAX. */
export function nameCandidate(name: string, suffix: number): string {
  if (suffix === 1) return name
  const tail = `-${String(suffix)}`
  return `${name.slice(0, WORKTREE_NAME_MAX - tail.length)}${tail}`
}

/** Explains why a branch cannot be opened in a new worktree, or null when it can. */
async function busyReason(repoPath: string, branch: string, run: GitRun): Promise<string | null> {
  const open = (await listCheckedOutBranches(repoPath, run)).find((entry) => entry.branch === branch)
  if (open === undefined) return null
  return `Branch "${branch}" is already open in ${open.path}. Git allows a branch in one worktree only: open that workspace instead, or pick another branch.`
}

/**
 * Creates the worktree. A new branch is named after the worktree; when that branch or its folder exists, the name
 * gets -2, -3 ... (up to -99) until both are free. An existing branch is checked out as it is (refused when it is
 * open in another worktree); only its folder gets a suffix. A git failure is rethrown.
 */
export async function createGitWorktree(
  input: CreateGitWorktreeInput,
  run: GitRun = runGit
): Promise<CreatedGitWorktree> {
  const name = validateWorktreeName(input.name)
  if (!(await branchExists(input.repoPath, input.baseBranch, run))) throw new Error(`Base branch not found: ${input.baseBranch}`)
  const parent = path.join(path.resolve(input.root), repoFolderName(input.repoName))
  const existing = input.existingBranch

  if (existing !== undefined) {
    if (!(await branchExists(input.repoPath, existing, run))) throw new Error(`Branch not found: ${existing}`)
    const busy = await busyReason(input.repoPath, existing, run)
    if (busy !== null) throw new Error(busy)
  }

  // One git call for every local branch: the suffix search below may try up to 99 names.
  const refs = await run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: input.repoPath })
  const taken = new Set(refs.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0))
  let chosen: { name: string; branch: string; dir: string } | null = null
  for (let suffix = 1; suffix <= LAST_FREE_SUFFIX && chosen === null; suffix = suffix === 1 ? FIRST_FREE_SUFFIX : suffix + 1) {
    const candidate = nameCandidate(name, suffix)
    const branch = existing ?? branchNameFor(candidate)
    if (existing === undefined && taken.has(branch)) continue
    const dir = path.join(parent, folderNameFor(branchNameFor(candidate)))
    if (await pathTaken(dir)) continue
    chosen = { name: candidate, branch, dir }
  }
  if (chosen === null) throw new Error(`No free name for this worktree: "${name}" up to "${nameCandidate(name, LAST_FREE_SUFFIX)}" are taken.`)

  await mkdir(parent, { recursive: true })
  const args = existing !== undefined
    ? ['worktree', 'add', chosen.dir, existing]
    : ['worktree', 'add', '-b', chosen.branch, chosen.dir, input.baseBranch]
  await run(args, { cwd: input.repoPath })

  const baseCommit = await resolveCommit(input.repoPath, input.baseBranch, run)
  return { name: chosen.name, branch: chosen.branch, path: chosen.dir, baseCommit }
}
