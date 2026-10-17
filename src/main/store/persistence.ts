import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ChecklistItem, Group, Session, StatusDef, StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import { validateChecklist, validateNotes } from './sessionNotes'
import { parseStoredSettings } from './settings'
import { isOpencodeSessionId, isOpencodeModel } from '../opencode/values'

const STORE_VERSION = 1
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ParsedResult {
  readonly data: StoreData
  readonly warning?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function hasDuplicateIds(items: { readonly id: string }[]): boolean {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) return true
    seen.add(item.id)
  }
  return false
}

function parseSession(raw: unknown, index: number): Session {
  if (!isObject(raw)) {
    throw new Error(`Invalid store: sessions[${index}] is not an object`)
  }
  if (!isString(raw.id)) throw new Error(`Invalid store: sessions[${index}].id`)
  if (!isString(raw.name)) throw new Error(`Invalid store: sessions[${index}].name`)
  if (!isString(raw.cwd)) throw new Error(`Invalid store: sessions[${index}].cwd`)
  if (!isStringOrNull(raw.groupId)) throw new Error(`Invalid store: sessions[${index}].groupId`)
  if (!isStringOrNull(raw.statusId)) throw new Error(`Invalid store: sessions[${index}].statusId`)
  if (!isNumber(raw.order)) throw new Error(`Invalid store: sessions[${index}].order`)
  if (!isNumber(raw.createdAt)) throw new Error(`Invalid store: sessions[${index}].createdAt`)
  if (!isStringArray(raw.claudeArgs)) throw new Error(`Invalid store: sessions[${index}].claudeArgs`)

  if (raw.claudeSessionId !== undefined) {
    if (!isString(raw.claudeSessionId)) {
      throw new Error(`Invalid store: sessions[${index}].claudeSessionId must be a string`)
    }
    if (raw.claudeSessionId.length === 0) {
      throw new Error(`Invalid store: sessions[${index}].claudeSessionId must not be empty`)
    }
    if (!UUID_RE.test(raw.claudeSessionId)) {
      throw new Error(`Invalid store: sessions[${index}].claudeSessionId is not a valid UUID`)
    }
  }

  if (raw.closedAt !== undefined && !isNonNegativeNumber(raw.closedAt)) {
    throw new Error(`Invalid store: sessions[${index}].closedAt must be a non-negative number`)
  }

  // OpenCode fields (absent on every session saved before OpenCode support = a claude session).
  const opencode = parseOpencodeFields(raw, index)
  // Notes and checklist are optional extras: an invalid value is dropped, never failing the whole file.
  const notes = parseOptionalNotes(raw.notes)
  const checklist = parseOptionalChecklist(raw.checklist)

  const session: Session = {
    id: raw.id,
    name: raw.name,
    cwd: raw.cwd,
    groupId: raw.groupId,
    statusId: raw.statusId,
    order: raw.order,
    createdAt: raw.createdAt,
    claudeArgs: raw.claudeArgs,
    ...(raw.claudeSessionId !== undefined
      ? { claudeSessionId: raw.claudeSessionId as string }
      : {}),
    ...(opencode.agent ? { agent: opencode.agent } : {}),
    ...(opencode.opencodeSessionId ? { opencodeSessionId: opencode.opencodeSessionId } : {}),
    ...(opencode.model ? { model: opencode.model } : {}),
    ...(raw.closedAt !== undefined ? { closedAt: raw.closedAt as number } : {}),
    ...(raw.keepAwake === true ? { keepAwake: true } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(checklist !== undefined ? { checklist } : {})
  }

  return session
}

/**
 * The optional OpenCode fields of one session. Absent = a claude session (no agent field stored). An invalid
 * present value fails the file like an invalid claudeSessionId would. Fields other than `agent` are only read
 * for opencode sessions; an empty stored model means "OpenCode's own default" (absent).
 */
function parseOpencodeFields(
  raw: Record<string, unknown>,
  index: number
): { agent: 'opencode' | undefined; opencodeSessionId: string | undefined; model: string | undefined } {
  const agent = raw.agent
  if (agent === undefined) {
    return { agent: undefined, opencodeSessionId: undefined, model: undefined }
  }
  if (agent !== 'claude' && agent !== 'opencode') {
    throw new Error(`Invalid store: sessions[${index}].agent must be "claude" or "opencode"`)
  }
  if (agent !== 'opencode') {
    return { agent: undefined, opencodeSessionId: undefined, model: undefined }
  }

  let opencodeSessionId: string | undefined
  if (raw.opencodeSessionId !== undefined) {
    if (!isOpencodeSessionId(raw.opencodeSessionId)) {
      throw new Error(`Invalid store: sessions[${index}].opencodeSessionId`)
    }
    opencodeSessionId = raw.opencodeSessionId
  }

  let model: string | undefined
  if (raw.model !== undefined) {
    if (!isOpencodeModel(raw.model)) {
      throw new Error(`Invalid store: sessions[${index}].model`)
    }
    model = raw.model.length > 0 ? raw.model : undefined
  }

  return { agent: 'opencode', opencodeSessionId, model }
}

/** Valid notes are kept; invalid notes and the empty string yield undefined (field absent). */function parseOptionalNotes(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  try {
    const notes = validateNotes(raw)
    return notes === '' ? undefined : notes
  } catch {
    return undefined
  }
}

/** Valid checklists are kept; invalid checklists and the empty list yield undefined (field absent). */
function parseOptionalChecklist(raw: unknown): ChecklistItem[] | undefined {
  if (raw === undefined) return undefined
  try {
    const items = validateChecklist(raw)
    return items.length === 0 ? undefined : items
  } catch {
    return undefined
  }
}

function parseGroup(raw: unknown, index: number): Group {
  if (!isObject(raw)) {
    throw new Error(`Invalid store: groups[${index}] is not an object`)
  }
  if (!isString(raw.id)) throw new Error(`Invalid store: groups[${index}].id`)
  if (!isString(raw.name)) throw new Error(`Invalid store: groups[${index}].name`)
  if (!isBoolean(raw.collapsed)) throw new Error(`Invalid store: groups[${index}].collapsed`)

  return { id: raw.id, name: raw.name, collapsed: raw.collapsed }
}

function parseStatus(raw: unknown, index: number): StatusDef {
  if (!isObject(raw)) {
    throw new Error(`Invalid store: statuses[${index}] is not an object`)
  }
  if (!isString(raw.id)) throw new Error(`Invalid store: statuses[${index}].id`)
  if (!isString(raw.name)) throw new Error(`Invalid store: statuses[${index}].name`)
  if (!isString(raw.color)) throw new Error(`Invalid store: statuses[${index}].color`)

  return { id: raw.id, name: raw.name, color: raw.color }
}

export function parseStoreData(raw: unknown): StoreData {
  if (!isObject(raw)) {
    throw new Error('Invalid store: not an object')
  }
  if (raw.version !== STORE_VERSION) {
    throw new Error(`Invalid store: version ${String(raw.version)}`)
  }
  if (!Array.isArray(raw.sessions)) {
    throw new Error('Invalid store: sessions is not an array')
  }
  if (!Array.isArray(raw.groups)) {
    throw new Error('Invalid store: groups is not an array')
  }
  if (!Array.isArray(raw.statuses)) {
    throw new Error('Invalid store: statuses is not an array')
  }
  if (!isStringArray(raw.groupOrder)) {
    throw new Error('Invalid store: groupOrder is not a string array')
  }

  const sessions = raw.sessions.map(parseSession)
  const groups = raw.groups.map(parseGroup)
  const statuses = raw.statuses.map(parseStatus)

  if (hasDuplicateIds(sessions)) {
    throw new Error('Invalid store: duplicate session id')
  }
  if (hasDuplicateIds(groups)) {
    throw new Error('Invalid store: duplicate group id')
  }
  if (hasDuplicateIds(statuses)) {
    throw new Error('Invalid store: duplicate status id')
  }

  const groupIds = new Set(groups.map((g) => g.id))
  const statusIds = new Set(statuses.map((s) => s.id))

  const repairedSessions = sessions.map((s) => {
    const groupId = s.groupId !== null && !groupIds.has(s.groupId) ? null : s.groupId
    const statusId = s.statusId !== null && !statusIds.has(s.statusId) ? null : s.statusId
    return groupId === s.groupId && statusId === s.statusId
      ? s
      : { ...s, groupId, statusId }
  })

  // An invalid stored settings value is dropped (undefined = defaults); the file itself is kept.
  const settings = raw.settings === undefined ? undefined : parseStoredSettings(raw.settings, statuses)

  return {
    version: STORE_VERSION,
    sessions: repairedSessions,
    groups,
    statuses,
    groupOrder: [...raw.groupOrder],
    ...(settings !== undefined ? { settings } : {})
  }
}

export async function loadStoreFile(path: string): Promise<ParsedResult> {
  try {
    const text = await readFile(path, 'utf-8')
    const parsed = JSON.parse(text) as unknown
    const data = parseStoreData(parsed)
    return { data }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { data: emptyStore() }
    }

    const timestamp = Date.now()
    const corruptPath = `${path}.corrupt-${timestamp}`
    try {
      await rename(path, corruptPath)
    } catch {
      // Best-effort rename; ignore failure so we still return a usable store.
    }

    const reason = error instanceof Error ? error.message : String(error)
    return {
      data: emptyStore(),
      warning: `Store file was corrupt (${reason}); renamed to ${corruptPath}`
    }
  }
}

