// Small persisted UI preferences. localStorage can throw (quota, privacy modes), so every access is guarded.
export const SOUND_STORAGE_KEY = 'sessiondeck-sound-enabled'
export const SIDEBAR_STORAGE_KEY = 'sessiondeck-sidebar-open'

export function parseBooleanPref(raw: string | null, fallback: boolean): boolean {
  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  return fallback
}

function getStorage(): Storage | null {
  if (typeof localStorage === 'undefined') {
    return null
  }
  return localStorage
}

export function readStorageItem(key: string): string | null {
  const storage = getStorage()
  if (storage === null) {
    return null
  }
  try {
    return storage.getItem(key)
  } catch (error) {
    console.warn(`SessionDeck: could not read "${key}" from storage; using the default`, error)
    return null
  }
}

export function writeStorageItem(key: string, value: string): void {
  const storage = getStorage()
  if (storage === null) {
    return
  }
  try {
    storage.setItem(key, value)
  } catch (error) {
    console.warn(`SessionDeck: could not save "${key}" to storage; the value lasts this session only`, error)
  }
}
