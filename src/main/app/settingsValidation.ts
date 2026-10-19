import type { AgentSettings, AutoStatusSettings, HubSettings, QuotaSettings, SettingsPatch, SleepSettings, TraySettings } from '../../shared/types'
import { SETTINGS_SECTIONS, pickSectionFields, settingsFieldNames, type SettingsSection } from '../store'

function isSection(key: string): key is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(key)
}

/** Validates one section of a patch: an object with only known keys and primitive values. Absent = undefined. */
function sectionOf(obj: Record<string, unknown>, name: SettingsSection): Record<string, unknown> | undefined {
  const value = obj[name]
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid settings: ${name} must be an object`)
  }
  const known = new Set(settingsFieldNames(name))
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      throw new Error(`Invalid settings: unknown key "${name}.${key}"`)
    }
  }
  const picked = pickSectionFields(name, value)
  if (picked === null) {
    throw new Error(`Invalid settings: ${name} has a field with the wrong type`)
  }
  return picked
}

/**
 * IPC payload check for settings:update. Accepts an object with the keys autoStatus / tray / quota / sleep / agents / hub;
 * each section is an object with known keys only and primitive values (booleans, integers, status id or null).
 * Range rules and status existence are checked by the store reducer. Throws `Invalid settings: <reason>`.
 */
export function asSettingsPatch(raw: unknown): SettingsPatch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid settings: patch must be an object')
  }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!isSection(key)) {
      throw new Error(`Invalid settings: unknown key "${key}"`)
    }
  }

  const autoStatus = sectionOf(obj, 'autoStatus')
  const tray = sectionOf(obj, 'tray')
  const quota = sectionOf(obj, 'quota')
  const sleep = sectionOf(obj, 'sleep')
  const agents = sectionOf(obj, 'agents')
  const hub = sectionOf(obj, 'hub')

  return {
    ...(autoStatus !== undefined ? { autoStatus: autoStatus as Partial<AutoStatusSettings> } : {}),
    ...(tray !== undefined ? { tray: tray as Partial<TraySettings> } : {}),
    ...(quota !== undefined ? { quota: quota as Partial<QuotaSettings> } : {}),
    ...(sleep !== undefined ? { sleep: sleep as Partial<SleepSettings> } : {}),
    ...(agents !== undefined ? { agents: agents as Partial<AgentSettings> } : {}),
    ...(hub !== undefined ? { hub: hub as Partial<HubSettings> } : {})
  }
}
