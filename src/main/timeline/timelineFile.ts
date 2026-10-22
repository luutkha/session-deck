import { readFile, rename, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TimelineTurn, TurnEnd } from '../../shared/types'
import { TIMELINE_MAX_AGE_DAYS, TIMELINE_PROMPT_MAX } from '../../shared/types'

export const TIMELINE_FILE_NAME = 'sessiondeck-timeline.json'
export const TIMELINE_FILE_VERSION = 1

const DAY_MS = 86_400_000
const MAX_TURN_ID_LENGTH = 100
const MAX_SESSION_ID_LENGTH = 200
const TURN_ENDS: readonly string[] = ['finished', 'limit', 'slept', 'closed', 'exited']

export type TimelineErrorHandler = (where: string, error: unknown) => void

export function timelineFilePath(userDataDir: string): string {
  return path.join(userDataDir, TIMELINE_FILE_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isTurnEnd(value: unknown): value is TurnEnd {
  return typeof value === 'string' && TURN_ENDS.includes(value)
}

/** Cuts a prompt to TIMELINE_PROMPT_MAX code points (an emoji is never split). */
function cutPrompt(prompt: string): string {
  return Array.from(prompt).slice(0, TIMELINE_PROMPT_MAX).join('')
}

/**
 * Validates one stored turn. Returns null when any field is missing or has the wrong type, or when the turn is
 * older than the retention window. A turn saved while still running (end null) comes back as 'exited'.
 */
function parseTurn(value: unknown, cutoff: number): TimelineTurn | null {
  if (!isRecord(value)) return null
  const { id, sessionId, prompt, startedAt, endedAt, end, costUsd, neededYou } = value
  if (!isBoundedString(id, MAX_TURN_ID_LENGTH) || !isBoundedString(sessionId, MAX_SESSION_ID_LENGTH)) return null
  if (typeof prompt !== 'string') return null
  if (!isFiniteNumber(startedAt) || startedAt < 0 || startedAt < cutoff) return null
  if (typeof neededYou !== 'boolean') return null
  if (costUsd !== null && (!isFiniteNumber(costUsd) || costUsd < 0)) return null

  const base = {
    id,
    sessionId,
    prompt: cutPrompt(prompt),
    startedAt,
    costUsd,
    neededYou
  }
  if (end === null) {
    return { ...base, endedAt: startedAt, end: 'exited' }
  }
  if (!isTurnEnd(end)) return null
  if (!isFiniteNumber(endedAt) || endedAt < startedAt) return null
  return { ...base, endedAt, end }
}

/**
 * Validates untrusted JSON from the timeline file. Returns null when the document itself has the wrong shape
 * (not an object, another version, no turns array). Invalid turns and duplicate ids are dropped one by one.
 */
export function parseTimelineFile(raw: unknown, now: number): TimelineTurn[] | null {
  if (!isRecord(raw) || raw.version !== TIMELINE_FILE_VERSION || !Array.isArray(raw.turns)) return null
  const cutoff = now - TIMELINE_MAX_AGE_DAYS * DAY_MS
  const seen = new Set<string>()
  const turns: TimelineTurn[] = []
  for (const item of raw.turns) {
    const turn = parseTurn(item, cutoff)
    if (turn === null) continue
    const key = `${turn.sessionId}\n${turn.id}`
    if (seen.has(key)) continue
    seen.add(key)
    turns.push(turn)
  }
  return turns
}

export function serializeTimelineFile(turns: readonly TimelineTurn[]): string {
  return JSON.stringify({ version: TIMELINE_FILE_VERSION, turns }, null, 2)
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

/**
 * Reads the timeline file. A missing file is an empty timeline without an error. An unreadable, corrupt or
 * wrong-shape file is an empty timeline and is reported through onError (never thrown).
 */
export async function loadTimelineFile(
  filePath: string,
  now: number,
  onError: TimelineErrorHandler
): Promise<TimelineTurn[]> {
  let text: string
  try {
    text = await readFile(filePath, 'utf-8')
  } catch (error) {
    if (!isNotFound(error)) onError('timeline load', error)
    return []
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    onError('timeline load', error)
    return []
  }

  const turns = parseTimelineFile(raw, now)
  if (turns === null) {
    onError('timeline load', new Error('timeline file has an unexpected shape'))
    return []
  }
  return turns
}

/** Writes to `<file>.tmp` first, then renames it over the target, so a crash never leaves half a file. */
export async function saveTimelineFile(filePath: string, turns: readonly TimelineTurn[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  await writeFile(tmp, serializeTimelineFile(turns), 'utf-8')
  await rename(tmp, filePath)
}
