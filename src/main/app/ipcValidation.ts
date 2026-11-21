import { WORKTREE_NAME_MAX } from '../../shared/types'
import type { AgentKind, ChecklistItem, QueuedPrompt, SessionPreset, CreateSessionInput, CreateWorktreeInput, Group, Id, OpencodePermissions, StatusDef, GpuPref } from '../../shared/types'
import { buildLaunch } from '../pty/launch'
import { MAX_NOTES_LENGTH, validateChecklist, validatePreset, validateQueue } from '../store'
import { MAX_OPENCODE_MODEL_LENGTH, OPENCODE_MODEL_RE } from '../opencode/values'
import { isGpuPref } from './gpuMode'
import { errorMessage } from '../../shared/guards'

const MAX_STRING_LENGTH = 256
const MAX_INT = 2_147_483_647
export const MAX_PTY_WRITE_CHARS = 1_000_000
export const MAX_TERMINAL_DIMENSION = 10_000
export const MAX_PATH_LENGTH = 4096
const MAX_LIST_LENGTH = 10_000
export const MAX_STATUS_ORDER = 200
const MAX_CLAUDE_ARGS = 100

export function isId(value: unknown): value is Id {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_LENGTH
}

export function isNonEmptyString(value: unknown, maxLength = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

export function isFiniteInt(
  value: unknown,
  min = -MAX_INT,
  max = MAX_INT
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max
}

export function assertId(value: unknown, field: string): Id {
  if (!isId(value)) {
    throw new Error(`Invalid ${field}: must be a non-empty string up to ${MAX_STRING_LENGTH} characters`)
  }
  return value
}

export function assertNonEmptyString(value: unknown, field: string, maxLength = MAX_STRING_LENGTH): string {
  if (!isNonEmptyString(value, maxLength)) {
    throw new Error(`Invalid ${field}: must be a non-empty string up to ${maxLength} characters`)
  }
  return value
}

export function assertFiniteInt(value: unknown, field: string, min = -MAX_INT, max = MAX_INT): number {
  if (!isFiniteInt(value, min, max)) {
    throw new Error(`Invalid ${field}: must be an integer between ${min} and ${max}`)
  }
  return value
}

/** Pty write payload: a string, at most MAX_PTY_WRITE_CHARS long (empty is allowed). */
export function assertPtyWriteData(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid pty data: must be a string')
  }
  if (value.length > MAX_PTY_WRITE_CHARS) {
    throw new Error(`Invalid pty data: must be at most ${MAX_PTY_WRITE_CHARS} characters`)
  }
  return value
}

/** Terminal columns or rows: an integer from 1 to MAX_TERMINAL_DIMENSION. */
export function assertDimension(value: unknown, field: string): number {
  return assertFiniteInt(value, field, 1, MAX_TERMINAL_DIMENSION)
}

export function assertNullableId(value: unknown, field: string): Id | null {
  return value === null ? null : assertId(value, field)
}

export function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${field}: must be a boolean`)
  }
  return value
}

/** List position: an integer from 0 to MAX_INT. */
export function assertIndex(value: unknown, field: string): number {
  return assertFiniteInt(value, field, 0, MAX_INT)
}

export function assertIdList(value: unknown, field: string, maxLength = MAX_LIST_LENGTH): readonly Id[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${field}: must be an array of ids`)
  }
  if (value.length > maxLength) {
    throw new Error(`Invalid ${field}: must have at most ${maxLength} entries`)
  }
  return value.map((item, index) => assertId(item, `${field}[${index}]`))
}

/** Status reorder payload: an array of at most MAX_STATUS_ORDER non-empty string ids. */
export function assertStatusOrder(value: unknown, field: string): readonly Id[] {
  return assertIdList(value, field, MAX_STATUS_ORDER)
}

/**
 * Rejects claude arguments the pty launcher would refuse ("Unsafe claude argument"). The rule itself lives in
 * pty/launch.ts; buildLaunch applies it, so it is reused here instead of being copied.
 */
export function assertSafeClaudeArgs(args: readonly string[]): readonly string[] {
  if (args.length > MAX_CLAUDE_ARGS) {
    throw new Error(`Invalid createSession input: claudeArgs must have at most ${MAX_CLAUDE_ARGS} entries`)
  }
  try {
    buildLaunch('linux', args)
  } catch (error) {
    const reason = errorMessage(error)
    throw new Error(`Invalid createSession input: ${reason}`)
  }
  return args
}

