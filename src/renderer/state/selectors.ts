import type { StoreData, Group, Id, Session, StatusDef } from '../../shared/types'
import { folderKey } from '../shell/projectTabs'

export interface Section {
  readonly group: Group | null
  readonly sessions: readonly Session[]
}

const NONE_STATUS_KEY = 'No status'

export interface StatusSection {
  readonly key: string
  readonly label: string
  readonly statusId: Id | null
  readonly color: string | null
  readonly sessions: readonly Session[]
}

export function isClosed(session: Session): boolean {
  return session.closedAt !== undefined
}

/**
 * Returns the open and closed partitions of `data.sessions`. Closed sessions are
 * sorted by `closedAt` descending (most recently closed first); open sessions
 * preserve their original order. The function is pure: it returns new arrays.
 */
export function splitClosed(data: StoreData): {
  readonly open: readonly Session[]
  readonly closed: readonly Session[]
} {
  const open: Session[] = []
  const closed: Session[] = []
  for (const session of data.sessions) {
    if (isClosed(session)) {
      closed.push(session)
    } else {
      open.push(session)
    }
  }
  closed.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  return { open, closed }
}

export function groupedSessions(data: StoreData): readonly Section[] {
  const { open } = splitClosed(data)
  const groupsById = new Map(data.groups.map((g) => [g.id, g]))
  const sessionsByGroup = new Map<Id | null, Session[]>()

  for (const session of open) {
    const key = session.groupId
    const arr = sessionsByGroup.get(key) ?? []
    arr.push(session)
    sessionsByGroup.set(key, arr)
  }

  for (const arr of sessionsByGroup.values()) {
    arr.sort((a, b) => a.order - b.order)
  }

  const sections: Section[] = []

  for (const groupId of data.groupOrder) {
    const group = groupsById.get(groupId)
    if (!group) continue
    sections.push({
      group,
      sessions: sessionsByGroup.get(groupId) ?? []
    })
  }

  const hasGroups = data.groups.length > 0
  const ungrouped = sessionsByGroup.get(null) ?? []
  if (hasGroups || ungrouped.length > 0) {
    sections.push({
      group: null,
      sessions: ungrouped
    })
  }

  return sections
}

/**
 * Buckets open sessions by their status. Statuses come from `data.statuses` in
 * the same order; the synthetic "No status" bucket sits at the end and only
 * appears when at least one session has a null statusId. Sections with zero
 * sessions are omitted.
 */
export function groupByStatus(data: StoreData): readonly StatusSection[] {
  const { open } = splitClosed(data)
  const buckets = new Map<string, Session[]>()
  for (const session of open) {
    const key = session.statusId ?? NONE_STATUS_KEY
    const arr = buckets.get(key) ?? []
    arr.push(session)
    buckets.set(key, arr)
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.order - b.order)
  }

  const sections: StatusSection[] = []
  for (const status of data.statuses) {
    const sessions = buckets.get(status.id)
    if (sessions === undefined || sessions.length === 0) continue
    sections.push({
      key: status.id,
      label: status.name,
      statusId: status.id,
      color: status.color,
      sessions
    })
  }
  const noneBucket = buckets.get(NONE_STATUS_KEY)
  if (noneBucket !== undefined && noneBucket.length > 0) {
    sections.push({
      key: NONE_STATUS_KEY,
      label: NONE_STATUS_KEY,
      statusId: null,
      color: null,
      sessions: noneBucket
    })
  }
  return sections
}

export function filterByStatus(
  sections: readonly Section[],
  statusIds: ReadonlySet<Id | null>
): readonly Section[] {
  if (statusIds.size === 0) return sections

  return sections.map(section => ({
    group: section.group,
    sessions: section.sessions.filter(s => statusIds.has(s.statusId))
  }))
}

/** Same shape-preserving contract as `filterByStatus` but for status-grouped sections. */
export function filterStatusSectionsByStatus(
  sections: readonly StatusSection[],
  statusIds: ReadonlySet<Id | null>
): readonly StatusSection[] {
  if (statusIds.size === 0) return sections

  return sections.map(section => ({
    key: section.key,
    label: section.label,
    statusId: section.statusId,
    color: section.color,
    sessions: section.sessions.filter(s => statusIds.has(s.statusId))
  }))
}

/**
 * Narrows a status-filter selection to ids that still exist. A status id that
 * was deleted (no longer present in `statuses`) is dropped so the filter can no
 * longer match nothing with no way to toggle it off. The synthetic `null`
 * ("None") bucket always exists and is always retained. Pure; never mutates the
 * input and returns a new set.
 */
export function pruneStatusFilter(
  selected: ReadonlySet<Id | null>,
  statuses: readonly StatusDef[]
): ReadonlySet<Id | null> {
  if (selected.size === 0) return selected

  const valid = new Set<Id | null>(statuses.map((status): Id => status.id))
  valid.add(null)

  const next = new Set<Id | null>()
  for (const id of selected) {
    if (valid.has(id)) {
      next.add(id)
    }
  }
  return next
}

