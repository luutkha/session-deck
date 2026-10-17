// Module-level store for sound settings. Compatible with useSyncExternalStore (stable get, subscribe returns unsubscribe).
import {
  LEGACY_SOUND_KEY,
  SOUND_SETTINGS_STORAGE_KEY,
  DEFAULT_SOUND_SETTINGS,
  migrateLegacyEnabled,
  parseSoundSettings,
  serializeSoundSettings,
  withSettingsPatch,
  type SoundSettings,
  type SoundSettingsPatch
} from './soundSettings'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface SoundStore {
  get(): SoundSettings
  set(next: SoundSettings): void
  update(patch: SoundSettingsPatch): void
  subscribe(listener: () => void): () => void
}

interface LoadResult {
  readonly settings: SoundSettings
  readonly migrated: boolean
}

function readItem(storage: StorageLike | null, key: string): string | null {
  if (storage === null) {
    return null
  }
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function loadInitial(storage: StorageLike | null): LoadResult {
  const stored = readItem(storage, SOUND_SETTINGS_STORAGE_KEY)
  if (stored !== null) {
    return { settings: parseSoundSettings(stored), migrated: false }
  }
  const enabled = migrateLegacyEnabled(readItem(storage, LEGACY_SOUND_KEY))
  if (enabled === null) {
    return { settings: DEFAULT_SOUND_SETTINGS, migrated: false }
  }
  return { settings: withSettingsPatch(DEFAULT_SOUND_SETTINGS, { enabled }), migrated: true }
}

export function createSoundStore(storage: StorageLike | null): SoundStore {
  const loaded = loadInitial(storage)
  const listeners = new Set<() => void>()
  let current: SoundSettings = loaded.settings

  function persist(settings: SoundSettings): void {
    if (storage === null) {
      return
    }
    try {
      storage.setItem(SOUND_SETTINGS_STORAGE_KEY, serializeSoundSettings(settings))
    } catch (error: unknown) {
      console.warn('SessionDeck: could not save sound settings; they last this session only', error)
    }
  }

  function commit(next: SoundSettings): void {
    if (serializeSoundSettings(next) === serializeSoundSettings(current)) {
      return
    }
    current = next
    persist(next)
    for (const listener of [...listeners]) {
      listener()
    }
  }

  if (loaded.migrated) {
    persist(current)
  }

  return {
    get(): SoundSettings {
      return current
    },
    set(next: SoundSettings): void {
      commit(
        withSettingsPatch(next, {
          enabled: next.enabled,
          volume: next.volume,
          perReason: next.perReason
        })
      )
    },
    update(patch: SoundSettingsPatch): void {
      commit(withSettingsPatch(current, patch))
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return (): void => {
        listeners.delete(listener)
      }
    }
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The app-wide store. Node tests have no localStorage, so it starts from defaults there. */
export const soundStore: SoundStore = createSoundStore(browserStorage())
