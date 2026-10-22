// Code mode (D31) reducers: repos and their git worktrees. Pure: every function returns new StoreData.
import { resolve } from 'node:path'
import type { Id, Repo, StoreData, Worktree } from '../../shared/types'

export interface AddRepoInput {
  readonly name: string
  readonly path: string
}

export interface CodeMeta {
  readonly id: Id
  readonly now: number
}

export type WorktreeDraft = Omit<Worktree, 'id' | 'createdAt' | 'collapsed'>

export interface AddRepoResult {
  readonly data: StoreData
  readonly repo: Repo
}

export interface AddWorktreeResult {
  readonly data: StoreData
  readonly worktree: Worktree
}

/** Path identity: the resolved path, lower-cased on Windows (case-insensitive file system). */
export function pathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function allRepos(data: StoreData): readonly Repo[] {
  return data.repos ?? []
}

export function allWorktrees(data: StoreData): readonly Worktree[] {
  return data.worktrees ?? []
}

export function findRepo(data: StoreData, id: Id): Repo | undefined {
  return allRepos(data).find((r) => r.id === id)
}

export function findWorktree(data: StoreData, id: Id): Worktree | undefined {
  return allWorktrees(data).find((w) => w.id === id)
}

/** Adds a repo, or returns the existing one with the same path (same data object back). */
export function addRepo(data: StoreData, input: AddRepoInput, meta: CodeMeta): AddRepoResult {
  const name = input.name.trim()
  if (name.length === 0) {
    throw new Error('Name required')
  }
  if (input.path.trim().length === 0) {
    throw new Error('Invalid repo path')
  }
  const key = pathKey(input.path)
  const existing = allRepos(data).find((r) => pathKey(r.path) === key)
  if (existing) {
    return { data, repo: existing }
  }
  const repo: Repo = {
    id: meta.id,
    name,
    path: resolve(input.path),
    createdAt: meta.now,
    collapsed: false
  }
  return { data: { ...data, repos: [...allRepos(data), repo] }, repo }
}

/** Removes the repo, its worktrees and every session running in one of them. Unknown id = same data back. */
export function removeRepo(data: StoreData, id: Id): StoreData {
  if (!findRepo(data, id)) return data
  const removedWorktreeIds = new Set(allWorktrees(data).filter((w) => w.repoId === id).map((w) => w.id))
  return {
    ...data,
    repos: allRepos(data).filter((r) => r.id !== id),
    worktrees: allWorktrees(data).filter((w) => w.repoId !== id),
    sessions: data.sessions.filter((s) => s.worktreeId === undefined || !removedWorktreeIds.has(s.worktreeId))
  }
}

export function setRepoCollapsed(data: StoreData, id: Id, collapsed: boolean): StoreData {
  if (!findRepo(data, id)) return data
  return {
    ...data,
    repos: allRepos(data).map((r) => (r.id === id ? { ...r, collapsed } : r))
  }
}

/** Adds a worktree to an existing repo. Throws when the repo is unknown or the path is already used. */
export function addWorktree(data: StoreData, draft: WorktreeDraft, meta: CodeMeta): AddWorktreeResult {
  if (!findRepo(data, draft.repoId)) {
    throw new Error('Repo not found')
  }
  if (draft.path.trim().length === 0) {
    throw new Error('Invalid worktree path')
  }
  const key = pathKey(draft.path)
  if (allWorktrees(data).some((w) => pathKey(w.path) === key)) {
    throw new Error('Worktree already added')
  }
  const worktree: Worktree = {
    ...draft,
    path: resolve(draft.path),
    id: meta.id,
    createdAt: meta.now,
    collapsed: false
  }
  return { data: { ...data, worktrees: [...allWorktrees(data), worktree] }, worktree }
}

/** Removes the worktree and every session running in it. Unknown id = same data back. */
export function removeWorktree(data: StoreData, id: Id): StoreData {
  if (!findWorktree(data, id)) return data
  return {
    ...data,
    worktrees: allWorktrees(data).filter((w) => w.id !== id),
    sessions: data.sessions.filter((s) => s.worktreeId !== id)
  }
}

export function setWorktreeCollapsed(data: StoreData, id: Id, collapsed: boolean): StoreData {
  if (!findWorktree(data, id)) return data
  return {
    ...data,
    worktrees: allWorktrees(data).map((w) => (w.id === id ? { ...w, collapsed } : w))
  }
}
