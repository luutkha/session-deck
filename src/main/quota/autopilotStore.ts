import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Id, QuotaAutopilotState } from '../../shared/types'
import { EMPTY_AUTOPILOT_STATE, uniqueIds } from './autopilotPolicy'

export const QUOTA_AUTOPILOT_FILE = 'quota-autopilot.json'
const STATE_VERSION = 1

export function quotaAutopilotFilePath(userDataDir: string): string {
  return path.join(userDataDir, QUOTA_AUTOPILOT_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdList(value: unknown): value is Id[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string' && id.length > 0)
}

/** Validates untrusted JSON. Throws on anything malformed, so the caller can report it and start empty. */
export function parseAutopilotState(raw: unknown): QuotaAutopilotState {
  if (!isRecord(raw) || raw.version !== STATE_VERSION) {
    throw new Error('quota autopilot state: unexpected shape or version')
  }
  const { sleptForQuota, stoppedAtLimit, resetsAt } = raw
  if (!isIdList(sleptForQuota) || !isIdList(stoppedAtLimit)) {
    throw new Error('quota autopilot state: session lists are invalid')
  }
  if (resetsAt !== null && (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt))) {
    throw new Error('quota autopilot state: reset time is invalid')
  }
  return {
    sleptForQuota: uniqueIds(sleptForQuota),
    stoppedAtLimit: uniqueIds(stoppedAtLimit),
    resetsAt
  }
}

export function serializeAutopilotState(state: QuotaAutopilotState): string {
  return JSON.stringify({ version: STATE_VERSION, ...state }, null, 2)
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

/** A missing file is the empty state. A file that exists but is corrupt rejects. */
export async function loadAutopilotState(filePath: string): Promise<QuotaAutopilotState> {
  let text: string
  try {
    text = await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isNotFound(error)) return EMPTY_AUTOPILOT_STATE
    throw error
  }
  return parseAutopilotState(JSON.parse(text))
}

/** Writes to a temporary file first, then renames it over the target, so a crash never leaves half a file. */
export function saveAutopilotState(filePath: string, state: QuotaAutopilotState): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, serializeAutopilotState(state), 'utf-8')
  renameSync(tmp, filePath)
}
