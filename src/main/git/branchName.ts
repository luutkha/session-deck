// Pure helpers that turn a user-typed worktree name into a safe git branch name and folder name.
import { WORKTREE_NAME_MAX } from '../../shared/types'

const BRANCH_MAX_LENGTH = 60
const DEFAULT_REPO_FOLDER = 'repo'
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const UNSAFE_RUN = /[^a-z0-9._/-]+/g
const DOT_RUN = /\.{2,}/g
const DASH_RUN = /-+/g
const SLASH_RUN = /\/+/g
const EDGE_JUNK = /^[-.]+|[-.]+$/g
const LOCK_SUFFIX = /\.lock$/
const TRAILING_SEPARATORS = /[-./]+$/

/** Trims the name and checks its length and characters. Returns the trimmed name. */
export function validateWorktreeName(raw: unknown): string {
  const failure = new Error(`Worktree name must be 1 to ${WORKTREE_NAME_MAX} characters`)
  if (typeof raw !== 'string') throw failure
  const name = raw.trim()
  if (name.length < 1 || name.length > WORKTREE_NAME_MAX || CONTROL_CHARS.test(name)) throw failure
  return name
}

/** One path segment of a branch name: no edge dashes or dots, no `.lock` suffix. */
function cleanSegment(segment: string): string {
  return segment.replace(EDGE_JUNK, '').replace(LOCK_SUFFIX, '').replace(EDGE_JUNK, '')
}

/**
 * Lowercases and reduces the input to [a-z0-9._/-] with clean segments ('/' separates segments).
 * Returns '' when nothing usable is left.
 */
function sanitise(input: string): string {
  const replaced = input.toLowerCase().replace(UNSAFE_RUN, '-')
  const joined = replaced.replace(DOT_RUN, '.').replace(DASH_RUN, '-').replace(SLASH_RUN, '/')
  return joined
    .split('/')
    .map(cleanSegment)
    .filter((segment) => segment.length > 0)
    .join('/')
}

/** Git branch name for a worktree name: safe characters only, at most 60 characters. Throws when nothing is left. */
export function branchNameFor(name: string): string {
  const cleaned = sanitise(name).slice(0, BRANCH_MAX_LENGTH).replace(TRAILING_SEPARATORS, '')
  if (cleaned.length === 0) throw new Error('Name must contain a letter or digit')
  return cleaned
}

/** Worktree folder name for a branch: '/' becomes '-'. */
export function folderNameFor(branch: string): string {
  return branch.replace(/\//g, '-')
}

/** Folder name for a repository inside the worktrees root. '' or unusable names fall back to "repo". */
export function repoFolderName(repoName: string): string {
  const cleaned = sanitise(repoName.replace(SLASH_RUN, '-'))
  return cleaned.length > 0 ? cleaned : DEFAULT_REPO_FOLDER
}
