import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { ChecklistItem, Group, QueuedPrompt, Session, StatusDef, StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import { validateChecklist, validateNotes, validateQueue } from './sessionNotes'
import { parseStoredSettings } from './settings'
import { hasUnknownWorktreeRef, parseRepos, parseWorktrees } from './codePersistence'
import { isOpencodeSessionId, isOpencodeModel } from '../opencode/values'
import { isCursorChatId, isCursorModel } from './cursorValues'
import { parsePresets } from './presets'
import { errorMessage, isRecord } from '../../shared/guards'

const STORE_VERSION = 1
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ParsedResult {
  readonly data: StoreData
  readonly warning?: string
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
  if (!isRecord(raw)) {
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

  // Agent fields (absent on every session saved before OpenCode support = a claude session).
  const agentFields = parseAgentFields(raw, index)
  // Notes and checklist are optional extras: an invalid value is dropped, never failing the whole file.
  const notes = parseOptionalNotes(raw.notes)
  const checklist = parseOptionalChecklist(raw.checklist)
  const queue = parseOptionalQueue(raw.queue)

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
    ...(agentFields.agent ? { agent: agentFields.agent } : {}),
    ...(agentFields.opencodeSessionId ? { opencodeSessionId: agentFields.opencodeSessionId } : {}),
    ...(agentFields.cursorChatId ? { cursorChatId: agentFields.cursorChatId } : {}),
    ...(agentFields.model ? { model: agentFields.model } : {}),
    ...(agentFields.opencodePermissions ? { opencodePermissions: agentFields.opencodePermissions } : {}),
    ...(raw.closedAt !== undefined ? { closedAt: raw.closedAt as number } : {}),
    ...(raw.keepAwake === true ? { keepAwake: true } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(checklist !== undefined ? { checklist } : {}),
    ...(queue !== undefined ? { queue } : {}),
    // Checked by parseStoreData: a present worktreeId is a non-empty string of a stored worktree.
    ...(raw.worktreeId !== undefined ? { worktreeId: raw.worktreeId as string } : {}),
    // D53: any other value is dropped (the session becomes a normal one).
    ...(raw.role === 'jarvis' ? { role: 'jarvis' as const } : {}),
    // D61: an invalid value is dropped (the session then sorts by createdAt).
    ...(isNonNegativeNumber(raw.lastActiveAt) ? { lastActiveAt: raw.lastActiveAt } : {})
  }

  return session
}

interface AgentFields {
  readonly agent: 'opencode' | 'cursor' | 'shell' | undefined
  readonly opencodeSessionId: string | undefined
  readonly cursorChatId: string | undefined
  readonly model: string | undefined
  readonly opencodePermissions: 'yolo' | 'ask' | undefined
}

const NO_AGENT_FIELDS: AgentFields = {
  agent: undefined,
  opencodeSessionId: undefined,
  cursorChatId: undefined,
  model: undefined,
  opencodePermissions: undefined
}

/**
 * The optional agent fields of one session. Absent = a claude session (no agent field stored). An invalid
 * present value fails the file like an invalid claudeSessionId would. A shell session stores only its agent.
 * Other fields are only read for opencode or cursor sessions; an empty stored model means the agent's own default.
 */
function parseAgentFields(raw: Record<string, unknown>, index: number): AgentFields {
  const agent = raw.agent
  if (agent === undefined) {
    return NO_AGENT_FIELDS
  }
  if (agent !== 'claude' && agent !== 'opencode' && agent !== 'cursor' && agent !== 'shell') {
    throw new Error(`Invalid store: sessions[${index}].agent must be "claude", "opencode", "cursor" or "shell"`)
  }
  if (agent === 'shell') {
    return { agent: 'shell', opencodeSessionId: undefined, cursorChatId: undefined, model: undefined, opencodePermissions: undefined }
  }
  if (agent === 'cursor') {
    let cursorChatId: string | undefined
    if (raw.cursorChatId !== undefined) {
      if (!isCursorChatId(raw.cursorChatId)) {
        throw new Error(`Invalid store: sessions[${index}].cursorChatId`)
      }
      cursorChatId = raw.cursorChatId
    }

    let model: string | undefined
    if (raw.model !== undefined) {
      if (!isCursorModel(raw.model)) {
        throw new Error(`Invalid store: sessions[${index}].model`)
      }
      model = raw.model
    }

    // Cursor sessions never carry OpenCode fields.
    return { agent: 'cursor', opencodeSessionId: undefined, cursorChatId, model, opencodePermissions: undefined }
  }
  if (agent !== 'opencode') {
    return NO_AGENT_FIELDS
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

  // D79: an invalid policy is dropped (the session keeps the D10 yolo default), never failing the file.
  const opencodePermissions =
    raw.opencodePermissions === 'yolo' || raw.opencodePermissions === 'ask' ? raw.opencodePermissions : undefined

  return { agent: 'opencode', opencodeSessionId, cursorChatId: undefined, model, opencodePermissions }
}

/** Valid notes are kept; invalid notes and the empty string yield undefined (field absent). */
function parseOptionalNotes(raw: unknown): string | undefined {
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

/** Valid queues are kept; invalid queues and the empty list yield undefined (field absent). */
function parseOptionalQueue(raw: unknown): QueuedPrompt[] | undefined {
  if (raw === undefined) return undefined
  try {
    const items = validateQueue(raw)
    return items.length === 0 ? undefined : items
  } catch {
    return undefined
  }
}

function parseGroup(raw: unknown, index: number): Group {
  if (!isRecord(raw)) {
    throw new Error(`Invalid store: groups[${index}] is not an object`)
  }
  if (!isString(raw.id)) throw new Error(`Invalid store: groups[${index}].id`)
  if (!isString(raw.name)) throw new Error(`Invalid store: groups[${index}].name`)
  if (!isBoolean(raw.collapsed)) throw new Error(`Invalid store: groups[${index}].collapsed`)

  return { id: raw.id, name: raw.name, collapsed: raw.collapsed }
}

function parseStatus(raw: unknown, index: number): StatusDef {
  if (!isRecord(raw)) {
    throw new Error(`Invalid store: statuses[${index}] is not an object`)
  }
  if (!isString(raw.id)) throw new Error(`Invalid store: statuses[${index}].id`)
  if (!isString(raw.name)) throw new Error(`Invalid store: statuses[${index}].name`)
  if (!isString(raw.color)) throw new Error(`Invalid store: statuses[${index}].color`)

  return { id: raw.id, name: raw.name, color: raw.color }
}

export function parseStoreData(raw: unknown): StoreData {
  if (!isRecord(raw)) {
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

  const repos = parseRepos(raw.repos)
  const worktrees = parseWorktrees(raw.worktrees, new Set((repos ?? []).map((r) => r.id)))
  const worktreeIds = new Set((worktrees ?? []).map((w) => w.id))
  // A session whose worktree is malformed or missing is dropped; every other session is kept.
  const sessions = raw.sessions
    .filter((s) => !hasUnknownWorktreeRef(s, worktreeIds))
    .map(parseSession)
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

  // Invalid presets are dropped one by one (D49); the file itself is kept.
  const presets = parsePresets(raw.presets, groupIds, statusIds)

  // An invalid stored settings value is dropped (undefined = defaults); the file itself is kept.
  const settings = raw.settings === undefined ? undefined : parseStoredSettings(raw.settings, statuses)

  return {
    version: STORE_VERSION,
    sessions: repairedSessions,
    groups,
    statuses,
    groupOrder: [...raw.groupOrder],
    ...(settings !== undefined ? { settings } : {}),
    ...(repos !== undefined ? { repos } : {}),
    ...(worktrees !== undefined ? { worktrees } : {}),
    ...(presets !== undefined ? { presets } : {})
  }
}

/** Best-effort copy of the last known-good store, so a later corruption can be recovered by hand. */
async function backupStoreFile(path: string): Promise<void> {
  try {
    await copyFile(path, `${path}.bak`)
  } catch {
    // A backup must never stop the app from starting; the live file is still valid at this point.
  }
}

export async function loadStoreFile(path: string): Promise<ParsedResult> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { data: emptyStore() }
    }
    // A locked, unreadable or permission-denied file is NOT corrupt. Renaming it here (and then saving an empty
    // store over it) would lose the user's data. Let the caller stop startup and leave the file untouched.
    throw error
  }

  let data: StoreData
  try {
    const parsed = JSON.parse(text) as unknown
    data = parseStoreData(parsed)
  } catch (error) {
    const timestamp = Date.now()
    const corruptPath = `${path}.corrupt-${timestamp}`
    try {
      await rename(path, corruptPath)
    } catch {
      // Best-effort rename; ignore failure so we still return a usable store.
    }

    const reason = errorMessage(error)
    return {
      data: emptyStore(),
      warning: `Store file was corrupt (${reason}); renamed to ${corruptPath}. ` +
        `A copy of the last successful load is kept at ${path}.bak when one exists.`
    }
  }

  await backupStoreFile(path)
  return { data }
}

/**
 * Serializes saves inside this process: two overlapping saves (timer + flush) file-by-file must never
 * rename over each other. The public function still returns ITS OWN promise, so callers keep their error.
 */
let saveChain: Promise<void> = Promise.resolve()

/** Windows can transiently lock a just-replaced file (indexer/AV); a rename retry keeps a save from failing. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
    }
  }
  throw lastError
}

export async function saveStoreFile(path: string, data: StoreData): Promise<void> {
  const run = async (): Promise<void> => {
    const parent = dirname(path)
    await mkdir(parent, { recursive: true })
    // A unique temp name per write: a save that overlaps another one (timer + flush) must not share a file.
    const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
      await renameWithRetry(tmpPath, path)
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
  const next = saveChain.then(run)
  saveChain = next.then(() => undefined, () => undefined)
  return next
}

/** A pending save is written this long after the first unsaved change, even while changes keep arriving. */
export const DEFAULT_MAX_WAIT_MS = 5000

export interface DebouncedSaverDeps {
  readonly setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly clearTimeout?: (id: ReturnType<typeof setTimeout>) => void
  readonly save?: (path: string, data: StoreData) => Promise<void>
  /** Called when a timer-triggered write fails. Flushes reject to their caller instead. */
  readonly onError?: (error: unknown) => void
  /** Upper bound between the first unsaved change and its write. Defaults to DEFAULT_MAX_WAIT_MS. */
  readonly maxWaitMs?: number
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
  const maxWaitMs = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
  const onError = deps.onError ?? ((error: unknown): void => {
    console.error('SessionDeck: saving the store failed', error)
  })

  let timer: ReturnType<typeof setTimeout> | null = null
  /** Bounds a burst: started by the first unsaved change and NOT restarted by later ones. */
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null
  let pending: StoreData | null = null
  // Every save waits for the previous one: the temp file and the final rename are never concurrent.
  let chain: Promise<void> = Promise.resolve()

  function clearTimers(): void {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    if (maxWaitTimer !== null) {
      clearTimer(maxWaitTimer)
      maxWaitTimer = null
    }
  }

  /** Writes the newest pending state after any in-flight save. Resolves when that write has finished. */
  const writePending = (): Promise<void> => {
    const data = pending
    pending = null
    clearTimers()
    if (data === null) return chain

    const write = chain.then(() => save(path, data))
    // Keep the queue usable after a failure; the caller of this write still sees the rejection.
    chain = write.catch(() => undefined)
    return write
  }

  return {
    schedule(data) {
      pending = data
      if (timer !== null) {
        clearTimer(timer)
      }
      timer = setTimer(() => {
        void writePending().catch(onError)
      }, delayMs)
      // A store write about once a second would keep restarting the debounce timer forever: the max wait
      // guarantees the first unsaved change reaches disk even during a busy period.
      if (maxWaitTimer === null) {
        maxWaitTimer = setTimer(() => {
          void writePending().catch(onError)
        }, maxWaitMs)
      }
    },
    async flush() {
      clearTimers()
      await writePending()
    }
  }
}
