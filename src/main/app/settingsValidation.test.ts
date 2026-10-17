import { describe, it, expect } from 'vitest'
import { asSettingsPatch } from './settingsValidation'

describe('asSettingsPatch', () => {
  it('accepts an empty object (nothing to change)', () => {
    expect(asSettingsPatch({})).toEqual({})
  })

  it('accepts every section with valid primitive values', () => {
    const patch = asSettingsPatch({
      autoStatus: { enabled: true, working: 'todo', needsInput: null, finished: 'done' },
      tray: { closeToTray: false, desktopNotifications: true, notifyOnlyWhenUnfocused: false },
      quota: { enabled: false, warnAtPercent: 70, criticalAtPercent: 90, notifyOnReset: true }
    })
    expect(patch.autoStatus).toEqual({ enabled: true, working: 'todo', needsInput: null, finished: 'done' })
    expect(patch.tray).toEqual({ closeToTray: false, desktopNotifications: true, notifyOnlyWhenUnfocused: false })
    expect(patch.quota).toEqual({ enabled: false, warnAtPercent: 70, criticalAtPercent: 90, notifyOnReset: true })
  })

  it('rejects a non-object payload', () => {
    expect(() => asSettingsPatch(null)).toThrow('patch must be an object')
    expect(() => asSettingsPatch('x')).toThrow('patch must be an object')
    expect(() => asSettingsPatch([])).toThrow('patch must be an object')
    expect(() => asSettingsPatch(undefined)).toThrow('patch must be an object')
  })

  it('rejects unknown top-level keys', () => {
    expect(() => asSettingsPatch({ theme: 'dark' })).toThrow('unknown key "theme"')
  })

  it('rejects unknown keys inside a section', () => {
    expect(() => asSettingsPatch({ tray: { closeToTray: true, sound: 1 } })).toThrow('unknown key "tray.sound"')
  })

  it('rejects a section that is not an object', () => {
    expect(() => asSettingsPatch({ quota: 80 })).toThrow('quota must be an object')
    expect(() => asSettingsPatch({ quota: null })).toThrow('quota must be an object')
    expect(() => asSettingsPatch({ autoStatus: [] })).toThrow('autoStatus must be an object')
  })

  it('rejects wrong primitive types', () => {
    expect(() => asSettingsPatch({ tray: { closeToTray: 'yes' } })).toThrow('tray has a field with the wrong type')
    expect(() => asSettingsPatch({ quota: { warnAtPercent: '80' } })).toThrow('quota has a field with the wrong type')
    expect(() => asSettingsPatch({ quota: { warnAtPercent: 80.5 } })).toThrow('quota has a field with the wrong type')
    expect(() => asSettingsPatch({ autoStatus: { working: 7 } })).toThrow('autoStatus has a field with the wrong type')
  })

  it('leaves range rules to the store (out-of-range integers pass the shape check)', () => {
    expect(asSettingsPatch({ quota: { warnAtPercent: 500 } })).toEqual({ quota: { warnAtPercent: 500 } })
  })

  it('accepts the sleep section', () => {
    expect(asSettingsPatch({ sleep: { enabled: true, afterMinutes: 15 } })).toEqual({
      sleep: { enabled: true, afterMinutes: 15 }
    })
    expect(asSettingsPatch({ sleep: { enabled: false } })).toEqual({ sleep: { enabled: false } })
  })

  it('rejects a sleep field with the wrong type or an unknown key', () => {
    expect(() => asSettingsPatch({ sleep: { enabled: 'yes' } })).toThrow('sleep has a field with the wrong type')
    expect(() => asSettingsPatch({ sleep: { afterMinutes: 5.5 } })).toThrow('sleep has a field with the wrong type')
    expect(() => asSettingsPatch({ sleep: { afterMinutes: 15, extra: 1 } })).toThrow('unknown key "sleep.extra"')
    expect(() => asSettingsPatch({ sleep: 30 })).toThrow('sleep must be an object')
  })
})
