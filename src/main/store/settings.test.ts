import { describe, it, expect, vi } from 'vitest'
import type { StoreData, StatusDef } from '../../shared/types'
import { DEFAULT_APP_SETTINGS, MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES } from '../../shared/types'
import { parseStoreData } from './persistence'
import { emptyStore, removeStatus } from './reducers'
import { clearAutoStatusReference, parseStoredSettings, settingsProblem, updateSettings } from './settings'
import { SessionStore } from './SessionStore'

const STATUSES: readonly StatusDef[] = [
  { id: 'todo', name: 'Todo', color: '#9e9e9e' },
  { id: 'working', name: 'Working', color: '#42a5f5' },
  { id: 'waiting', name: 'Waiting', color: '#ffb300' },
  { id: 'review', name: 'Review', color: '#ab47bc' },
  { id: 'done', name: 'Done', color: '#66bb6a' }
]

function storeWith(settings: unknown): unknown {
  return { version: 1, sessions: [], groups: [], statuses: STATUSES, groupOrder: [], settings }
}

function baseData(): StoreData {
  return { ...emptyStore(), statuses: [...STATUSES] }
}

describe('parseStoredSettings / parseStoreData settings', () => {
  it('no settings key -> settings absent (defaults apply later)', () => {
    const data = parseStoreData(storeWith(undefined))
    expect(data.settings).toBeUndefined()
  })

  it('a complete valid settings object is kept', () => {
    const settings = {
      autoStatus: { enabled: false, working: 'todo', needsInput: null, finished: 'done' },
      tray: { closeToTray: false, desktopNotifications: false, notifyOnlyWhenUnfocused: false },
      quota: { enabled: false, warnAtPercent: 50, criticalAtPercent: 60, notifyOnReset: false },
      sleep: { enabled: true, afterMinutes: 15 },
      agents: { defaultAgent: 'claude' as const, opencodeModel: '' },
      hub: { scrollToBusiest: false }
    }
    const data = parseStoreData(storeWith(settings))
    expect(data.settings).toEqual(settings)
  })

  it('settings saved before the hub section existed get scrollToBusiest on', () => {
    const data = parseStoreData(storeWith({ sleep: { enabled: true, afterMinutes: 15 } }))
    expect(data.settings?.hub).toEqual({ scrollToBusiest: true })
  })

  it('a hub section with a wrong type is dropped', () => {
    const data = parseStoreData(storeWith({ hub: { scrollToBusiest: 'yes' } }))
    expect(data.settings).toBeUndefined()
  })

  it('missing fields take their defaults', () => {
    const data = parseStoreData(storeWith({ tray: { closeToTray: false } }))
    expect(data.settings).toEqual({
      ...DEFAULT_APP_SETTINGS,
      tray: { ...DEFAULT_APP_SETTINGS.tray, closeToTray: false }
    })
  })

  it('unknown keys are ignored', () => {
    const data = parseStoreData(storeWith({ extra: 1, tray: { closeToTray: true, extra: 'x' } }))
    expect(data.settings).toEqual(DEFAULT_APP_SETTINGS)
    expect(data.settings).not.toHaveProperty('extra')
  })

  it('invalid settings are dropped while the rest of the store loads', () => {
    const data = parseStoreData(storeWith({ quota: { enabled: 'yes' } }))
    expect(data.settings).toBeUndefined()
    expect(data.statuses).toHaveLength(STATUSES.length)
  })

  it('a non-object settings value is dropped', () => {
    expect(parseStoredSettings('nope', STATUSES)).toBeUndefined()
    expect(parseStoredSettings([], STATUSES)).toBeUndefined()
    expect(parseStoredSettings(null, STATUSES)).toBeUndefined()
  })

  it('a section that is not an object is dropped', () => {
    expect(parseStoredSettings({ tray: 3 }, STATUSES)).toBeUndefined()
  })

  it('wrong primitive types are dropped', () => {
    expect(parseStoredSettings({ tray: { closeToTray: 'true' } }, STATUSES)).toBeUndefined()
    expect(parseStoredSettings({ quota: { warnAtPercent: 80.5 } }, STATUSES)).toBeUndefined()
    expect(parseStoredSettings({ autoStatus: { working: 42 } }, STATUSES)).toBeUndefined()
  })

  it('warn >= critical is dropped', () => {
    expect(parseStoredSettings({ quota: { warnAtPercent: 95, criticalAtPercent: 95 } }, STATUSES)).toBeUndefined()
  })

  it('a mapping to an unknown status is reset to null (file value kept otherwise)', () => {
    const settings = parseStoredSettings({ autoStatus: { working: 'gone', finished: 'done' } }, STATUSES)
    expect(settings?.autoStatus).toEqual({ enabled: true, working: null, needsInput: 'waiting', finished: 'done' })
  })

  it('accepts and persists the sleep section', () => {
    const settings = parseStoredSettings({ sleep: { enabled: true, afterMinutes: 42 } }, STATUSES)
    expect(settings?.sleep).toEqual({ enabled: true, afterMinutes: 42 })
  })

  it('missing sleep fields take their defaults', () => {
    const settings = parseStoredSettings({ sleep: { enabled: true } }, STATUSES)
    expect(settings?.sleep).toEqual({ enabled: true, afterMinutes: DEFAULT_APP_SETTINGS.sleep.afterMinutes })
  })

  it('rejects a sleep section with a wrong type or out-of-range value', () => {
    expect(parseStoredSettings({ sleep: { enabled: 'yes' } }, STATUSES)).toBeUndefined()
    expect(parseStoredSettings({ sleep: { afterMinutes: 5.5 } }, STATUSES)).toBeUndefined()
    expect(parseStoredSettings({ sleep: { afterMinutes: 0 } }, STATUSES)).toBeUndefined()
    expect(parseStoredSettings({ sleep: { afterMinutes: MAX_SLEEP_MINUTES + 1 } }, STATUSES)).toBeUndefined()
  })
})

