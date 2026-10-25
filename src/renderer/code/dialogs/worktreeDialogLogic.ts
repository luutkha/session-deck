// Pure rules for the Code mode dialogs (name checks, base branch default, path hint, agent and model). No React.
import { WORKTREE_NAME_MAX, type AgentKind, type CreateSessionInput, type Worktree } from '../../../shared/types'
import { validateOpenCodeModel } from '../../Sidebar/dialogLogic'

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
 * undefined for anything but OpenCode.
 */
export function worktreeSessionInput(
  worktree: Pick<Worktree, 'id' | 'path'>,
  agent: AgentKind,
  model?: string
): CreateSessionInput {
  return {
    cwd: worktree.path,
    worktreeId: worktree.id,
    agent,
    ...(model !== undefined ? { model } : {})
  }
}

export type ModelCheck =
  | { readonly ok: true; readonly model: string | undefined }
  | { readonly ok: false; readonly error: string }

/**
 * The model to send. Only OpenCode takes one; an empty model means OpenCode's own default (undefined).
 * Claude and Shell never send a model.
 */
export function checkModel(agent: AgentKind, modelRaw: string): ModelCheck {
  if (agent !== 'opencode') {
    return { ok: true, model: undefined }
  }
  const result = validateOpenCodeModel(modelRaw)
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  return { ok: true, model: result.value.length > 0 ? result.value : undefined }
}
