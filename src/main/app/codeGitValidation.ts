// D60: validation of the commit / PR / remove-worktree payloads from the renderer and Jarvis. Unknown keys are refused.
import { CHANGES_MAX_FILES, type CommitInput, type PullRequestInput, type WorktreeRemoveOptions } from '../../shared/types'
import { assertId } from './ipcValidation'

const MESSAGE_MAX = 10_000
const PATH_MAX = 4096
const TITLE_MAX = 256
const BODY_MAX = 20_000

function asRecord(raw: unknown, what: string, allowed: readonly string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`Invalid ${what}: must be an object`)
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`Invalid ${what}: unknown key "${key}"`)
  }
  return obj
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${field}: must be text of at most ${max} characters`)
  return value
}

function optionalFlag(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`Invalid ${field}: must be true or false`)
  return value
}

export function asCommitInput(raw: unknown): CommitInput {
  const obj = asRecord(raw, 'commit input', ['worktreeId', 'message', 'paths'])
  const worktreeId = assertId(obj.worktreeId, 'worktreeId')
  if (typeof obj.message !== 'string' || obj.message.length > MESSAGE_MAX) throw new Error(`Invalid commit message: must be text of at most ${MESSAGE_MAX} characters`)
  if (!Array.isArray(obj.paths) || obj.paths.length === 0 || obj.paths.length > CHANGES_MAX_FILES) {
    throw new Error(`Invalid commit paths: must be a list of 1 to ${CHANGES_MAX_FILES} paths`)
  }
  const paths = obj.paths.map((p: unknown): string => {
    // A NUL would split the pathspec file; a path is never empty or absolute.
    if (typeof p !== 'string' || p.length === 0 || p.length > PATH_MAX || p.includes('\0')) throw new Error('Invalid commit path')
    return p
  })
  return { worktreeId, message: obj.message, paths: [...new Set(paths)] }
}

export function asPullRequestInput(raw: unknown): PullRequestInput {
  if (raw === undefined || raw === null) return {}
  const obj = asRecord(raw, 'pull request input', ['title', 'body'])
  const title = optionalText(obj.title, 'pull request title', TITLE_MAX)
  const body = optionalText(obj.body, 'pull request body', BODY_MAX)
  return { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) }
}

export function asWorktreeRemoveOptions(raw: unknown): WorktreeRemoveOptions {
  if (raw === undefined || raw === null) return {}
  const obj = asRecord(raw, 'remove options', ['deleteFromDisk', 'discardChanges', 'deleteUnmergedBranch'])
  const deleteFromDisk = optionalFlag(obj.deleteFromDisk, 'deleteFromDisk')
  const discardChanges = optionalFlag(obj.discardChanges, 'discardChanges')
  const deleteUnmergedBranch = optionalFlag(obj.deleteUnmergedBranch, 'deleteUnmergedBranch')
  return {
    ...(deleteFromDisk !== undefined ? { deleteFromDisk } : {}),
    ...(discardChanges !== undefined ? { discardChanges } : {}),
    ...(deleteUnmergedBranch !== undefined ? { deleteUnmergedBranch } : {})
  }
}
