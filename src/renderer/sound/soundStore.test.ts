import { describe, expect, it, vi } from 'vitest'
import { createSoundStore, type StorageLike } from './soundStore'
import {
  DEFAULT_SOUND_SETTINGS,
  LEGACY_SOUND_KEY,
  SOUND_SETTINGS_STORAGE_KEY,
  serializeSoundSettings
} from './soundSettings'

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial))
  return {
    data,
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      data.set(key, value)
    }
  }
}

function createBlockedStorage(): StorageLike {
  return {
    getItem: (): string | null => {
      throw new Error('SecurityError: storage blocked')
    },
    setItem: (): void => {
      throw new Error('QuotaExceededError')
    }
  }
}

describe('createSoundStore loading', () => {
  it('starts from defaults with empty storage and does not write on load', () => {
    const storage = createMemoryStorage()
    const store = createSoundStore(storage)
    expect(store.get()).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(storage.data.size).toBe(0)
  })

  it('loads the new key', () => {
    const storage = createMemoryStorage({
      [SOUND_SETTINGS_STORAGE_KEY]: JSON.stringify({ enabled: false, volume: 0.2 })
    })
    const store = createSoundStore(storage)
    expect(store.get().enabled).toBe(false)
    expect(store.get().volume).toBe(0.2)
  })

  it('backfills the quota default for stored settings without it', () => {
    const storage = createMemoryStorage({
      [SOUND_SETTINGS_STORAGE_KEY]: JSON.stringify({
        enabled: true,
        volume: 0.4,
        perReason: {
          permission: { kind: 'builtin', id: 'chime' },
          done: { kind: 'builtin', id: 'chime' },
          idle: { kind: 'builtin', id: 'soft' },
          bell: { kind: 'builtin', id: 'ping' }
        }
      })
    })
    const store = createSoundStore(storage)
    expect(store.get().perReason.quota).toEqual(DEFAULT_SOUND_SETTINGS.perReason.quota)
    expect(store.get().perReason.permission).toEqual({ kind: 'builtin', id: 'chime' })
  })

  it('survives corrupt stored JSON with defaults', () => {
    const storage = createMemoryStorage({ [SOUND_SETTINGS_STORAGE_KEY]: '{oops' })
    expect(() => createSoundStore(storage)).not.toThrow()
    expect(createSoundStore(storage).get()).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('uses defaults when storage is blocked (reads and writes throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation((): void => undefined)
    const store = createSoundStore(createBlockedStorage())
    expect(store.get()).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(() => store.update({ enabled: false })).not.toThrow()
    expect(store.get().enabled).toBe(false)
    warn.mockRestore()
  })

  it('works with no storage at all', () => {
    const store = createSoundStore(null)
    expect(store.get()).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(() => store.update({ volume: 0.1 })).not.toThrow()
    expect(store.get().volume).toBe(0.1)
  })
})

describe('legacy on/off migration', () => {
  it('reads the old "false" value when the new key is absent and writes the new key', () => {
    const storage = createMemoryStorage({ [LEGACY_SOUND_KEY]: 'false' })
    const store = createSoundStore(storage)
    expect(store.get().enabled).toBe(false)
    expect(storage.data.get(SOUND_SETTINGS_STORAGE_KEY)).toBe(
      serializeSoundSettings({ ...DEFAULT_SOUND_SETTINGS, enabled: false })
    )
  })

  it('reads the old "true" value', () => {
    const storage = createMemoryStorage({ [LEGACY_SOUND_KEY]: 'true' })
    expect(createSoundStore(storage).get().enabled).toBe(true)
  })

  it('ignores an unrecognised legacy value and keeps defaults', () => {
    const storage = createMemoryStorage({ [LEGACY_SOUND_KEY]: 'maybe' })
    const store = createSoundStore(storage)
    expect(store.get()).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(storage.data.has(SOUND_SETTINGS_STORAGE_KEY)).toBe(false)
  })

  it('ignores the legacy key once the new key exists', () => {
    const storage = createMemoryStorage({
      [LEGACY_SOUND_KEY]: 'false',
      [SOUND_SETTINGS_STORAGE_KEY]: JSON.stringify({ enabled: true })
    })
    expect(createSoundStore(storage).get().enabled).toBe(true)
  })
})

describe('createSoundStore updates', () => {
  it('merges a partial update immutably and clamps volume', () => {
    const store = createSoundStore(createMemoryStorage())
    const before = store.get()
    store.update({ volume: 4 })
    const after = store.get()
    expect(after.volume).toBe(1)
    expect(before.volume).toBe(0.7)
    expect(after).not.toBe(before)
    expect(after.perReason).toEqual(DEFAULT_SOUND_SETTINGS.perReason)
  })

  it('merges perReason per reason', () => {
    const store = createSoundStore(createMemoryStorage())
    store.update({ perReason: { done: { kind: 'file', path: 'C:\\Sounds\\ding #1.wav' } } })
    expect(store.get().perReason.done).toEqual({ kind: 'file', path: 'C:\\Sounds\\ding #1.wav' })
    expect(store.get().perReason.bell).toEqual(DEFAULT_SOUND_SETTINGS.perReason.bell)
  })

  it('merges and persists a quota sound choice', () => {
    const storage = createMemoryStorage()
    const store = createSoundStore(storage)
    store.update({ perReason: { quota: { kind: 'builtin', id: 'marimba' } } })
    expect(store.get().perReason.quota).toEqual({ kind: 'builtin', id: 'marimba' })
    expect(store.get().perReason.bell).toEqual(DEFAULT_SOUND_SETTINGS.perReason.bell)
    const reloaded = createSoundStore(storage)
    expect(reloaded.get().perReason.quota).toEqual({ kind: 'builtin', id: 'marimba' })
  })

  it('set() replaces everything and normalises volume', () => {
    const store = createSoundStore(createMemoryStorage())
    store.set({ ...DEFAULT_SOUND_SETTINGS, enabled: false, volume: -2 })
    expect(store.get().enabled).toBe(false)
    expect(store.get().volume).toBe(0)
  })

  it('keeps the same snapshot reference when nothing changes', () => {
    const store = createSoundStore(createMemoryStorage())
    const snapshot = store.get()
    store.update({ enabled: true })
    expect(store.get()).toBe(snapshot)
  })
})

describe('createSoundStore persistence', () => {
  it('persists every change under the new key', () => {
    const storage = createMemoryStorage()
    const store = createSoundStore(storage)
    store.update({ enabled: false })
    store.update({ volume: 0.3 })
    expect(JSON.parse(storage.data.get(SOUND_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      enabled: false,
      volume: 0.3,
      perReason: DEFAULT_SOUND_SETTINGS.perReason
    })
  })

  it('a new store on the same storage sees the saved change', () => {
    const storage = createMemoryStorage()
    createSoundStore(storage).update({ enabled: false, volume: 0.25 })
    const reloaded = createSoundStore(storage)
    expect(reloaded.get().enabled).toBe(false)
    expect(reloaded.get().volume).toBe(0.25)
  })

  it('keeps working in memory when a write fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation((): void => undefined)
    const store = createSoundStore(createBlockedStorage())
    store.update({ volume: 0.5 })
    expect(store.get().volume).toBe(0.5)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('createSoundStore subscribe', () => {
  it('notifies listeners on change and not on a no-op update', () => {
    const store = createSoundStore(createMemoryStorage())
    const listener = vi.fn()
    store.subscribe(listener)
    store.update({ enabled: false })
    expect(listener).toHaveBeenCalledTimes(1)
    store.update({ enabled: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', () => {
    const store = createSoundStore(createMemoryStorage())
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.update({ enabled: false })
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribing one listener leaves the others', () => {
    const store = createSoundStore(createMemoryStorage())
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = store.subscribe(first)
    store.subscribe(second)
    unsubscribeFirst()
    store.update({ volume: 0.1 })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('lets a listener unsubscribe itself during notification', () => {
    const store = createSoundStore(createMemoryStorage())
    const other = vi.fn()
    let unsubscribeSelf: (() => void) | null = null
    unsubscribeSelf = store.subscribe((): void => {
      unsubscribeSelf?.()
    })
    store.subscribe(other)
    expect(() => store.update({ enabled: false })).not.toThrow()
    expect(other).toHaveBeenCalledTimes(1)
  })
})
