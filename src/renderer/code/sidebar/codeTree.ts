// Pure tree model for the Code mode sidebar: repo > worktree > sessions. No React, no IPC.
import type { Id, Repo, Session, StoreData, Worktree } from '../../../shared/types'

export interface CodeWorktreeNode {
  readonly worktree: Worktree
  /** Open sessions of this worktree, oldest first (createdAt). */
  readonly sessions: readonly Session[]
}

export interface CodeRepoNode {
  readonly repo: Repo
  readonly worktrees: readonly CodeWorktreeNode[]
}

export interface CodeTree {
  readonly repos: readonly CodeRepoNode[]
  /** Closed sessions (closedAt set), for the Closed section. */
  readonly closed: readonly Session[]
}

export type CodeTreeData = Pick<StoreData, 'sessions'> & Partial<Pick<StoreData, 'repos' | 'worktrees'>>

function byCreatedAt(a: Session, b: Session): number {
  return a.createdAt - b.createdAt
}

function buildWorktreeNode(worktree: Worktree, sessions: readonly Session[]): CodeWorktreeNode {
  const own = sessions
    .filter((session): boolean => session.closedAt === undefined && session.worktreeId === worktree.id)
    .sort(byCreatedAt)
  return { worktree, sessions: own }
}

/**
 * Builds repo > worktree > sessions in stored order. Worktrees whose repo is missing are skipped; a worktree
 * with no open sessions still appears. Closed sessions go to the separate `closed` list.
 */
export function buildCodeTree(data: CodeTreeData): CodeTree {
  const worktrees = data.worktrees ?? []
  const nodes: CodeRepoNode[] = (data.repos ?? []).map((repo): CodeRepoNode => ({
    repo,
    worktrees: worktrees
      .filter((worktree): boolean => worktree.repoId === repo.id)
      .map((worktree): CodeWorktreeNode => buildWorktreeNode(worktree, data.sessions))
  }))
  return { repos: nodes, closed: closedSessions(data.sessions) }
}

function closedSessions(sessions: readonly Session[]): readonly Session[] {
  return sessions.filter((session): boolean => session.closedAt !== undefined).sort(byCreatedAt)
}

/** D61: reorders the sessions inside every worktree with `order` (a sort); repos and worktrees keep their order. */
export function orderCodeTreeSessions(tree: CodeTree, order: (sessions: readonly Session[]) => readonly Session[]): CodeTree {
  return {
    repos: tree.repos.map((repoNode): CodeRepoNode => ({
      repo: repoNode.repo,
      worktrees: repoNode.worktrees.map((node): CodeWorktreeNode => ({ worktree: node.worktree, sessions: order(node.sessions) }))
    })),
    closed: tree.closed
  }
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** True when the sidebar search has text (a non-empty query after trimming). */
export function isSearching(query: string): boolean {
  return normalizeQuery(query).length > 0
}

function matches(text: string, normalized: string): boolean {
  return text.toLowerCase().includes(normalized)
}

function filterWorktree(node: CodeWorktreeNode, query: string): readonly CodeWorktreeNode[] {
  const { worktree, sessions } = node
  if (matches(worktree.name, query) || matches(worktree.branch, query)) {
    return [node]
  }
  const matching = sessions.filter((session): boolean => matches(session.name, query))
  return matching.length > 0 ? [{ worktree, sessions: matching }] : []
}

function filterRepo(node: CodeRepoNode, query: string): readonly CodeRepoNode[] {
  if (matches(node.repo.name, query)) {
    return [node]
  }
  const worktrees = node.worktrees.flatMap((worktreeNode): readonly CodeWorktreeNode[] =>
    filterWorktree(worktreeNode, query)
  )
  return worktrees.length > 0 ? [{ repo: node.repo, worktrees }] : []
}

/**
 * Search filter (case-insensitive on repo name, worktree name, branch and session name). A matching repo or
 * worktree keeps all of its content; otherwise only the matching sessions stay. Empty query = the tree as is.
 */
export function filterCodeTree(tree: CodeTree, query: string): CodeTree {
  const normalized = normalizeQuery(query)
  if (normalized.length === 0) {
    return tree
  }
  return {
    repos: tree.repos.flatMap((node): readonly CodeRepoNode[] => filterRepo(node, normalized)),
    closed: tree.closed.filter((session): boolean => matches(session.name, normalized))
  }
}

/**
 * Session ids in on-screen order (keyboard navigation). Collapsed repos and worktrees hide their sessions,
 * unless a search is active (then every match is shown, like the rows are).
 */
export function visibleSessionIds(tree: CodeTree, searching: boolean): readonly Id[] {
  const ids: Id[] = []
  for (const repoNode of tree.repos) {
    if (repoNode.repo.collapsed && !searching) continue
    for (const worktreeNode of repoNode.worktrees) {
      if (worktreeNode.worktree.collapsed && !searching) continue
      for (const session of worktreeNode.sessions) ids.push(session.id)
    }
  }
  return ids
}

/** Worktree ids currently on screen (for the change counts). */
export function visibleWorktreeIds(tree: CodeTree): readonly Id[] {
  return tree.repos.flatMap((repoNode): readonly Id[] =>
    repoNode.worktrees.map((node): Id => node.worktree.id)
  )
}

/** Number of stored sessions (open or closed) that belong to a repo's worktrees. */
export function repoSessionCount(data: CodeTreeData, repoId: Id): number {
  const worktreeIds = new Set<Id>(
    (data.worktrees ?? []).filter((worktree): boolean => worktree.repoId === repoId).map((worktree): Id => worktree.id)
  )
  return data.sessions.filter((session): boolean => session.worktreeId !== undefined && worktreeIds.has(session.worktreeId)).length
}

/** Number of stored sessions (open or closed) that belong to one worktree. */
export function worktreeSessionCount(data: CodeTreeData, worktreeId: Id): number {
  return data.sessions.filter((session): boolean => session.worktreeId === worktreeId).length
}
