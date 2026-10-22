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

  it('accepts the hub section and rejects a wrong type in it', () => {
    expect(asSettingsPatch({ hub: { scrollToBusiest: false } })).toEqual({ hub: { scrollToBusiest: false } })
    expect(() => asSettingsPatch({ hub: { scrollToBusiest: 1 } })).toThrow(/Invalid settings/)
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

  it('accepts the app-wide sleep fields on their own', () => {
    expect(asSettingsPatch({ sleep: { allEnabled: true } })).toEqual({ sleep: { allEnabled: true } })
    expect(asSettingsPatch({ sleep: { allAfterMinutes: 5 } })).toEqual({ sleep: { allAfterMinutes: 5 } })
  })

  it('rejects a wrong type for the app-wide sleep fields and unknown sleep keys', () => {
    expect(() => asSettingsPatch({ sleep: { allEnabled: 'yes' } })).toThrow('sleep has a field with the wrong type')
    expect(() => asSettingsPatch({ sleep: { allAfterMinutes: 2.5 } })).toThrow('sleep has a field with the wrong type')
    expect(() => asSettingsPatch({ sleep: { allEnabled: true, extra: 1 } })).toThrow('unknown key "sleep.extra"')
  })

  it('accepts the away section', () => {
    expect(asSettingsPatch({ away: { enabled: false, afterMinutes: 30 } })).toEqual({ away: { enabled: false, afterMinutes: 30 } })
    expect(asSettingsPatch({ away: { afterMinutes: 5 } })).toEqual({ away: { afterMinutes: 5 } })
  })

  it('rejects a wrong type or an unknown key in the away section', () => {
    expect(() => asSettingsPatch({ away: { enabled: 'yes' } })).toThrow('away has a field with the wrong type')
    expect(() => asSettingsPatch({ away: { afterMinutes: 1.5 } })).toThrow('away has a field with the wrong type')
    expect(() => asSettingsPatch({ away: { enabled: true, sound: 1 } })).toThrow('unknown key "away.sound"')
    expect(() => asSettingsPatch({ away: 15 })).toThrow('away must be an object')
  })

  it('accepts the new quota autopilot keys', () => {
    expect(
      asSettingsPatch({ quota: { criticalAction: 'sleep', resetAction: 'wake', continueOnWake: true } })
    ).toEqual({ quota: { criticalAction: 'sleep', resetAction: 'wake', continueOnWake: true } })
  })

  it('rejects autopilot values outside their allowed set and wrong types', () => {
    expect(() => asSettingsPatch({ quota: { criticalAction: 'panic' } })).toThrow('quota has a field with the wrong type')
    expect(() => asSettingsPatch({ quota: { resetAction: 'sleep' } })).toThrow('quota has a field with the wrong type')
    expect(() => asSettingsPatch({ quota: { continueOnWake: 'yes' } })).toThrow('quota has a field with the wrong type')
  })

  it('still rejects unknown quota keys', () => {
    expect(() => asSettingsPatch({ quota: { autopilot: true } })).toThrow('unknown key "quota.autopilot"')
  })

  it('rejects a sleep field with the wrong type or an unknown key', () => {
    expect(() => asSettingsPatch({ sleep: { enabled: 'yes' } })).toThrow('sleep has a field with the wrong type')
    expect(() => asSettingsPatch({ sleep: { afterMinutes: 5.5 } })).toThrow('sleep has a field with the wrong type')
    expect(() => asSettingsPatch({ sleep: { afterMinutes: 15, extra: 1 } })).toThrow('unknown key "sleep.extra"')
    expect(() => asSettingsPatch({ sleep: 30 })).toThrow('sleep must be an object')
  })
})
