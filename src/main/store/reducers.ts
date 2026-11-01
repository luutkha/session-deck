import type { CreateSessionInput, Group, Id, Session, StatusDef, StoreData } from '../../shared/types'
import { DEFAULT_STATUSES } from '../../shared/types'
import { isOpencodeSessionId } from '../opencode/values'
import { clearAutoStatusReference } from './settings'
import { findWorktree } from './codeReducers'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_NAME_LENGTH = 100
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export interface CreateSessionMeta {
  readonly id: Id
  readonly now: number
}

export interface CreateSessionResult {
  readonly data: StoreData
  readonly session: Session
}

export interface CreateGroupResult {
  readonly data: StoreData
  readonly group: Group
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new Error('Name required')
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error('Name too long')
  }
  return trimmed
}

export function findSessionIndex(data: StoreData, id: Id): number {
  const index = data.sessions.findIndex((s) => s.id === id)
  if (index === -1) {
    throw new Error(`Unknown session: ${id}`)
  }
  return index
}

function findGroupIndex(data: StoreData, id: Id): number {
  const index = data.groups.findIndex((g) => g.id === id)
  if (index === -1) {
    throw new Error(`Unknown group: ${id}`)
  }
  return index
}

function groupExists(data: StoreData, id: Id | null): boolean {
  return id === null || data.groups.some((g) => g.id === id)
}

function statusExists(data: StoreData, id: Id | null): boolean {
  return id === null || data.statuses.some((s) => s.id === id)
}

function sessionsInGroup(data: StoreData, groupId: Id | null): Session[] {
  return data.sessions.filter((s) => s.groupId === groupId)
}

function renormalizeOrders(sessions: Session[]): Session[] {
  return sessions.map((s, index) => ({ ...s, order: index }))
}

function defaultNameFromCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/')
  const trimmed = normalized.replace(/\/+$/u, '')
  const lastSlash = trimmed.lastIndexOf('/')
  const segment = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1)
  if (segment.length === 0 || /^[a-zA-Z]:$/.test(segment)) {
    return 'session'
  }
  return segment
}

export function emptyStore(): StoreData {
  return {
    version: 1,
    sessions: [],
    groups: [],
    statuses: DEFAULT_STATUSES,
    groupOrder: []
  }
}

const SHELL_SESSION_NAME = 'Shell'

/** The agent-specific fields of a new session. Claude gets its conversation id now; OpenCode reports its own later; a shell has none. */
function agentFieldsFor(input: CreateSessionInput, id: Id): Partial<Pick<Session, 'agent' | 'model' | 'claudeSessionId'>> {
  if (input.agent === 'shell') {
    return { agent: 'shell' }
  }
  if (input.agent === 'opencode') {
    const model = input.model !== undefined && input.model.trim().length > 0 ? input.model : undefined
    return { agent: 'opencode', ...(model !== undefined ? { model } : {}) }
  }
  return { claudeSessionId: id }
}

export function createSession(
  data: StoreData,
  input: CreateSessionInput,
  meta: CreateSessionMeta
): CreateSessionResult {
  const cwd = input.cwd.trim()
  if (cwd.length === 0) {
    throw new Error('Invalid cwd')
  }

  const worktreeId = input.worktreeId
  if (worktreeId !== undefined && !findWorktree(data, worktreeId)) {
    throw new Error('Worktree not found')
  }
  // Worktree sessions live under their worktree (Code mode), never in an Ops group.
  const groupId = worktreeId !== undefined ? null : input.groupId ?? null
  const statusId = input.statusId ?? null

  if (!groupExists(data, groupId)) {
    throw new Error(`Unknown group: ${groupId ?? ''}`)
  }
  if (!statusExists(data, statusId)) {
    throw new Error(`Unknown status: ${statusId ?? ''}`)
  }

  const name = input.name?.trim().length
    ? validateName(input.name)
    : input.agent === 'shell' ? SHELL_SESSION_NAME : defaultNameFromCwd(cwd)
  const claudeArgs = input.claudeArgs ?? []

  const siblings = sessionsInGroup(data, groupId)
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1

  const session: Session = {
    id: meta.id,
    name,
    cwd,
    groupId,
    statusId,
    order,
    createdAt: meta.now,
    claudeArgs,
    ...agentFieldsFor(input, meta.id),
    ...(worktreeId !== undefined ? { worktreeId } : {}),
    ...(input.role === 'jarvis' ? { role: 'jarvis' as const } : {})
  }

  return {
    data: {
      ...data,
      sessions: [...data.sessions, session]
    },
    session
  }
}

export function renameSession(data: StoreData, id: Id, name: string): StoreData {
  const index = findSessionIndex(data, id)
  const trimmed = validateName(name)
  const sessions = data.sessions.map((s, i) =>
    i === index ? { ...s, name: trimmed } : s
  )
  return { ...data, sessions }
}

