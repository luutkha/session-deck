import type { AgentKind, CreateSessionInput, Id, Session } from '../../shared/types'
import { validateName } from './inlineEditValidation'

/** One CLI token for `claude <args>`: letters, digits and a fixed set of punctuation. */
const ARG_TOKEN_PATTERN = /^[A-Za-z0-9_@=:,.\/\\-]+$/

/** An OpenCode "provider/model" token: letters, digits and . _ : / @ + -. Empty = OpenCode's own default. */
const OPENCODE_MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]+$/
export const MAX_OPENCODE_MODEL_LENGTH = 200

/** A plain Cursor model name (e.g. gpt-5): letters, digits and . _ : / @ -. Empty = Cursor's own default. */
const CURSOR_MODEL_PATTERN = /^[A-Za-z0-9._:/@-]+$/
export const MAX_CURSOR_MODEL_LENGTH = 100
const WHITESPACE_PATTERN = /\s+/
export const REMOTE_CONTROL_FLAG = '--remote-control'
const FALLBACK_NAME = 'session'
const TRAILING_SEPARATORS_PATTERN = /[\\/]+$/
const PATH_SEPARATOR_PATTERN = /[\\/]/
const DRIVE_ROOT_PATTERN = /^[A-Za-z]:$/
const COLOR_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

export interface ParseClaudeArgsOk {
  readonly ok: true
  readonly args: string[]
}

export interface ParseClaudeArgsError {
  readonly ok: false
  readonly error: string
}

export type ParseClaudeArgsResult = ParseClaudeArgsOk | ParseClaudeArgsError

export function parseClaudeArgs(raw: string): ParseClaudeArgsResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: true, args: [] }
  }
  const args = trimmed.split(WHITESPACE_PATTERN)
  for (const arg of args) {
    if (!ARG_TOKEN_PATTERN.test(arg)) {
      return { ok: false, error: `Unsupported characters in argument: ${arg}` }
    }
  }
  return { ok: true, args }
}

export type ValidateOpenCodeModelResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string }

/**
 * Validates an OpenCode model string ("provider/model"). Letters, digits and
 * `. _ : / @ + -` only, at most 200 chars after trimming. An empty string is
 * valid: OpenCode then uses its own default model. Returns the trimmed value.
 */
export function validateOpenCodeModel(raw: string): ValidateOpenCodeModelResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: true, value: '' }
  }
  if (trimmed.length > MAX_OPENCODE_MODEL_LENGTH) {
    return { ok: false, error: `Model is too long (max ${MAX_OPENCODE_MODEL_LENGTH} characters)` }
  }
  if (!OPENCODE_MODEL_PATTERN.test(trimmed)) {
    return { ok: false, error: 'Model may only contain letters, digits and . _ : / @ + -' }
  }
  return { ok: true, value: trimmed }
}

export type ValidateCursorModelResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string }

/**
 * Validates a plain Cursor model name ("gpt-5", "sonnet-4-thinking"). Letters, digits and
 * `. _ : / @ -` only, at most 100 chars after trimming. An empty string is valid: Cursor then
 * uses its own default model. Returns the trimmed value.
 */
export function validateCursorModel(raw: string): ValidateCursorModelResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: true, value: '' }
  }
  if (trimmed.length > MAX_CURSOR_MODEL_LENGTH) {
    return { ok: false, error: `Model is too long (max ${MAX_CURSOR_MODEL_LENGTH} characters)` }
  }
  if (!CURSOR_MODEL_PATTERN.test(trimmed)) {
    return { ok: false, error: 'Model may only contain letters, digits and . _ : / @ -' }
  }
  return { ok: true, value: trimmed }
}

/** The model field's opening value: OpenCode keeps its saved default; Cursor starts empty (its own default). */
export function initialModelForAgent(agent: AgentKind | undefined, opencodeModel: string): string {
  return agent === 'cursor' ? '' : opencodeModel
}

/**
 * The model field after switching agent: never carry an OpenCode model into Cursor (Cursor starts empty),
 * and restore the OpenCode default when leaving Cursor. Every other switch keeps the typed text.
 */
export function modelAfterAgentChange(
  previous: AgentKind,
  next: AgentKind,
  current: string,
  opencodeModel: string
): string {
  if (next === 'cursor') return ''
  if (previous === 'cursor') return opencodeModel
  return current
}

/** Display name derived from a folder path: the last segment, handling `\` and `/`. */
export function defaultNameFromFolder(path: string): string {
  const withoutTrailing = path.replace(TRAILING_SEPARATORS_PATTERN, '')
  if (withoutTrailing.length === 0 || DRIVE_ROOT_PATTERN.test(withoutTrailing)) {
    return FALLBACK_NAME
  }
  const segments = withoutTrailing.split(PATH_SEPARATOR_PATTERN)
  const last = segments[segments.length - 1].trim()
  return last.length > 0 ? last : FALLBACK_NAME
}