const ALLOWED_CREATE_SESSION_KEYS = new Set<keyof CreateSessionInput>([
  'cwd',
  'name',
  'groupId',
  'statusId',
  'claudeArgs',
  'agent',
  'model',
  'opencodePermissions',
  'worktreeId'
])

export function asCreateSessionInput(raw: unknown): CreateSessionInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid createSession input: must be an object')
  }
  const obj = raw as Record<string, unknown>

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_CREATE_SESSION_KEYS.has(key as keyof CreateSessionInput)) {
      throw new Error(`Invalid createSession input: unknown key "${key}"`)
    }
  }

  const cwd = assertNonEmptyString(obj.cwd, 'cwd', MAX_PATH_LENGTH)
  const name = obj.name !== undefined ? assertNonEmptyString(obj.name, 'name') : undefined
  const groupId = obj.groupId !== undefined && obj.groupId !== null ? assertId(obj.groupId, 'groupId') : null
  const statusId = obj.statusId !== undefined && obj.statusId !== null ? assertId(obj.statusId, 'statusId') : null
  const claudeArgs = obj.claudeArgs !== undefined ? assertClaudeArgs(obj.claudeArgs) : undefined
  const agent = obj.agent !== undefined ? assertAgentKind(obj.agent, 'createSession input') : undefined
  // The model only applies to OpenCode sessions; for claude and shell sessions it is ignored.
  const model =
    agent === 'opencode' && obj.model !== undefined ? assertOpencodeModel(obj.model, 'createSession input') : undefined
  const opencodePermissions =
    agent === 'opencode' && obj.opencodePermissions !== undefined
      ? assertOpencodePermissions(obj.opencodePermissions, 'createSession input')
      : undefined
  const worktreeId = obj.worktreeId !== undefined ? assertId(obj.worktreeId, 'worktreeId') : undefined

  return {
    cwd,
    name,
    groupId,
    statusId,
    claudeArgs,
    ...(agent !== undefined ? { agent } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(opencodePermissions !== undefined ? { opencodePermissions } : {}),
    ...(worktreeId !== undefined ? { worktreeId } : {})
  }
}

const ALLOWED_CREATE_WORKTREE_KEYS: ReadonlySet<string> = new Set<string>([
  'repoId',
  'name',
  'baseBranch',
  'source',
  'branch',
  'agent',
  'model'
])
const MAX_BASE_BRANCH_LENGTH = 255
/** Refs git would not accept as a plain branch name here: whitespace, control characters, ~ ^ : ? * [ \, and ".." */
const BASE_BRANCH_FORBIDDEN_RE = /[\s\u0000-\u001f\u007f~^:?*[\\]|\.\./

function assertBaseBranch(raw: unknown): string {
  const invalid =
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_BASE_BRANCH_LENGTH ||
    raw.startsWith('-') ||
    BASE_BRANCH_FORBIDDEN_RE.test(raw)
  if (invalid) {
    throw new Error('Invalid base branch')
  }
  return raw
}

function assertWorktreeName(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed.length === 0 || trimmed.length > WORKTREE_NAME_MAX) {
    throw new Error(`Invalid createWorktree input: name must be 1 to ${WORKTREE_NAME_MAX} characters`)
  }
  return trimmed
}

/** IPC payload check for worktree:create. The branch and folder are derived in main from the name (see git/*). */
export function asCreateWorktreeInput(raw: unknown): CreateWorktreeInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid createWorktree input: must be an object')
  }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_CREATE_WORKTREE_KEYS.has(key)) {
      throw new Error(`Invalid createWorktree input: unknown key "${key}"`)
    }
  }

  const repoId = assertId(obj.repoId, 'repoId')
  const name = assertWorktreeName(obj.name)
  const baseBranch = assertBaseBranch(obj.baseBranch)
  const source = obj.source === undefined ? 'new' : obj.source
  if (source !== 'new' && source !== 'existing' && source !== 'main') {
    throw new Error('Invalid createWorktree input: source must be "new", "existing" or "main"')
  }
  // D57: an existing branch has the same rules as a base branch (a plain local branch name).
  const branch = source === 'existing' ? assertBaseBranch(obj.branch) : undefined
  const agent = assertAgentKind(obj.agent, 'createWorktree input')
  // The model only applies to OpenCode; for other agents it is dropped.
  const model =
    agent === 'opencode' && obj.model !== undefined ? assertOpencodeModel(obj.model, 'createWorktree input') : undefined

  return {
    repoId,
    name,
    baseBranch,
    ...(source !== 'new' ? { source } : {}),
    ...(branch !== undefined ? { branch } : {}),
    agent,
    ...(model !== undefined && model.length > 0 ? { model } : {})
  }
}

