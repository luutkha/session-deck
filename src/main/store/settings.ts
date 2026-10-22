import type {
  AppSettings,
  AutoStatusSettings,
  Id,
  SettingsPatch,
  StatusDef,
  StoreData
} from '../../shared/types'
import { resolveSettings, MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'
import { MAX_OPENCODE_MODEL_LENGTH, OPENCODE_MODEL_RE } from '../opencode/values'

export const SETTINGS_SECTIONS = ['autoStatus', 'tray', 'quota', 'sleep', 'agents', 'hub'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

const AUTO_STATUS_KEYS = ['working', 'needsInput', 'finished'] as const

type FieldCheck = (value: unknown) => boolean

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isBoolean: FieldCheck = (value) => typeof value === 'boolean'
const isInteger: FieldCheck = (value) => typeof value === 'number' && Number.isInteger(value)
/** A status id (non-empty string) or null = no mapping. */
const isIdOrNull: FieldCheck = (value) => value === null || (typeof value === 'string' && value.length > 0)
const isAgentKind: FieldCheck = (value) => value === 'claude' || value === 'opencode'
/** The OpenCode model may be empty (OpenCode's own default). */
const isOpencodeModelString: FieldCheck = (value) =>
  typeof value === 'string' && value.length <= MAX_OPENCODE_MODEL_LENGTH && OPENCODE_MODEL_RE.test(value)

const FIELD_CHECKS: { readonly [S in SettingsSection]: Readonly<Record<string, FieldCheck>> } = {
  autoStatus: {
    enabled: isBoolean,
    working: isIdOrNull,
    needsInput: isIdOrNull,
    finished: isIdOrNull
  },
  tray: {
    closeToTray: isBoolean,
    desktopNotifications: isBoolean,
    notifyOnlyWhenUnfocused: isBoolean
  },
  quota: {
    enabled: isBoolean,
    warnAtPercent: isInteger,
    criticalAtPercent: isInteger,
    notifyOnReset: isBoolean
  },
  sleep: {
    enabled: isBoolean,
    afterMinutes: isInteger,
    allEnabled: isBoolean,
    allAfterMinutes: isInteger
  },
  agents: {
    defaultAgent: isAgentKind,
    opencodeModel: isOpencodeModelString
  },
  hub: {
    scrollToBusiest: isBoolean
  }
}

/** Known field names of a settings section (used to reject unknown keys in IPC payloads). */
export function settingsFieldNames(section: SettingsSection): readonly string[] {
  return Object.keys(FIELD_CHECKS[section])
}

/**
 * Picks the known fields of one section whose values are present and have the right primitive type.
 * Missing section or missing field = empty result. Unknown keys are dropped.
 * Returns null when the section is not an object or a present field has the wrong type.
 * Range rules are NOT checked here (see settingsProblem).
 */
export function pickSectionFields(section: SettingsSection, raw: unknown): Record<string, unknown> | null {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) return null
  const checks = FIELD_CHECKS[section]
  const picked: Record<string, unknown> = {}
  for (const key of Object.keys(checks)) {
    const value = raw[key]
    if (value === undefined) continue
    if (!checks[key](value)) return null
    picked[key] = value
  }
  return picked
}

/** An integer minute count within the sleep range (both idle timers use the same range). */
function isSleepMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SLEEP_MINUTES && value <= MAX_SLEEP_MINUTES
}

/** Returns the first problem with a complete settings object (types, ranges, warn < critical), or null when valid. */
export function settingsProblem(settings: AppSettings): string | null {
  const auto = settings.autoStatus
  if (typeof auto.enabled !== 'boolean') return 'autoStatus.enabled must be a boolean'
  for (const key of AUTO_STATUS_KEYS) {
    if (!isIdOrNull(auto[key])) return `autoStatus.${key} must be a status id or null`
  }

  const tray = settings.tray
  if (typeof tray.closeToTray !== 'boolean') return 'tray.closeToTray must be a boolean'
  if (typeof tray.desktopNotifications !== 'boolean') return 'tray.desktopNotifications must be a boolean'
  if (typeof tray.notifyOnlyWhenUnfocused !== 'boolean') return 'tray.notifyOnlyWhenUnfocused must be a boolean'

  const quota = settings.quota
  if (typeof quota.enabled !== 'boolean') return 'quota.enabled must be a boolean'
  if (!Number.isInteger(quota.warnAtPercent) || quota.warnAtPercent < 1 || quota.warnAtPercent > 99) {
    return 'quota.warnAtPercent must be an integer from 1 to 99'
  }
  if (!Number.isInteger(quota.criticalAtPercent) || quota.criticalAtPercent < 2 || quota.criticalAtPercent > 100) {
    return 'quota.criticalAtPercent must be an integer from 2 to 100'
  }
  if (quota.criticalAtPercent <= quota.warnAtPercent) {
    return 'quota.criticalAtPercent must be greater than quota.warnAtPercent'
  }
  if (typeof quota.notifyOnReset !== 'boolean') return 'quota.notifyOnReset must be a boolean'

  const sleep = settings.sleep
  if (typeof sleep.enabled !== 'boolean') return 'sleep.enabled must be a boolean'
  if (!isSleepMinutes(sleep.afterMinutes)) {
    return `sleep.afterMinutes must be an integer from ${MIN_SLEEP_MINUTES} to ${MAX_SLEEP_MINUTES}`
  }
  if (typeof sleep.allEnabled !== 'boolean') return 'sleep.allEnabled must be a boolean'
  if (!isSleepMinutes(sleep.allAfterMinutes)) {
    return `sleep.allAfterMinutes must be an integer from ${MIN_SLEEP_MINUTES} to ${MAX_SLEEP_MINUTES}`
  }

  const agents = settings.agents
  if (agents.defaultAgent !== 'claude' && agents.defaultAgent !== 'opencode') {
    return 'agents.defaultAgent must be "claude" or "opencode"'
  }
  if (
    typeof agents.opencodeModel !== 'string' ||
    agents.opencodeModel.length > MAX_OPENCODE_MODEL_LENGTH ||
    !OPENCODE_MODEL_RE.test(agents.opencodeModel)
  ) {
    return `agents.opencodeModel must be a model id of at most ${MAX_OPENCODE_MODEL_LENGTH} characters (letters, digits, ._:/@+-), or empty`
  }

  if (typeof settings.hub.scrollToBusiest !== 'boolean') return 'hub.scrollToBusiest must be a boolean'

  return null
}

