// Stored Code mode data (D31): repos and worktrees. An invalid entry is dropped, never failing the whole file.
import type { Id, Repo, Worktree } from '../../shared/types'
import { pathKey } from './codeReducers'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseRepo(raw: unknown): Repo | undefined {
  if (!isRecord(raw)) return undefined
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !isNonEmptyString(raw.path)) return undefined
  if (!isFiniteNumber(raw.createdAt) || typeof raw.collapsed !== 'boolean') return undefined
  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    createdAt: raw.createdAt,
    collapsed: raw.collapsed
  }
}

function parseWorktree(raw: unknown): Worktree | undefined {
  if (!isRecord(raw)) return undefined
  const strings = [raw.id, raw.repoId, raw.name, raw.branch, raw.path, raw.baseBranch, raw.baseCommit]
  if (!strings.every(isNonEmptyString)) return undefined
  if (!isFiniteNumber(raw.createdAt) || typeof raw.collapsed !== 'boolean') return undefined
  return {
    id: raw.id as Id,
    repoId: raw.repoId as Id,
    name: raw.name as string,
    branch: raw.branch as string,
    path: raw.path as string,
    baseBranch: raw.baseBranch as string,
    baseCommit: raw.baseCommit as string,
    createdAt: raw.createdAt,
    collapsed: raw.collapsed
  }
}

/** Keeps the first item of each key; later duplicates (same id, or same folder path) are dropped. */
function keepFirst<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(item)
  }
  return kept
}

/** Parsed repos (invalid, duplicate-id and duplicate-path entries dropped). Absent (undefined) stays absent. */
export function parseRepos(raw: unknown): Repo[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return []
  const valid = raw.map(parseRepo).filter((r): r is Repo => r !== undefined)
  const byId = keepFirst(valid, (r) => r.id)
  return keepFirst(byId, (r) => pathKey(r.path))
}

/**
 * Parsed worktrees: invalid entries dropped, duplicate ids and paths dropped (first wins), and every worktree whose
 * repo is not among `repoIds` dropped. Absent (undefined) stays absent.
 */
export function parseWorktrees(raw: unknown, repoIds: ReadonlySet<Id>): Worktree[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return []
  const valid = raw
    .map(parseWorktree)
    .filter((w): w is Worktree => w !== undefined && repoIds.has(w.repoId))
  const byId = keepFirst(valid, (w) => w.id)
  return keepFirst(byId, (w) => pathKey(w.path))
}

/** True when a raw session refers to a worktree that is malformed or not stored: such a session is dropped. */
export function hasUnknownWorktreeRef(raw: unknown, worktreeIds: ReadonlySet<Id>): boolean {
  if (!isRecord(raw) || raw.worktreeId === undefined) return false
  return !isNonEmptyString(raw.worktreeId) || !worktreeIds.has(raw.worktreeId)
}