export function setSessionStatus(data: StoreData, id: Id, statusId: Id | null): StoreData {
  const index = findSessionIndex(data, id)
  if (!statusExists(data, statusId)) {
    throw new Error(`Unknown status: ${statusId ?? ''}`)
  }
  const sessions = data.sessions.map((s, i) =>
    i === index ? { ...s, statusId } : s
  )
  return { ...data, sessions }
}

function groupIdsInFirstAppearanceOrder(sessions: readonly Session[]): (Id | null)[] {
  const order: (Id | null)[] = []
  const seen = new Set<Id | null>()
  for (const session of sessions) {
    if (!seen.has(session.groupId)) {
      order.push(session.groupId)
      seen.add(session.groupId)
    }
  }
  return order
}

export function moveSession(data: StoreData, id: Id, groupId: Id | null, index: number): StoreData {
  const session = data.sessions.find((s) => s.id === id)
  if (!session) {
    throw new Error(`Unknown session: ${id}`)
  }
  if (!groupExists(data, groupId)) {
    throw new Error(`Unknown group: ${groupId ?? ''}`)
  }

  const sourceGroupId = session.groupId
  const targetGroupId = groupId

  const byGroup = new Map<Id | null, Session[]>()
  for (const s of data.sessions) {
    if (s.id === id) continue
    const list = byGroup.get(s.groupId) ?? []
    list.push(s)
    byGroup.set(s.groupId, list)
  }

  const sourceList = byGroup.get(sourceGroupId) ?? []
  byGroup.set(sourceGroupId, renormalizeOrders(sourceList))

  const targetList = byGroup.get(targetGroupId) ?? []
  const clampedIndex = Math.max(0, Math.min(index, targetList.length))
  const newTargetList = [...targetList]
  newTargetList.splice(clampedIndex, 0, { ...session, groupId: targetGroupId })
  byGroup.set(targetGroupId, renormalizeOrders(newTargetList))

  const groupOrder = groupIdsInFirstAppearanceOrder(data.sessions)
  if (!groupOrder.includes(targetGroupId)) {
    groupOrder.push(targetGroupId)
  }

  const sessions: Session[] = []
  for (const groupIdKey of groupOrder) {
    sessions.push(...(byGroup.get(groupIdKey) ?? []))
  }

  return { ...data, sessions }
}

export function removeSession(data: StoreData, id: Id): StoreData {
  const index = findSessionIndex(data, id)
  const removed = data.sessions[index]
  const remaining = data.sessions.filter((_, i) => i !== index)
  const groupSessions = remaining.filter((s) => s.groupId === removed.groupId)
  const renormalized = renormalizeOrders(groupSessions)
  const sessions = remaining.map((s) =>
    s.groupId === removed.groupId
      ? renormalized.find((r) => r.id === s.id) ?? s
      : s
  )
  return { ...data, sessions }
}

/** Marks a session closed (its process is stopped by the controller). Already closed = same data back. */
export function closeSession(data: StoreData, id: Id, now: number): StoreData {
  const index = findSessionIndex(data, id)
  if (data.sessions[index].closedAt !== undefined) {
    return data
  }
  const sessions = data.sessions.map((s, i) =>
    i === index ? { ...s, closedAt: now } : s
  )
  return { ...data, sessions }
}

/** Clears closedAt. Not closed = same data back. */
export function reopenSession(data: StoreData, id: Id): StoreData {
  const index = findSessionIndex(data, id)
  if (data.sessions[index].closedAt === undefined) {
    return data
  }
  const sessions = data.sessions.map((s, i) => {
    if (i !== index) return s
    const { closedAt: _closedAt, ...open } = s
    return open
  })
  return { ...data, sessions }
}

export function setClaudeSessionId(data: StoreData, id: Id, claudeSessionId: string): StoreData {
  if (!UUID_RE.test(claudeSessionId)) {
    throw new Error('Invalid claudeSessionId')
  }
  const index = findSessionIndex(data, id)
  const sessions = data.sessions.map((s, i) =>
    i === index ? { ...s, claudeSessionId } : s
  )
  return { ...data, sessions }
}

/** Stores the OpenCode conversation id the plugin reported. Same value again = same data back. */
export function setOpencodeSessionId(data: StoreData, id: Id, opencodeSessionId: string): StoreData {
  if (!isOpencodeSessionId(opencodeSessionId)) {
    throw new Error('Invalid opencodeSessionId')
  }
  const index = findSessionIndex(data, id)
  if (data.sessions[index].opencodeSessionId === opencodeSessionId) {
    return data
  }
  const sessions = data.sessions.map((s, i) =>
    i === index ? { ...s, opencodeSessionId } : s
  )
  return { ...data, sessions }
}