describe('settingsProblem', () => {
  it('defaults are valid', () => {
    expect(settingsProblem(DEFAULT_APP_SETTINGS)).toBeNull()
  })

  it('accepts the range edges', () => {
    const edge = {
      ...DEFAULT_APP_SETTINGS,
      quota: { ...DEFAULT_APP_SETTINGS.quota, warnAtPercent: 1, criticalAtPercent: 2 }
    }
    expect(settingsProblem(edge)).toBeNull()
    const top = {
      ...DEFAULT_APP_SETTINGS,
      quota: { ...DEFAULT_APP_SETTINGS.quota, warnAtPercent: 99, criticalAtPercent: 100 }
    }
    expect(settingsProblem(top)).toBeNull()
  })

  it('rejects warn 0 and warn 100', () => {
    const low = { ...DEFAULT_APP_SETTINGS, quota: { ...DEFAULT_APP_SETTINGS.quota, warnAtPercent: 0 } }
    expect(settingsProblem(low)).toContain('warnAtPercent')
    const high = { ...DEFAULT_APP_SETTINGS, quota: { ...DEFAULT_APP_SETTINGS.quota, warnAtPercent: 100, criticalAtPercent: 100 } }
    expect(settingsProblem(high)).toContain('warnAtPercent')
  })

  it('rejects critical 1 and critical 101', () => {
    const low = { ...DEFAULT_APP_SETTINGS, quota: { ...DEFAULT_APP_SETTINGS.quota, warnAtPercent: 1, criticalAtPercent: 1 } }
    expect(settingsProblem(low)).toContain('criticalAtPercent')
    const high = { ...DEFAULT_APP_SETTINGS, quota: { ...DEFAULT_APP_SETTINGS.quota, criticalAtPercent: 101 } }
    expect(settingsProblem(high)).toContain('criticalAtPercent')
  })

  it('rejects warn not below critical', () => {
    const equal = { ...DEFAULT_APP_SETTINGS, quota: { ...DEFAULT_APP_SETTINGS.quota, warnAtPercent: 90, criticalAtPercent: 90 } }
    expect(settingsProblem(equal)).toContain('greater than')
  })

  it('accepts the sleep range edges', () => {
    expect(settingsProblem({ ...DEFAULT_APP_SETTINGS, sleep: { enabled: true, afterMinutes: MIN_SLEEP_MINUTES } })).toBeNull()
    expect(settingsProblem({ ...DEFAULT_APP_SETTINGS, sleep: { enabled: false, afterMinutes: MAX_SLEEP_MINUTES } })).toBeNull()
  })

  it('rejects sleep afterMinutes out of range', () => {
    expect(settingsProblem({ ...DEFAULT_APP_SETTINGS, sleep: { enabled: true, afterMinutes: 0 } })).toContain('sleep.afterMinutes')
    expect(settingsProblem({ ...DEFAULT_APP_SETTINGS, sleep: { enabled: true, afterMinutes: MAX_SLEEP_MINUTES + 1 } })).toContain(
      'sleep.afterMinutes'
    )
  })
})

