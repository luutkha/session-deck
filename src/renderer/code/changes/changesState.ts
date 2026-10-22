// Pure state transitions for the Changes hooks. A state is tied to the worktree (or file) it belongs
// to; replies for anything else are ignored, so a view never shows another worktree's data.
import type { ChangedFile, FileDiff, Id, WorktreeChanges } from '../../../shared/types'
import { keepNewest, type LoadResult } from './changesLoad'

export interface ChangesViewState {
  readonly worktreeId: Id | null
  readonly changes: WorktreeChanges | null
  readonly loading: boolean
  readonly error: string | null
}

export const INITIAL_CHANGES_VIEW: ChangesViewState = {
  worktreeId: null,
  changes: null,
  loading: false,
  error: null
}

/** A list load started for worktreeId. Data of another worktree is dropped at once. */
export function beginChangesLoad(state: ChangesViewState, worktreeId: Id): ChangesViewState {
  if (state.worktreeId !== worktreeId) {
    return { worktreeId, changes: null, loading: true, error: null }
  }
  return { ...state, loading: true, error: null }
}

/** A list load finished. Results for a worktree that is no longer shown are ignored. */
export function finishChangesLoad(
  state: ChangesViewState,
  worktreeId: Id,
  result: LoadResult<WorktreeChanges>
): ChangesViewState {
  if (state.worktreeId !== worktreeId) {
    return state
  }
  if (!result.ok) {
    return { ...state, loading: false, error: result.error }
  }
  return {
    worktreeId,
    changes: keepNewest(state.changes, result.value),
    loading: false,
    error: null
  }
}

/** What to show for `worktreeId`: the stored state when it belongs to that worktree, nothing for no worktree. */
export function viewFor(state: ChangesViewState, worktreeId: Id | null): ChangesViewState {
  if (worktreeId === null) {
    return INITIAL_CHANGES_VIEW
  }
  return state.worktreeId === worktreeId ? state : beginChangesLoad(INITIAL_CHANGES_VIEW, worktreeId)
}

/** main pushed fresh changes for a worktree. Other worktrees are ignored. */
export function applyPushedChanges(state: ChangesViewState, changes: WorktreeChanges): ChangesViewState {
  if (state.worktreeId !== changes.worktreeId) {
    return state
  }
  return {
    ...state,
    changes: keepNewest(state.changes, changes),
    loading: false,
    error: null
  }
}

/** Keeps only the counts of worktrees still in `wanted`. Returns the same map when nothing changed. */
export function pruneCounts(
  counts: ReadonlyMap<Id, WorktreeChanges>,
  wanted: ReadonlySet<Id>
): ReadonlyMap<Id, WorktreeChanges> {
  const kept = [...counts].filter(([id]: [Id, WorktreeChanges]): boolean => wanted.has(id))
  return kept.length === counts.size ? counts : new Map(kept)
}

/** Stores a snapshot unless a newer one is already stored. Returns the same map when nothing changed. */
export function putCount(
  counts: ReadonlyMap<Id, WorktreeChanges>,
  changes: WorktreeChanges
): ReadonlyMap<Id, WorktreeChanges> {
  const current = counts.get(changes.worktreeId)
  const next = keepNewest(current, changes)
  if (next === current) {
    return counts
  }
  return new Map(counts).set(changes.worktreeId, next)
}

const ID_LIST_SEPARATOR = '\n'

/** A stable key for a set of ids: unique, sorted, so a new array with the same ids gives the same key. */
export function idSetKey(ids: readonly Id[]): string {
  return [...new Set(ids)].sort().join(ID_LIST_SEPARATOR)
}

export function idsFromKey(key: string): readonly Id[] {
  return key === '' ? [] : key.split(ID_LIST_SEPARATOR)
}

/** True when `path` is one of the changed files in `changes`. A missing list or path is false. */
export function isStillChanged(changes: WorktreeChanges | null, path: string | null): boolean {
  return path !== null && changes !== null && changes.files.some((file: ChangedFile): boolean => file.path === path)
}

/** The lookup key of one file's diff. JSON keeps ids and paths unambiguous. */
export function diffKey(worktreeId: Id, path: string): string {
  return JSON.stringify([worktreeId, path])
}

export interface DiffViewState {
  readonly key: string | null
  readonly diff: FileDiff | null
  readonly loading: boolean
  readonly error: string | null
}

export const INITIAL_DIFF_VIEW: DiffViewState = {
  key: null,
  diff: null,
  loading: false,
  error: null
}

/** The part of a diff state that a caller may show for `key`. Other keys read as "not loaded yet". */
export interface DiffForKey {
  readonly diff: FileDiff | null
  readonly loading: boolean
  readonly error: string | null
}

/** A diff load started. A reload of the same file keeps the old text on screen until the new one arrives. */
export function beginDiffLoad(state: DiffViewState, key: string): DiffViewState {
  if (state.key !== key) {
    return { key, diff: null, loading: true, error: null }
  }
  return { ...state, loading: true, error: null }
}

/** A diff load finished. Results for another file are ignored. */
export function finishDiffLoad(state: DiffViewState, key: string, result: LoadResult<FileDiff>): DiffViewState {
  if (state.key !== key) {
    return state
  }
  if (!result.ok) {
    return { ...state, loading: false, error: result.error }
  }
  return { key, diff: result.value, loading: false, error: null }
}

/** What to show for `key`: the stored diff when it belongs to that key, otherwise a loading placeholder. */
export function diffForKey(state: DiffViewState, key: string): DiffForKey {
  if (state.key !== key) {
    return { diff: null, loading: true, error: null }
  }
  return { diff: state.diff, loading: state.loading, error: state.error }
}
