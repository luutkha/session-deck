import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PER_REASON,
  DEFAULT_SOUND_SETTINGS,
  SOUND_SETTINGS_STORAGE_KEY,
  clampVolume,
  describeChoice,
  fileBaseName,
  fileUrl,
  migrateLegacyEnabled,
  parseSoundSettings,
  serializeSoundSettings,
  withSettingsPatch
} from './soundSettings'

describe('defaults', () => {
  it('matches the agreed per-reason sounds', () => {
    expect(DEFAULT_SOUND_SETTINGS.enabled).toBe(true)
    expect(DEFAULT_SOUND_SETTINGS.volume).toBe(0.7)
    expect(DEFAULT_SOUND_SETTINGS.perReason).toEqual({
      permission: { kind: 'builtin', id: 'bell' },
      done: { kind: 'builtin', id: 'chime' },
      idle: { kind: 'builtin', id: 'soft' },
      bell: { kind: 'builtin', id: 'ping' },
      quota: { kind: 'builtin', id: 'bell' }
    })
  })

  it('defaults the quota warning to the builtin bell', () => {
    expect(DEFAULT_PER_REASON.quota).toEqual({ kind: 'builtin', id: 'bell' })
  })

  it('uses the sessiondeck.sound.v1 key', () => {
    expect(SOUND_SETTINGS_STORAGE_KEY).toBe('sessiondeck.sound.v1')
  })
})