function assertAgentKind(raw: unknown, context: string): AgentKind {
  if (raw !== 'claude' && raw !== 'opencode' && raw !== 'shell') {
    throw new Error(`Invalid ${context}: agent must be "claude", "opencode" or "shell"`)
  }
  return raw
}

function assertOpencodeModel(raw: unknown, context: string): string {
  if (typeof raw !== 'string') {
    throw new Error(`Invalid ${context}: model must be a string of at most ${MAX_OPENCODE_MODEL_LENGTH} characters`)
  }
  const trimmed = raw.trim()
  if (trimmed.length > MAX_OPENCODE_MODEL_LENGTH) {
    throw new Error(`Invalid ${context}: model must be at most ${MAX_OPENCODE_MODEL_LENGTH} characters`)
  }
  if (trimmed.length > 0 && !OPENCODE_MODEL_RE.test(trimmed)) {
    throw new Error(`Invalid ${context}: model may only contain letters, digits and . _ : / @ + -`)
  }
  return trimmed
}

/** D79: the OpenCode permission policy, 'yolo' or 'ask'. */
function assertOpencodePermissions(raw: unknown, context: string): OpencodePermissions {
  if (raw !== 'yolo' && raw !== 'ask') {
    throw new Error(`Invalid ${context}: opencodePermissions must be "yolo" or "ask"`)
  }
  return raw
}

function assertClaudeArgs(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid createSession input: claudeArgs must be an array')
  }
  for (const arg of raw) {
    if (typeof arg !== 'string') {
      throw new Error('Invalid createSession input: claudeArgs must contain only strings')
    }
  }
  return assertSafeClaudeArgs(raw as readonly string[])
}

/** Session notes payload: a string of at most MAX_NOTES_LENGTH characters (empty clears them). */
export function asNotes(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error(`Invalid notes: must be a string of at most ${MAX_NOTES_LENGTH} characters`)
  }
  if (raw.length > MAX_NOTES_LENGTH) {
    throw new Error(`Invalid notes: must be at most ${MAX_NOTES_LENGTH} characters`)
  }
  return raw
}

/** Checklist payload: validated by the same rules as the store (count, unique ids, text length). */
export function asChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid checklist: must be an array of items')
  }
  return validateChecklist(raw)
}

export function assertGroup(raw: unknown): Group {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid group: must be an object')
  }
  const obj = raw as Record<string, unknown>
  return {
    id: assertId(obj.id, 'group.id'),
    name: assertNonEmptyString(obj.name, 'group.name'),
    collapsed: typeof obj.collapsed === 'boolean' ? obj.collapsed : false
  }
}

export function assertStatusDef(raw: unknown): StatusDef {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid status: must be an object')
  }
  const obj = raw as Record<string, unknown>
  return {
    id: assertId(obj.id, 'status.id'),
    name: assertNonEmptyString(obj.name, 'status.name'),
    color: assertNonEmptyString(obj.color, 'status.color')
  }
}
/** Prompt queue payload (D47): validated by the same rules as the store (count, unique ids, text length). */
export function asQueue(raw: unknown): QueuedPrompt[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid queue: must be an array of prompts')
  }
  return validateQueue(raw)
}

/** Preset payload (D49): the store's shape rules, the Claude argument safety rule and the OpenCode model rule. */
export function asPreset(raw: unknown): SessionPreset {
  const preset = validatePreset(raw)
  assertSafeClaudeArgs(preset.claudeArgs)
  if (preset.model !== undefined) assertOpencodeModel(preset.model, 'preset')
  return preset
}

/** GPU preference payload (no-GPU support): exactly one of 'auto' | 'on' | 'off'. */
export function asGpuPref(raw: unknown): GpuPref {
  if (!isGpuPref(raw)) {
    throw new Error('Invalid GPU preference: must be "auto", "on" or "off"')
  }
  return raw
}