export async function saveStoreFile(path: string, data: StoreData): Promise<void> {
  const parent = dirname(path)
  await mkdir(parent, { recursive: true })
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await rename(tmpPath, path)
}

export interface DebouncedSaverDeps {
  readonly setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly clearTimeout?: (id: ReturnType<typeof setTimeout>) => void
  readonly save?: (path: string, data: StoreData) => Promise<void>
}

export interface DebouncedSaver {
  readonly schedule: (data: StoreData) => void
  readonly flush: () => Promise<void>
}

export function createDebouncedSaver(
  path: string,
  delayMs: number,
  deps: DebouncedSaverDeps = {}
): DebouncedSaver {
  const setTimer = deps.setTimeout ?? setTimeout
  const clearTimer = deps.clearTimeout ?? clearTimeout
  const save = deps.save ?? saveStoreFile

  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: StoreData | null = null
  let flushing: Promise<void> | null = null

  const writePending = async (): Promise<void> => {
    const data = pending
    pending = null
    timer = null
    if (data) {
      await save(path, data)
    }
  }

  return {
    schedule(data) {
      pending = data
      if (timer) {
        clearTimer(timer)
      }
      timer = setTimer(() => {
        void writePending()
      }, delayMs)
    },
    async flush() {
      if (flushing) return flushing
      if (!pending) return
      if (timer) {
        clearTimer(timer)
        timer = null
      }
      flushing = writePending()
      try {
        await flushing
      } finally {
        flushing = null
      }
    }
  }
}