describe('updateSettings reducer', () => {
  it('merges the patch onto resolved settings and stores the FULL result', () => {
    const next = updateSettings(baseData(), { tray: { closeToTray: false } })
    expect(next.settings).toEqual({
      ...DEFAULT_APP_SETTINGS,
      tray: { ...DEFAULT_APP_SETTINGS.tray, closeToTray: false }
    })
  })

  it('keeps previously stored values that the patch does not touch', () => {
    const first = updateSettings(baseData(), { quota: { warnAtPercent: 70 } })
    const second = updateSettings(first, { autoStatus: { enabled: false } })
    expect(second.settings?.quota.warnAtPercent).toBe(70)
    expect(second.settings?.autoStatus.enabled).toBe(false)
  })

  it('is immutable: the input data is not changed', () => {
    const data = baseData()
    const snapshot = JSON.stringify(data)
    updateSettings(data, { tray: { closeToTray: false } })
    expect(JSON.stringify(data)).toBe(snapshot)
    expect(data.settings).toBeUndefined()
  })

  it('an explicit undefined in the patch does not overwrite a value', () => {
    const next = updateSettings(baseData(), { tray: { closeToTray: undefined } })
    expect(next.settings?.tray.closeToTray).toBe(true)
  })

  it('rejects warnAtPercent out of range with Invalid settings', () => {
    expect(() => updateSettings(baseData(), { quota: { warnAtPercent: 0 } })).toThrow(
      'Invalid settings: quota.warnAtPercent must be an integer from 1 to 99'
    )
  })

  it('rejects criticalAtPercent out of range', () => {
    expect(() => updateSettings(baseData(), { quota: { criticalAtPercent: 101 } })).toThrow(
      'Invalid settings: '
    )
  })

  it('rejects warn that is not below critical, judged on the MERGED result', () => {
    // defaults: warn 80, critical 95. Patching warn to 96 alone must fail.
    expect(() => updateSettings(baseData(), { quota: { warnAtPercent: 96 } })).toThrow(
      'Invalid settings: quota.criticalAtPercent must be greater than quota.warnAtPercent'
    )
  })

  it('accepts warn and critical moved together', () => {
    const next = updateSettings(baseData(), { quota: { warnAtPercent: 96, criticalAtPercent: 99 } })
    expect(next.settings?.quota).toMatchObject({ warnAtPercent: 96, criticalAtPercent: 99 })
  })

  it('rejects a mapping to an unknown status id', () => {
    expect(() => updateSettings(baseData(), { autoStatus: { working: 'nope' } })).toThrow(
      'Invalid settings: autoStatus.working refers to unknown status nope'
    )
  })

  it('accepts a mapping to an existing status and null', () => {
    const next = updateSettings(baseData(), { autoStatus: { working: 'todo', finished: null } })
    expect(next.settings?.autoStatus).toMatchObject({ working: 'todo', finished: null })
  })

  it('failed updates leave the data untouched (throw, no partial write)', () => {
    const data = baseData()
    expect(() => updateSettings(data, { tray: { closeToTray: false }, quota: { warnAtPercent: 0 } })).toThrow()
    expect(data.settings).toBeUndefined()
  })

  it('merges and persists the sleep section', () => {
    const next = updateSettings(baseData(), { sleep: { enabled: true, afterMinutes: 20 } })
    expect(next.settings?.sleep).toEqual({ enabled: true, afterMinutes: 20 })
  })

  it('rejects a sleep afterMinutes out of range', () => {
    expect(() => updateSettings(baseData(), { sleep: { afterMinutes: 0 } })).toThrow('Invalid settings: sleep.afterMinutes')
  })
})

describe('removeStatus clears autoStatus mappings', () => {
  it('nulls every mapping that points at the removed status', () => {
    const data: StoreData = {
      ...baseData(),
      settings: { ...DEFAULT_APP_SETTINGS, autoStatus: { enabled: true, working: 'working', needsInput: 'waiting', finished: 'working' } }
    }
    const next = removeStatus(data, 'working')
    expect(next.settings?.autoStatus).toEqual({ enabled: true, working: null, needsInput: 'waiting', finished: null })
  })

  it('uses default mappings when settings are absent', () => {
    const next = removeStatus(baseData(), 'review')
    expect(next.settings?.autoStatus.finished).toBeNull()
    expect(next.settings?.autoStatus.working).toBe('working')
  })

  it('does not add a settings key when no mapping points at the status', () => {
    const next = removeStatus(baseData(), 'todo')
    expect(next).not.toHaveProperty('settings')
  })

  it('clearAutoStatusReference returns the stored value unchanged when nothing matches', () => {
    const stored = { ...DEFAULT_APP_SETTINGS }
    expect(clearAutoStatusReference({ ...baseData(), settings: stored }, 'todo')).toBe(stored)
  })
})

describe('SessionStore.updateSettings', () => {
  function makeStore(initial: StoreData = baseData()): { store: SessionStore; schedule: ReturnType<typeof vi.fn> } {
    const schedule = vi.fn()
    const store = new SessionStore(initial, { schedule }, { newId: () => 'id', now: () => 1 })
    return { store, schedule }
  }

  it('returns the resolved settings, saves and notifies subscribers', () => {
    const { store, schedule } = makeStore()
    const listener = vi.fn()
    store.subscribe(listener)

    const resolved = store.updateSettings({ tray: { desktopNotifications: false } })

    expect(resolved.tray.desktopNotifications).toBe(false)
    expect(store.getSettings().tray.desktopNotifications).toBe(false)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('an invalid patch throws and neither saves nor notifies', () => {
    const { store, schedule } = makeStore()
    const listener = vi.fn()
    store.subscribe(listener)

    expect(() => store.updateSettings({ quota: { warnAtPercent: 200 } })).toThrow('Invalid settings')
    expect(schedule).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('getSettings returns defaults before anything is stored', () => {
    const { store } = makeStore()
    expect(store.getSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })
})