export function statusOf(data: StoreData, session: Session): StatusDef | null {
  if (session.statusId === null) return null
  return data.statuses.find(s => s.id === session.statusId) ?? null
}

/**
 * Ids in sidebar order for keyboard navigation. Sessions of collapsed groups, and (when workspaces are shown)
 * of collapsed workspaces, are skipped because they are not on screen.
 */
export function flatSessionIds(
  sections: readonly Section[],
  workspaceCollapsed: ReadonlyMap<string, boolean> = new Map(),
  showWorkspaces = true
): readonly Id[] {
  const result: Id[] = []
  for (const section of sections) {
    if (section.group?.collapsed) continue
    const groupId = section.group?.id ?? null
    for (const session of section.sessions) {
      const hidden =
        showWorkspaces &&
        workspaceCollapsed.get(workspaceCollapseKey(groupId, folderKey(session.cwd))) === true
      if (!hidden) result.push(session.id)
    }
  }
  return result
}

export interface WorkspaceBucket {
  /** `folderKey` of the root folder: stable identity of the workspace. */
  readonly key: string
  readonly label: string
  /** The folder as the first session spelled it (trailing separators removed). */
  readonly path: string
  readonly sessions: readonly Session[]
}

/** Collapse state is per group, so the same folder can be open in one group and collapsed in another. */
export function workspaceCollapseKey(groupId: Id | null, workspaceKey: string): string {
  return `${groupId ?? 'ungrouped'}|${workspaceKey}`
}

/**
 * Splits one group's sessions into workspaces by the folder each session was opened in. Buckets appear in the
 * order of their first session; sessions keep their incoming order. Two workspaces with the same folder name are
 * labelled `parent/name` so they can be told apart.
 */
export function workspaceBuckets(sessions: readonly Session[]): readonly WorkspaceBucket[] {
  const byKey = new Map<string, { path: string; sessions: Session[] }>()
  for (const session of sessions) {
    const key = folderKey(session.cwd)
    const bucket = byKey.get(key) ?? { path: session.cwd.replace(TRAILING_SEPARATORS, '') || session.cwd, sessions: [] }
    bucket.sessions.push(session)
    byKey.set(key, bucket)
  }
  const entries = [...byKey.entries()]
  const nameCount = new Map<string, number>()
  for (const [, bucket] of entries) {
    const name = lastPathSegment(bucket.path).toLowerCase()
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1)
  }
  return entries.map(([key, bucket]): WorkspaceBucket => {
    const name = lastPathSegment(bucket.path)
    const duplicate = (nameCount.get(name.toLowerCase()) ?? 0) > 1
    return { key, label: duplicate ? withParent(bucket.path, name) : name, path: bucket.path, sessions: bucket.sessions }
  })
}

function withParent(path: string, name: string): string {
  const parts = path.split(PATH_SEPARATORS).filter((part) => part.length > 0)
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${name}` : name
}

export function countByStatus(data: StoreData): ReadonlyMap<Id | null, number> {
  const counts = new Map<Id | null, number>()
  for (const session of data.sessions) {
    if (isClosed(session)) continue
    const key = session.statusId
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Case-insensitive search on session name and the final path segment of the
 * working directory. When the query is empty the input sections are returned
 * unchanged (same reference). Sections that become empty after filtering are
 * preserved so the UI can still show their header.
 */
export function filterBySearch(
  sections: readonly Section[],
  query: string
): readonly Section[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length === 0) return sections
  return sections.map(section => ({
    group: section.group,
    sessions: section.sessions.filter(session => {
      const name = session.name.toLowerCase()
      if (name.includes(trimmed)) return true
      const lastSegment = lastPathSegment(session.cwd).toLowerCase()
      return lastSegment.includes(trimmed)
    })
  }))
}

export function filterStatusSectionsBySearch(
  sections: readonly StatusSection[],
  query: string
): readonly StatusSection[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length === 0) return sections
  return sections.map(section => ({
    key: section.key,
    label: section.label,
    statusId: section.statusId,
    color: section.color,
    sessions: section.sessions.filter(session => {
      const name = session.name.toLowerCase()
      if (name.includes(trimmed)) return true
      const lastSegment = lastPathSegment(session.cwd).toLowerCase()
      return lastSegment.includes(trimmed)
    })
  }))
}

const TRAILING_SEPARATORS = /[\\/]+$/
const PATH_SEPARATORS = /[\\/]/

function lastPathSegment(path: string): string {
  const trimmed = path.replace(TRAILING_SEPARATORS, '')
  if (trimmed.length === 0) return path
  const parts = trimmed.split(PATH_SEPARATORS)
  const last = parts[parts.length - 1]
  return last.length > 0 ? last : path
}
/**
 * While a search or status filter is active, sections without a match are noise (Orca hides them), so drop
 * them. With no active filter every section stays, because empty groups are valid drop targets.
 */
export function dropEmptySections<T extends { readonly sessions: readonly Session[] }>(
  sections: readonly T[],
  filterActive: boolean
): readonly T[] {
  return filterActive ? sections.filter((section) => section.sessions.length > 0) : sections
}