/** Sets or clears the keep-awake flag (cleared = field removed). Same value again = same data back. */
export function setKeepAwake(data: StoreData, id: Id, keepAwake: boolean): StoreData {
  const index = findSessionIndex(data, id)
  if ((data.sessions[index].keepAwake === true) === keepAwake) {
    return data
  }
  const sessions = data.sessions.map((s, i) => {
    if (i !== index) return s
    const { keepAwake: _keepAwake, ...rest } = s
    return keepAwake ? { ...rest, keepAwake: true } : rest
  })
  return { ...data, sessions }
}

export function createGroup(data: StoreData, name: string, id: Id): CreateGroupResult {
  const trimmed = validateName(name)
  const group: Group = { id, name: trimmed, collapsed: false }
  return {
    data: {
      ...data,
      groups: [...data.groups, group],
      groupOrder: [...data.groupOrder, id]
    },
    group
  }
}

export function renameGroup(data: StoreData, id: Id, name: string): StoreData {
  const index = findGroupIndex(data, id)
  const trimmed = validateName(name)
  const groups = data.groups.map((g, i) =>
    i === index ? { ...g, name: trimmed } : g
  )
  return { ...data, groups }
}

export function removeGroup(data: StoreData, id: Id): StoreData {
  const groupIndex = findGroupIndex(data, id)

  const existingUngrouped = data.sessions.filter((s) => s.groupId === null)
  const removedGroupSessions = data.sessions
    .filter((s) => s.groupId === id)
    .map((s) => ({ ...s, groupId: null as Id | null }))
  const newUngrouped = renormalizeOrders([...existingUngrouped, ...removedGroupSessions])

  const sessions = data.sessions.map((s) => {
    if (s.groupId === id || s.groupId === null) {
      return newUngrouped.find((u) => u.id === s.id) ?? s
    }
    return s
  })

  return {
    ...data,
    sessions,
    groups: data.groups.filter((_, i) => i !== groupIndex),
    groupOrder: data.groupOrder.filter((groupId) => groupId !== id)
  }
}

export function setGroupCollapsed(data: StoreData, id: Id, collapsed: boolean): StoreData {
  const index = findGroupIndex(data, id)
  const groups = data.groups.map((g, i) =>
    i === index ? { ...g, collapsed } : g
  )
  return { ...data, groups }
}

export function reorderGroups(data: StoreData, order: readonly Id[]): StoreData {
  const existing = new Set(data.groupOrder)
  const incoming = new Set(order)
  if (
    order.length !== existing.size ||
    incoming.size !== existing.size ||
    order.some((id) => !existing.has(id))
  ) {
    throw new Error('Invalid group order')
  }
  return { ...data, groupOrder: [...order] }
}

export function upsertStatus(data: StoreData, status: StatusDef): StoreData {
  const trimmedName = validateName(status.name)
  if (!HEX_COLOR_RE.test(status.color)) {
    throw new Error('Invalid status color')
  }
  const nextStatus: StatusDef = { ...status, name: trimmedName }
  const index = data.statuses.findIndex((s) => s.id === status.id)
  const statuses =
    index === -1
      ? [...data.statuses, nextStatus]
      : data.statuses.map((s, i) => (i === index ? nextStatus : s))
  return { ...data, statuses }
}

/** `order` must be an exact permutation of the current status ids; the array order becomes the Hub column order. */
export function reorderStatuses(data: StoreData, order: readonly Id[]): StoreData {
  const existing = new Set(data.statuses.map((s) => s.id))
  const incoming = new Set(order)
  if (
    order.length !== existing.size ||
    incoming.size !== existing.size ||
    order.some((id) => !existing.has(id))
  ) {
    throw new Error('Invalid status order')
  }
  const byId = new Map(data.statuses.map((s) => [s.id, s] as const))
  const statuses = order.map((id) => {
    const status = byId.get(id)
    if (!status) {
      throw new Error('Invalid status order')
    }
    return status
  })
  return { ...data, statuses }
}

export function removeStatus(data: StoreData, id: Id): StoreData {
  const index = data.statuses.findIndex((s) => s.id === id)
  if (index === -1) {
    throw new Error(`Unknown status: ${id}`)
  }
  const statuses = data.statuses.filter((_, i) => i !== index)
  const sessions = data.sessions.map((s) =>
    s.statusId === id ? { ...s, statusId: null } : s
  )
  // Auto status mappings pointing at the removed status are cleared too (no settings key is added when none apply).
  const settings = clearAutoStatusReference(data, id)
  return {
    ...data,
    statuses,
    sessions,
    ...(settings !== undefined ? { settings } : {})
  }
}