export interface CreateSessionForm {
  readonly folder: string
  readonly name: string
  readonly groupId: Id | null
  readonly statusId: Id | null
  readonly argsRaw: string
  /** Which agent to start; absent = 'claude'. */
  readonly agent?: AgentKind
  /** OpenCode or Cursor model text; only read when agent is 'opencode' or 'cursor'. */
  readonly modelRaw?: string
  /** OpenCode only (D79): ask before running tools (use the user's own OpenCode permission rules); off = yolo. */
  readonly openCodeAskPermissions?: boolean
  /** Claude only: start with Remote Control so claude.ai/code and the phone app can drive the session. */
  readonly remoteControl?: boolean
}

export type BuildCreateInputResult =
  | { readonly ok: true; readonly input: CreateSessionInput }
  | { readonly ok: false; readonly error: string }

export function buildCreateInput(form: CreateSessionForm): BuildCreateInputResult {
  const folder = form.folder.trim()
  if (folder.length === 0) {
    return { ok: false, error: 'Folder required' }
  }

  let name: string | undefined
  if (form.name.trim().length > 0) {
    const nameResult = validateName(form.name)
    if (!nameResult.ok) {
      return { ok: false, error: nameResult.error }
    }
    name = nameResult.value
  }

  const agent: AgentKind = form.agent ?? 'claude'
  const shared = {
    cwd: folder,
    ...(name !== undefined ? { name } : {}),
    groupId: form.groupId,
    statusId: form.statusId
  }

  if (agent === 'opencode') {
    // OpenCode takes no Claude args; an empty model means OpenCode's own default.
    const modelResult = validateOpenCodeModel(form.modelRaw ?? '')
    if (!modelResult.ok) {
      return { ok: false, error: modelResult.error }
    }
    return {
      ok: true,
      input: {
        ...shared,
        agent,
        ...(modelResult.value.length > 0 ? { model: modelResult.value } : {}),
        // Yolo stays the default (D10); the checkbox opts into the user's own OpenCode rules.
        ...(form.openCodeAskPermissions === true ? { opencodePermissions: 'ask' as const } : {})
      }
    }
  }

  if (agent === 'cursor') {
    // Cursor takes no Claude args; an empty model means Cursor's own default.
    const modelResult = validateCursorModel(form.modelRaw ?? '')
    if (!modelResult.ok) {
      return { ok: false, error: modelResult.error }
    }
    return {
      ok: true,
      input: {
        ...shared,
        agent,
        ...(modelResult.value.length > 0 ? { model: modelResult.value } : {})
      }
    }
  }

  const argsResult = parseClaudeArgs(form.argsRaw)
  if (!argsResult.ok) {
    return { ok: false, error: argsResult.error }
  }

  // Last on purpose: --remote-control takes an optional name and would swallow a following value.
  const claudeArgs =
    form.remoteControl === true && !argsResult.args.includes(REMOTE_CONTROL_FLAG)
      ? [...argsResult.args, REMOTE_CONTROL_FLAG]
      : argsResult.args

  return {
    ok: true,
    input: {
      ...shared,
      claudeArgs,
      agent
    }
  }
}

export interface StatusDraft {
  readonly name: string
  readonly color: string
}

export type ValidateStatusDraftResult = { readonly ok: true } | { readonly ok: false; readonly error: string }

export function validateStatusDraft(draft: StatusDraft): ValidateStatusDraftResult {
  const nameResult = validateName(draft.name)
  if (!nameResult.ok) {
    return { ok: false, error: nameResult.error }
  }
  if (!COLOR_HEX_PATTERN.test(draft.color)) {
    return { ok: false, error: `Invalid color: ${draft.color} (expected #rrggbb)` }
  }
  return { ok: true }
}

/**
 * The folder the New Session dialog opens with: the caller's folder (e.g. a workspace header) when given, otherwise
 * the folder of the most recently created session, otherwise empty (the very first session).
 */
export function initialFolder(
  requested: string | undefined,
  sessions: readonly Pick<Session, 'cwd' | 'createdAt'>[]
): string {
  if (requested !== undefined && requested.trim().length > 0) {
    return requested
  }
  let latest: Pick<Session, 'cwd' | 'createdAt'> | null = null
  for (const session of sessions) {
    if (session.cwd.trim().length === 0) continue
    if (latest === null || session.createdAt > latest.createdAt) latest = session
  }
  return latest?.cwd ?? ''
}
