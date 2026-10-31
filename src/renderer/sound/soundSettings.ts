// Pure notification-sound settings model: parsing (never throws), serializing, file URLs and labels.
import type { AttentionReason, SoundEvent } from '../../shared/types'
import { BUILTIN_SOUNDS } from './builtinSounds'
import { SOUND_STORAGE_KEY as LEGACY_SOUND_ENABLED_KEY } from '../shell/shellPrefs'
import { isRecord } from '../../shared/guards'

export type BuiltinSoundId = 'chime' | 'ping' | 'pop' | 'bell' | 'marimba' | 'soft'

export type SoundChoice =
  | { readonly kind: 'builtin'; readonly id: BuiltinSoundId }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'none' }

export interface SoundSettings {
  readonly enabled: boolean
  readonly volume: number // 0..1
  readonly perReason: Readonly<Record<SoundEvent, SoundChoice>>
}

/** Partial update accepted by the store. `perReason` entries are merged per event. */
export interface SoundSettingsPatch {
  readonly enabled?: boolean
  readonly volume?: number
  readonly perReason?: Readonly<Partial<Record<SoundEvent, SoundChoice>>>
}

export const SOUND_SETTINGS_STORAGE_KEY = 'sessiondeck.sound.v1'
export const ATTENTION_REASONS: readonly Exclude<AttentionReason, 'unread'>[] = ['permission', 'done', 'idle', 'bell']
/** Every event a sound can be configured for. */
export const SOUND_EVENTS: readonly SoundEvent[] = [...ATTENTION_REASONS, 'quota']
export const BUILTIN_SOUND_IDS: readonly BuiltinSoundId[] = ['chime', 'ping', 'pop', 'bell', 'marimba', 'soft']
export const DEFAULT_VOLUME = 0.7

export const DEFAULT_PER_REASON: Readonly<Record<SoundEvent, SoundChoice>> = {
  permission: { kind: 'builtin', id: 'bell' },
  done: { kind: 'builtin', id: 'chime' },
  idle: { kind: 'builtin', id: 'soft' },
  bell: { kind: 'builtin', id: 'ping' },
  quota: { kind: 'builtin', id: 'bell' }
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: DEFAULT_VOLUME,
  perReason: DEFAULT_PER_REASON
}

/** The old on/off key (shellPrefs.SOUND_STORAGE_KEY), read only when the new key does not exist yet. */
export const LEGACY_SOUND_KEY: string = LEGACY_SOUND_ENABLED_KEY

function isBuiltinId(value: unknown): value is BuiltinSoundId {
  return typeof value === 'string' && (BUILTIN_SOUND_IDS as readonly string[]).includes(value)
}

/** Clamps to 0..1; non-finite input maps to the default volume. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOLUME
  }
  return Math.min(1, Math.max(0, value))
}

function parseChoice(value: unknown, fallback: SoundChoice): SoundChoice {
  if (!isRecord(value)) {
    return fallback
  }
  switch (value['kind']) {
    case 'builtin': {
      const id = value['id']
      return isBuiltinId(id) ? { kind: 'builtin', id } : fallback
    }
    case 'file': {
      const path = value['path']
      return typeof path === 'string' && path.trim() !== '' ? { kind: 'file', path } : fallback
    }
    case 'none':
      return { kind: 'none' }
    default:
      return fallback
  }
}

/** Never throws. Corrupt JSON, wrong types, unknown ids and bad paths fall back per field. */
export function parseSoundSettings(raw: string | null): SoundSettings {
  if (raw === null) {
    return DEFAULT_SOUND_SETTINGS
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return DEFAULT_SOUND_SETTINGS
  }
  if (!isRecord(data)) {
    return DEFAULT_SOUND_SETTINGS
  }
  const perRaw: Record<string, unknown> = isRecord(data['perReason']) ? data['perReason'] : {}
  const volumeRaw = data['volume']
  return {
    enabled: typeof data['enabled'] === 'boolean' ? data['enabled'] : DEFAULT_SOUND_SETTINGS.enabled,
    volume: typeof volumeRaw === 'number' ? clampVolume(volumeRaw) : DEFAULT_VOLUME,
    perReason: {
      permission: parseChoice(perRaw['permission'], DEFAULT_PER_REASON.permission),
      done: parseChoice(perRaw['done'], DEFAULT_PER_REASON.done),
      idle: parseChoice(perRaw['idle'], DEFAULT_PER_REASON.idle),
      bell: parseChoice(perRaw['bell'], DEFAULT_PER_REASON.bell),
      quota: parseChoice(perRaw['quota'], DEFAULT_PER_REASON.quota)
    }
  }
}

/** Writes only the known keys. */
export function serializeSoundSettings(settings: SoundSettings): string {
  return JSON.stringify({
    enabled: settings.enabled,
    volume: clampVolume(settings.volume),
    perReason: {
      permission: settings.perReason.permission,
      done: settings.perReason.done,
      idle: settings.perReason.idle,
      bell: settings.perReason.bell,
      quota: settings.perReason.quota
    }
  })
}

/** Returns a new settings object with the patch applied. The input is never mutated. */
export function withSettingsPatch(base: SoundSettings, patch: SoundSettingsPatch): SoundSettings {
  const perReason: Record<SoundEvent, SoundChoice> = {
    permission: patch.perReason?.permission ?? base.perReason.permission,
    done: patch.perReason?.done ?? base.perReason.done,
    idle: patch.perReason?.idle ?? base.perReason.idle,
    bell: patch.perReason?.bell ?? base.perReason.bell,
    quota: patch.perReason?.quota ?? base.perReason.quota
  }
  return {
    enabled: patch.enabled ?? base.enabled,
    volume: patch.volume === undefined ? base.volume : clampVolume(patch.volume),
    perReason
  }
}

/** Maps the legacy on/off value to a boolean; null when the value is not recognised. */
export function migrateLegacyEnabled(raw: string | null): boolean | null {
  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  return null
}

function encodeSegments(path: string): string {
  return path
    .split('/')
    .map((segment: string): string => encodeURIComponent(segment))
    .join('/')
}

/**
 * Converts an absolute Windows or POSIX path to a file:/// URL.
 * Backslashes become slashes; spaces, #, ?, %, and non-ASCII are percent-encoded per segment.
 */
export function fileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('//')) {
    const rest = normalized.slice(2)
    const slash = rest.indexOf('/')
    const host = slash < 0 ? rest : rest.slice(0, slash)
    const tail = slash < 0 ? '' : rest.slice(slash)
    return `file://${encodeURIComponent(host)}${encodeSegments(tail)}`
  }
  const drive = /^([A-Za-z]:)(\/.*)?$/.exec(normalized)
  if (drive !== null) {
    return `file:///${drive[1]}${encodeSegments(drive[2] ?? '')}`
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeSegments(normalized)}`
  }
  return `file:///${encodeSegments(normalized)}`
}

/** Last path segment, for either separator. */
export function fileBaseName(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment: string): boolean => segment !== '')
  return segments[segments.length - 1] ?? path
}

export function describeChoice(choice: SoundChoice): string {
  switch (choice.kind) {
    case 'builtin':
      return BUILTIN_SOUNDS[choice.id].label
    case 'file':
      return `Custom: ${fileBaseName(choice.path)}`
    case 'none':
      return 'None'
  }
}
