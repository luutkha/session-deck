// Creates a linked git worktree on a new branch, in <root>/<repo folder>/<branch folder>.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { branchNameFor, folderNameFor, repoFolderName, validateWorktreeName } from './branchName'
import { pathTaken } from './fsCheck'
import { type GitRun, runGit } from './gitRunner'
import { branchExists, resolveCommit } from './repoInfo'

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
  readonly baseBranch: string
}

export interface CreatedGitWorktree {
  readonly branch: string
  readonly path: string
  readonly baseCommit: string
}

/** The first free folder: `<base>`, then `<base>-2` ... `<base>-99`. */
async function freeWorktreeDir(base: string): Promise<string> {
  if (!(await pathTaken(base))) return base
  for (let suffix = FIRST_FREE_SUFFIX; suffix <= LAST_FREE_SUFFIX; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!(await pathTaken(candidate))) return candidate
  }
  throw new Error('No free folder name for this worktree.')
}

async function assertBranchCanBeCreated(
  repoPath: string,
  baseBranch: string,
  branch: string,
  run: GitRun
): Promise<void> {
  if (!(await branchExists(repoPath, baseBranch, run))) throw new Error(`Base branch not found: ${baseBranch}`)
  if (await branchExists(repoPath, branch, run)) {
    throw new Error(`A branch named "${branch}" already exists in this repository.`)
  }
}

/**
 * Creates branch <name> from <baseBranch> and a worktree folder for it. Rejects before git is touched when the name
 * is invalid, the base is missing or the branch exists. A git failure (e.g. a branch/folder conflict) is rethrown.
 */
export async function createGitWorktree(
  input: CreateGitWorktreeInput,
  run: GitRun = runGit
): Promise<CreatedGitWorktree> {
  const name = validateWorktreeName(input.name)
  const branch = branchNameFor(name)
  await assertBranchCanBeCreated(input.repoPath, input.baseBranch, branch, run)

  const root = path.resolve(input.root)
  const parent = path.join(root, repoFolderName(input.repoName))
  const dir = await freeWorktreeDir(path.join(parent, folderNameFor(branch)))
  await mkdir(parent, { recursive: true })
  await run(['worktree', 'add', '-b', branch, dir, input.baseBranch], { cwd: input.repoPath })

  const baseCommit = await resolveCommit(dir, 'HEAD', run)
  return { branch, path: dir, baseCommit }
}
