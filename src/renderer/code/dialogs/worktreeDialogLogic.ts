// Pure rules for the Code mode dialogs (name checks, base branch default, path hint, agent and model). No React.
import { WORKTREE_NAME_MAX, type AgentKind, type CreateSessionInput, type Id, type Worktree } from '../../../shared/types'
import { validateCursorModel, validateOpenCodeModel } from '../../Sidebar/dialogLogic'

/** Session names follow the Ops rule (validateName in Sidebar/inlineEditValidation). */
export const SESSION_NAME_MAX = 100
const DEFAULT_WORKTREES_ROOT_HINT = '~/SessionDeck/worktrees'
const PATH_SEPARATOR = '\\'
const TRAILING_SEPARATORS = /[\\/]+$/
const NAME_PLACEHOLDER = '<name>'
/** Base branches tried, in order, after the repo's current branch. */
const PREFERRED_BASE_BRANCHES: readonly string[] = ['main', 'master']

export interface AgentChoice {
  readonly value: AgentKind
  readonly label: string
}

export const AGENT_CHOICES: readonly AgentChoice[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'shell', label: 'Shell' }
]

export type TextCheck = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string }

/** Worktree name: required, trimmed, at most WORKTREE_NAME_MAX characters. */
export function validateWorktreeName(raw: string): TextCheck {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'Name required' }
  }
  if (trimmed.length > WORKTREE_NAME_MAX) {
    return { ok: false, error: `Name is too long (max ${String(WORKTREE_NAME_MAX)} characters)` }
  }
  return { ok: true, value: trimmed }
}

/** Session name: optional. Empty = undefined (the agent names it). */
export function validateSessionName(raw: string): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: true, value: undefined }
  }
  if (trimmed.length > SESSION_NAME_MAX) {
    return { ok: false, error: `Name is too long (max ${String(SESSION_NAME_MAX)} characters)` }
  }
  return { ok: true, value: trimmed }
}

/**
 * Base branch a new worktree starts from: the repo's current branch when it is a local branch, else 'main',
 * else 'master', else the first branch. null when the repo has no branches.
 */
export function pickBaseBranch(current: string | null, branches: readonly string[]): string | null {
  if (current !== null && branches.includes(current)) {
    return current
  }
  for (const preferred of PREFERRED_BASE_BRANCHES) {
    if (branches.includes(preferred)) return preferred
  }
  return branches[0] ?? null
}

/** Indicative folder for the new worktree: <worktreesRoot or default>\<repo>\<name>. */
export function worktreePathHint(worktreesRoot: string, repoName: string, name: string): string {
  const root = worktreesRoot.trim().replace(TRAILING_SEPARATORS, '')
  const base = root.length > 0 ? root : DEFAULT_WORKTREES_ROOT_HINT
  const folder = name.trim().length > 0 ? name.trim() : NAME_PLACEHOLDER
  return [base, repoName, folder].join(PATH_SEPARATOR)
}

/** Placeholder for the optional session name, per agent. */
export function sessionNamePlaceholder(agent: AgentKind): string {
  const choice = AGENT_CHOICES.find((candidate): boolean => candidate.value === agent)
  return choice?.label ?? 'Session'
}

/**
 * The createSession input for a session in an existing worktree: it always runs inside the worktree folder
 * (main ignores `cwd` anyway) and is bound to the worktree. `model` is the checked value from checkModel,
 * undefined for anything but OpenCode and Cursor.
 */
export function worktreeSessionInput(
  worktree: Pick<Worktree, 'id' | 'path'>,
  agent: AgentKind,
  model?: string,
  /** D92: an extra agent CLI (registry id); the session is a terminal running it. */
  cliAgent?: string
): CreateSessionInput {
  return {
    cwd: worktree.path,
    worktreeId: worktree.id,
    agent: cliAgent !== undefined ? 'shell' : agent,
    ...(cliAgent !== undefined ? { cliAgent } : {}),
    ...(model !== undefined ? { model } : {})
  }
}

export type ModelCheck =
  | { readonly ok: true; readonly model: string | undefined }
  | { readonly ok: false; readonly error: string }

/**
 * The model to send. Only OpenCode and Cursor take one; an empty model means the agent's own default
 * (undefined). Claude and Shell never send a model.
 */
export function checkModel(agent: AgentKind, modelRaw: string): ModelCheck {
  if (agent !== 'opencode' && agent !== 'cursor') {
    return { ok: true, model: undefined }
  }
  const result = agent === 'cursor' ? validateCursorModel(modelRaw) : validateOpenCodeModel(modelRaw)
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  return { ok: true, model: result.value.length > 0 ? result.value : undefined }
}

// ---- D57: where the workspace comes from (new branch, existing branch, the repo's own folder)

export interface BranchChoice {
  readonly branch: string
  /** The folder where the branch is already checked out; null = free to open. Git allows one worktree per branch. */
  readonly openIn: string | null
}

/** Every local branch, with where it is already open (a busy branch cannot be opened in a new worktree). */
export function existingBranchChoices(
  branches: readonly string[],
  checkedOut: readonly { readonly branch: string; readonly path: string }[] | undefined
): readonly BranchChoice[] {
  return branches.map((branch) => ({ branch, openIn: checkedOut?.find((c) => c.branch === branch)?.path ?? null }))
}

/** The first branch that is free to open, or null. */
export function firstFreeBranch(choices: readonly BranchChoice[]): string | null {
  return choices.find((c) => c.openIn === null)?.branch ?? null
}

/** The SessionDeck workspace that already shows the repo's own folder, if any. */
export function openRepoFolder(worktrees: readonly Worktree[], repoId: Id | null): Worktree | null {
  return worktrees.find((w) => w.repoId === repoId && w.main === true) ?? null
}

/** Base to compare an existing branch with: the default base, unless that is the branch itself. */
export function compareBaseFor(branch: string | null, defaultBase: string | null, branches: readonly string[]): string | null {
  if (defaultBase !== null && defaultBase !== branch) return defaultBase
  return branches.find((b) => b !== branch) ?? defaultBase
}
