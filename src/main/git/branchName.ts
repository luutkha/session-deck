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

// Windows refuses these names as a file or folder, with or without an extension ("con", "aux.v1", "com1"). Git stores
// each branch segment as a file under .git/refs/heads, so a branch "con" fails too ("cannot lock ref ... con.lock").
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i
const RESERVED_SUFFIX = '-wt'

/**
 * Git branch name for a worktree name: safe characters only, at most 60 characters (63 when the last segment is a
 * Windows reserved name and gets its suffix). Throws when nothing is left.
 */
export function branchNameFor(name: string): string {
  const cleaned = sanitise(name).slice(0, BRANCH_MAX_LENGTH).replace(TRAILING_SEPARATORS, '')
  if (cleaned.length === 0) throw new Error('Name must contain a letter or digit')
  return cleaned.split('/').map(safeFolderName).join('/')
}

/** A file or folder name Windows accepts: a reserved base name gets RESERVED_SUFFIX before its first dot. Same on every OS. */
function safeFolderName(name: string): string {
  if (!WINDOWS_RESERVED.test(name)) return name
  const dot = name.indexOf('.')
  return dot < 0 ? `${name}${RESERVED_SUFFIX}` : `${name.slice(0, dot)}${RESERVED_SUFFIX}${name.slice(dot)}`
}

/** Worktree folder name for a branch: '/' becomes '-'; Windows reserved names are made safe. */
export function folderNameFor(branch: string): string {
  return safeFolderName(branch.replace(/\//g, '-'))
}

/** Folder name for a repository inside the worktrees root. '' or unusable names fall back to "repo". */
export function repoFolderName(repoName: string): string {
  const cleaned = sanitise(repoName.replace(SLASH_RUN, '-'))
  return cleaned.length > 0 ? safeFolderName(cleaned) : DEFAULT_REPO_FOLDER
}