/** Sets every autoStatus mapping that points at a status missing from `statusIds` to null. */
function repairStatusRefs(settings: AppSettings, statusIds: ReadonlySet<Id>): AppSettings {
  const auto = settings.autoStatus
  const fix = (ref: Id | null): Id | null => (ref !== null && !statusIds.has(ref) ? null : ref)
  const nextAuto: AutoStatusSettings = {
    ...auto,
    working: fix(auto.working),
    needsInput: fix(auto.needsInput),
    finished: fix(auto.finished)
  }
  return { ...settings, autoStatus: nextAuto }
}

/**
 * Parses the persisted `settings` value. Returns undefined (= dropped, the store keeps the file) when the value is
 * not an object, a present field has the wrong type, or the merged result breaks a range rule. Missing fields take
 * their defaults. Mappings to unknown statuses are reset to null, like dangling session statuses.
 */
export function parseStoredSettings(raw: unknown, statuses: readonly StatusDef[]): AppSettings | undefined {
  if (!isPlainObject(raw)) return undefined

  const autoStatus = pickSectionFields('autoStatus', raw.autoStatus)
  const tray = pickSectionFields('tray', raw.tray)
  const quota = pickSectionFields('quota', raw.quota)
  const sleep = pickSectionFields('sleep', raw.sleep)
  const agents = pickSectionFields('agents', raw.agents)
  const hub = pickSectionFields('hub', raw.hub)
  if (autoStatus === null || tray === null || quota === null || sleep === null || agents === null || hub === null) {
    return undefined
  }

  const merged = resolveSettings({
    autoStatus: autoStatus as Partial<AutoStatusSettings>,
    tray: tray as Partial<AppSettings['tray']>,
    quota: quota as Partial<AppSettings['quota']>,
    sleep: sleep as Partial<AppSettings['sleep']>,
    agents: agents as Partial<AppSettings['agents']>,
    hub: hub as Partial<AppSettings['hub']>
  })
  if (settingsProblem(merged) !== null) return undefined

  return repairStatusRefs(merged, new Set(statuses.map((s) => s.id)))
}

/** Copies a partial section without its undefined values (an explicit undefined never overwrites a value). */
function definedFields<T extends object>(value: Partial<T> | undefined): Partial<T> {
  if (value === undefined) return {}
  const out: Partial<T> = {}
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) {
      out[key] = value[key]
    }
  }
  return out
}

/**
 * Merges a patch onto the current resolved settings and stores the full result.
 * Throws `Invalid settings: <reason>` for a range/type problem or a mapping to an unknown status.
 */
export function updateSettings(data: StoreData, patch: SettingsPatch): StoreData {
  const current = resolveSettings(data.settings)
  const next: AppSettings = {
    autoStatus: { ...current.autoStatus, ...definedFields(patch.autoStatus) },
    tray: { ...current.tray, ...definedFields(patch.tray) },
    quota: { ...current.quota, ...definedFields(patch.quota) },
    sleep: { ...current.sleep, ...definedFields(patch.sleep) },
    agents: { ...current.agents, ...definedFields(patch.agents) },
    hub: { ...current.hub, ...definedFields(patch.hub) }
  }

  const problem = settingsProblem(next)
  if (problem !== null) {
    throw new Error(`Invalid settings: ${problem}`)
  }

  const statusIds = new Set(data.statuses.map((s) => s.id))
  for (const key of AUTO_STATUS_KEYS) {
    const ref = next.autoStatus[key]
    if (ref !== null && !statusIds.has(ref)) {
      throw new Error(`Invalid settings: autoStatus.${key} refers to unknown status ${ref}`)
    }
  }

  return { ...data, settings: next }
}

/**
 * Returns the settings to store after a status is removed: every autoStatus mapping to it becomes null.
 * Returns the stored value unchanged (possibly undefined) when nothing points at the status.
 */
export function clearAutoStatusReference(data: StoreData, id: Id): AppSettings | undefined {
  const current = resolveSettings(data.settings)
  const auto = current.autoStatus
  const referenced = AUTO_STATUS_KEYS.some((key) => auto[key] === id)
  if (!referenced) return data.settings

  const cleared = (ref: Id | null): Id | null => (ref === id ? null : ref)
  return {
    ...current,
    autoStatus: {
      ...auto,
      working: cleared(auto.working),
      needsInput: cleared(auto.needsInput),
      finished: cleared(auto.finished)
    }
  }
}
