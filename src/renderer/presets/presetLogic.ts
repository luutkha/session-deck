// Session presets (D49): turning the New Session form into a preset and back. Pure: no React, no IPC.
import type { AgentKind, CreateSessionInput, Id, SessionPreset, StoreData } from '../../shared/types'
import { PRESET_NAME_MAX } from '../../shared/types'
import { REMOTE_CONTROL_FLAG, defaultNameFromFolder } from '../Sidebar/dialogLogic'

/** The New Session dialog fields a preset fills in. */
export interface PresetForm {
  readonly agent: AgentKind
  readonly folder: string
  readonly groupId: Id | null
  readonly statusId: Id | null
  readonly argsRaw: string
  readonly modelRaw: string
  readonly remoteControl: boolean
}

/** A preset from a validated create input (buildCreateInput) and a name. */
export function presetFromInput(input: CreateSessionInput, name: string, id: string): SessionPreset {
  const agent: AgentKind = input.agent ?? 'claude'
  return {
    id,
    name: name.trim().slice(0, PRESET_NAME_MAX),
    cwd: input.cwd,
    agent,
    ...(agent === 'opencode' && input.model !== undefined && input.model.length > 0 ? { model: input.model } : {}),
    claudeArgs: agent === 'claude' ? [...(input.claudeArgs ?? [])] : [],
    groupId: input.groupId ?? null,
    statusId: input.statusId ?? null
  }
}

/** The dialog fields for a preset; Remote Control is a checkbox in the form, not a raw argument. */
export function formFromPreset(preset: SessionPreset): PresetForm {
  return {
    agent: preset.agent,
    folder: preset.cwd,
    groupId: preset.groupId,
    statusId: preset.statusId,
    argsRaw: preset.claudeArgs.filter((arg) => arg !== REMOTE_CONTROL_FLAG).join(' '),
    modelRaw: preset.model ?? '',
    remoteControl: preset.claudeArgs.includes(REMOTE_CONTROL_FLAG)
  }
}

/** A session:create input for a one-click start. A group or status that no longer exists is left out. */
export function createInputFromPreset(preset: SessionPreset, data: Pick<StoreData, 'groups' | 'statuses'>): CreateSessionInput {
  const groupId = preset.groupId !== null && data.groups.some((g) => g.id === preset.groupId) ? preset.groupId : null
  const statusId = preset.statusId !== null && data.statuses.some((s) => s.id === preset.statusId) ? preset.statusId : null
  return {
    cwd: preset.cwd,
    groupId,
    statusId,
    agent: preset.agent,
    ...(preset.agent === 'claude' ? { claudeArgs: [...preset.claudeArgs] } : {}),
    ...(preset.agent === 'opencode' && preset.model !== undefined ? { model: preset.model } : {})
  }
}

/** Saving under a name that already exists (any case) replaces that preset instead of adding a twin. */
export function presetIdForName(presets: readonly SessionPreset[], name: string, newId: string): string {
  const wanted = name.trim().toLowerCase()
  return presets.find((p) => p.name.toLowerCase() === wanted)?.id ?? newId
}

/** The name offered when saving: the session name if typed, else the folder name. */
export function suggestedPresetName(sessionName: string, folder: string): string {
  const typed = sessionName.trim()
  return (typed.length > 0 ? typed : defaultNameFromFolder(folder)).slice(0, PRESET_NAME_MAX)
}

/** One-line description for menus: folder name and agent (plus model). */
export function presetDetail(preset: SessionPreset): string {
  const agent = preset.agent === 'opencode' ? `OpenCode${preset.model !== undefined ? ` ${preset.model}` : ''}` : preset.agent === 'shell' ? 'Shell' : 'Claude'
  return `${defaultNameFromFolder(preset.cwd)} · ${agent}`
}
