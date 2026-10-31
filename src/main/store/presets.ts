// Session presets (D49): saved New Session forms. Pure: shape checks and immutable store updates.
import { PRESET_MAX, PRESET_NAME_MAX, type AgentKind, type Id, type SessionPreset, type StoreData } from '../../shared/types'
import { isRecord } from '../../shared/guards'

const MAX_ID_LENGTH = 256
const MAX_CWD_LENGTH = 4096
const MAX_MODEL_LENGTH = 200
const MAX_ARGS = 100
const MAX_ARG_LENGTH = 4096

function invalid(reason: string): Error {
  return new Error(`Invalid preset: ${reason}`)
}

function isAgent(value: unknown): value is AgentKind {
  return value === 'claude' || value === 'opencode' || value === 'shell'
}

function optionalId(value: unknown, field: string): Id | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) throw invalid(`${field} must be an id or null`)
  return value
}

/**
 * Checks the shape of one preset and returns it normalized (name trimmed; model and args only for the agents that use
 * them). The Claude argument safety rule is applied again by session:create when the preset is used.
 */
export function validatePreset(raw: unknown): SessionPreset {
  if (!isRecord(raw)) throw invalid('must be an object')
  const { id, name, cwd, agent, model, claudeArgs } = raw
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) throw invalid('id must be a non-empty string')
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > PRESET_NAME_MAX) {
    throw invalid(`name must be 1 to ${PRESET_NAME_MAX} characters`)
  }
  if (typeof cwd !== 'string' || cwd.trim().length === 0 || cwd.length > MAX_CWD_LENGTH) throw invalid('folder is required')
  if (!isAgent(agent)) throw invalid('agent must be "claude", "opencode" or "shell"')
  if (model !== undefined && (typeof model !== 'string' || model.length > MAX_MODEL_LENGTH)) throw invalid('model must be a string')
  if (
    !Array.isArray(claudeArgs) ||
    claudeArgs.length > MAX_ARGS ||
    !claudeArgs.every((arg) => typeof arg === 'string' && arg.length > 0 && arg.length <= MAX_ARG_LENGTH)
  ) {
    throw invalid('claudeArgs must be a list of strings')
  }
  const groupId = optionalId(raw.groupId, 'groupId')
  const statusId = optionalId(raw.statusId, 'statusId')
  const trimmedModel = typeof model === 'string' ? model.trim() : ''
  return {
    id,
    name: name.trim(),
    cwd: cwd.trim(),
    agent,
    ...(agent === 'opencode' && trimmedModel.length > 0 ? { model: trimmedModel } : {}),
    claudeArgs: agent === 'claude' ? [...claudeArgs] : [],
    groupId,
    statusId
  }
}

/**
 * Stored presets: each invalid entry is dropped (never the whole file), duplicates keep the first, at most PRESET_MAX,
 * and a group or status that no longer exists becomes null. Absent or empty = undefined (field absent).
 */
export function parsePresets(raw: unknown, groupIds: ReadonlySet<Id>, statusIds: ReadonlySet<Id>): SessionPreset[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<Id>()
  const presets: SessionPreset[] = []
  for (const entry of raw) {
    let preset: SessionPreset
    try {
      preset = validatePreset(entry)
    } catch {
      continue
    }
    if (seen.has(preset.id) || presets.length >= PRESET_MAX) continue
    seen.add(preset.id)
    presets.push({
      ...preset,
      groupId: preset.groupId !== null && groupIds.has(preset.groupId) ? preset.groupId : null,
      statusId: preset.statusId !== null && statusIds.has(preset.statusId) ? preset.statusId : null
    })
  }
  return presets.length > 0 ? presets : undefined
}

/** Adds a preset, or replaces the one with the same id in place. Throws when a new one would exceed PRESET_MAX. */
export function upsertPreset(data: StoreData, raw: unknown): StoreData {
  const preset = validatePreset(raw)
  const current = data.presets ?? []
  const index = current.findIndex((p) => p.id === preset.id)
  if (index < 0 && current.length >= PRESET_MAX) throw invalid(`at most ${PRESET_MAX} presets`)
  const presets = index < 0 ? [...current, preset] : current.map((p, i) => (i === index ? preset : p))
  return { ...data, presets }
}

/** Removes a preset; an unknown id changes nothing. The field is dropped when the list becomes empty. */
export function removePreset(data: StoreData, id: Id): StoreData {
  const current = data.presets ?? []
  if (!current.some((p) => p.id === id)) return data
  const presets = current.filter((p) => p.id !== id)
  const { presets: _presets, ...rest } = data
  return presets.length > 0 ? { ...rest, presets } : rest
}