describe('parseSoundSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(parseSoundSettings(null)).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('never throws on corrupt JSON and falls back to defaults', () => {
    expect(parseSoundSettings('{not json')).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(parseSoundSettings('')).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('falls back to defaults when the root is not an object', () => {
    expect(parseSoundSettings('null')).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(parseSoundSettings('42')).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(parseSoundSettings('[1,2]')).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(parseSoundSettings('"text"')).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('keeps valid fields and defaults wrong-typed ones individually', () => {
    const parsed = parseSoundSettings(
      JSON.stringify({ enabled: 'yes', volume: '0.2', perReason: { done: { kind: 'none' } } })
    )
    expect(parsed.enabled).toBe(true)
    expect(parsed.volume).toBe(DEFAULT_SOUND_SETTINGS.volume)
    expect(parsed.perReason.done).toEqual({ kind: 'none' })
    expect(parsed.perReason.permission).toEqual(DEFAULT_SOUND_SETTINGS.perReason.permission)
  })

  it('reads enabled=false', () => {
    expect(parseSoundSettings(JSON.stringify({ enabled: false })).enabled).toBe(false)
  })

  it('backfills the quota default for a stored object that predates it', () => {
    const legacy = {
      enabled: true,
      volume: 0.5,
      perReason: {
        permission: { kind: 'builtin', id: 'chime' },
        done: { kind: 'none' },
        idle: { kind: 'builtin', id: 'soft' },
        bell: { kind: 'builtin', id: 'ping' }
      }
    }
    const parsed = parseSoundSettings(JSON.stringify(legacy))
    expect(parsed.perReason.quota).toEqual(DEFAULT_PER_REASON.quota)
    expect(parsed.perReason.permission).toEqual({ kind: 'builtin', id: 'chime' })
    expect(parsed.perReason.done).toEqual({ kind: 'none' })
    expect(parsed.volume).toBe(0.5)
  })

  it('keeps a stored quota choice', () => {
    const parsed = parseSoundSettings(
      JSON.stringify({ perReason: { quota: { kind: 'builtin', id: 'marimba' } } })
    )
    expect(parsed.perReason.quota).toEqual({ kind: 'builtin', id: 'marimba' })
  })

  it('falls back for a bad stored quota choice', () => {
    const parsed = parseSoundSettings(
      JSON.stringify({ perReason: { quota: { kind: 'file', path: '  ' } } })
    )
    expect(parsed.perReason.quota).toEqual(DEFAULT_PER_REASON.quota)
  })

  it('falls back per reason for unknown builtin ids', () => {
    const parsed = parseSoundSettings(
      JSON.stringify({ perReason: { permission: { kind: 'builtin', id: 'airhorn' } } })
    )
    expect(parsed.perReason.permission).toEqual(DEFAULT_SOUND_SETTINGS.perReason.permission)
  })

  it('falls back for empty or blank file paths and non-string paths', () => {
    const parsed = parseSoundSettings(
      JSON.stringify({
        perReason: {
          done: { kind: 'file', path: '' },
          idle: { kind: 'file', path: '   ' },
          bell: { kind: 'file', path: 7 }
        }
      })
    )
    expect(parsed.perReason.done).toEqual(DEFAULT_SOUND_SETTINGS.perReason.done)
    expect(parsed.perReason.idle).toEqual(DEFAULT_SOUND_SETTINGS.perReason.idle)
    expect(parsed.perReason.bell).toEqual(DEFAULT_SOUND_SETTINGS.perReason.bell)
  })

  it('accepts a valid file choice', () => {
    const path = 'C:\\Users\\Jo Doe\\My Sounds\\ding #1.wav'
    const parsed = parseSoundSettings(
      JSON.stringify({ perReason: { permission: { kind: 'file', path } } })
    )
    expect(parsed.perReason.permission).toEqual({ kind: 'file', path })
  })

  it('falls back when perReason is not an object or a choice has an unknown kind', () => {
    expect(parseSoundSettings(JSON.stringify({ perReason: 'chime' })).perReason).toEqual(
      DEFAULT_SOUND_SETTINGS.perReason
    )
    expect(
      parseSoundSettings(JSON.stringify({ perReason: { done: { kind: 'synth' } } })).perReason.done
    ).toEqual(DEFAULT_SOUND_SETTINGS.perReason.done)
    expect(
      parseSoundSettings(JSON.stringify({ perReason: { done: null } })).perReason.done
    ).toEqual(DEFAULT_SOUND_SETTINGS.perReason.done)
  })

  it('clamps out-of-range volume', () => {
    expect(parseSoundSettings(JSON.stringify({ volume: 5 })).volume).toBe(1)
    expect(parseSoundSettings(JSON.stringify({ volume: -3 })).volume).toBe(0)
    expect(parseSoundSettings(JSON.stringify({ volume: 0.25 })).volume).toBe(0.25)
  })

  it('ignores unknown extra keys', () => {
    const parsed = parseSoundSettings(JSON.stringify({ enabled: false, extra: 1, perReason: { x: 1 } }))
    expect(parsed).toEqual({ ...DEFAULT_SOUND_SETTINGS, enabled: false })
    expect(Object.keys(parsed).sort()).toEqual(['enabled', 'perReason', 'volume'])
  })
})

describe('serializeSoundSettings', () => {
  it('round-trips through parseSoundSettings', () => {
    const settings = withSettingsPatch(DEFAULT_SOUND_SETTINGS, {
      enabled: false,
      volume: 0.4,
      perReason: { done: { kind: 'file', path: '/home/u/a%b.mp3' } }
    })
    expect(parseSoundSettings(serializeSoundSettings(settings))).toEqual(settings)
  })

  it('writes only the known keys', () => {
    const json = JSON.parse(serializeSoundSettings(DEFAULT_SOUND_SETTINGS)) as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(['enabled', 'perReason', 'volume'])
  })
})

describe('withSettingsPatch', () => {
  it('merges immutably and clamps volume', () => {
    const next = withSettingsPatch(DEFAULT_SOUND_SETTINGS, { volume: 9 })
    expect(next.volume).toBe(1)
    expect(DEFAULT_SOUND_SETTINGS.volume).toBe(0.7)
    expect(next).not.toBe(DEFAULT_SOUND_SETTINGS)
  })

  it('merges perReason per key and keeps other reasons', () => {
    const next = withSettingsPatch(DEFAULT_SOUND_SETTINGS, { perReason: { idle: { kind: 'none' } } })
    expect(next.perReason.idle).toEqual({ kind: 'none' })
    expect(next.perReason.done).toEqual(DEFAULT_SOUND_SETTINGS.perReason.done)
    expect(DEFAULT_SOUND_SETTINGS.perReason.idle).toEqual({ kind: 'builtin', id: 'soft' })
  })
})

describe('clampVolume', () => {
  it('clamps to 0..1 and maps non-finite values to the default', () => {
    expect(clampVolume(0.5)).toBe(0.5)
    expect(clampVolume(-0.1)).toBe(0)
    expect(clampVolume(1.1)).toBe(1)
    expect(clampVolume(Number.NaN)).toBe(0.7)
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(0.7)
  })
})

describe('fileUrl', () => {
  it('encodes a Windows path with spaces and # and converts backslashes', () => {
    expect(fileUrl('C:\\Users\\Jo Doe\\My Sounds\\ding #1.wav')).toBe(
      'file:///C:/Users/Jo%20Doe/My%20Sounds/ding%20%231.wav'
    )
  })

  it('encodes percent signs in a POSIX path', () => {
    expect(fileUrl('/home/u/a%b.mp3')).toBe('file:///home/u/a%25b.mp3')
  })

  it('encodes ? and non-ASCII characters', () => {
    expect(fileUrl('/home/u/what?.wav')).toBe('file:///home/u/what%3F.wav')
    expect(fileUrl('C:\\音\\ö ü.mp3')).toBe(
      'file:///C:/%E9%9F%B3/%C3%B6%20%C3%BC.mp3'
    )
  })

  it('keeps the drive colon unencoded', () => {
    expect(fileUrl('D:\\a.wav')).toBe('file:///D:/a.wav')
  })

  it('handles UNC paths', () => {
    expect(fileUrl('\\\\server\\share\\my sound.wav')).toBe('file://server/share/my%20sound.wav')
  })
})

describe('fileBaseName', () => {
  it('returns the last segment for both separators', () => {
    expect(fileBaseName('C:\\Users\\Jo Doe\\ding #1.wav')).toBe('ding #1.wav')
    expect(fileBaseName('/home/u/a.mp3')).toBe('a.mp3')
    expect(fileBaseName('plain.wav')).toBe('plain.wav')
  })
})

describe('describeChoice', () => {
  it('labels builtin, file and none choices', () => {
    expect(describeChoice({ kind: 'builtin', id: 'marimba' })).toBe('Marimba')
    expect(describeChoice({ kind: 'file', path: 'C:\\Sounds\\ding #1.wav' })).toBe('Custom: ding #1.wav')
    expect(describeChoice({ kind: 'none' })).toBe('None')
  })
})

describe('migrateLegacyEnabled', () => {
  it('maps the old on/off values and ignores anything else', () => {
    expect(migrateLegacyEnabled('true')).toBe(true)
    expect(migrateLegacyEnabled('false')).toBe(false)
    expect(migrateLegacyEnabled('yes')).toBeNull()
    expect(migrateLegacyEnabled(null)).toBeNull()
  })
})
