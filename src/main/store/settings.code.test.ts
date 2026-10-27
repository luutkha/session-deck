import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StoreData } from '../../shared/types'
import { DEFAULT_APP_SETTINGS, resolveSettings } from '../../shared/types'
import { parseStoreData } from './persistence'
import { emptyStore } from './reducers'
import { parseStoredSettings, updateSettings } from './settings'

const ABSOLUTE_ROOT = resolve('/sessiondeck/worktrees')

function dataWith(): StoreData {
  return emptyStore()
}

describe('code settings: updateSettings', () => {
  it('defaults to the default folder, PowerShell and trust auto-answer off', () => {
    expect(resolveSettings(undefined).code).toEqual({ worktreesRoot: '', shell: 'powershell', autoTrustWorktrees: false })
    expect(DEFAULT_APP_SETTINGS.code).toEqual({ worktreesRoot: '', shell: 'powershell', autoTrustWorktrees: false })
  })

  it('accepts an empty worktrees folder (= the default folder)', () => {
    const next = updateSettings(dataWith(), { code: { worktreesRoot: '' } })
    expect(resolveSettings(next.settings).code.worktreesRoot).toBe('')
  })

  it('accepts an absolute worktrees folder', () => {
    const next = updateSettings(dataWith(), { code: { worktreesRoot: ABSOLUTE_ROOT } })
    expect(resolveSettings(next.settings).code.worktreesRoot).toBe(ABSOLUTE_ROOT)
  })

  it('rejects a relative worktrees folder', () => {
    expect(() => updateSettings(dataWith(), { code: { worktreesRoot: 'worktrees' } })).toThrow(
      'Invalid settings: code.worktreesRoot must be an absolute path'
    )
  })

  it('trims surrounding spaces before storing the folder', () => {
    const next = updateSettings(dataWith(), { code: { worktreesRoot: `  ${ABSOLUTE_ROOT}  ` } })
    expect(resolveSettings(next.settings).code.worktreesRoot).toBe(ABSOLUTE_ROOT)
  })

  it('rejects a folder longer than 260 characters', () => {
    const long = `${ABSOLUTE_ROOT}${'x'.repeat(260)}`
    expect(() => updateSettings(dataWith(), { code: { worktreesRoot: long } })).toThrow(
      'code.worktreesRoot must be at most 260 characters'
    )
  })

  it('rejects control characters in the folder', () => {
    expect(() => updateSettings(dataWith(), { code: { worktreesRoot: `${ABSOLUTE_ROOT}\u0007` } })).toThrow(
      'must not contain control characters'
    )
  })

  it('accepts pwsh and cmd as the shell', () => {
    expect(resolveSettings(updateSettings(dataWith(), { code: { shell: 'pwsh' } }).settings).code.shell).toBe('pwsh')
    expect(resolveSettings(updateSettings(dataWith(), { code: { shell: 'cmd' } }).settings).code.shell).toBe('cmd')
  })

  it('rejects a shell that is not powershell, pwsh or cmd', () => {
    expect(() => updateSettings(dataWith(), { code: { shell: 'bash' as 'cmd' } })).toThrow(
      'code.shell must be "powershell", "pwsh" or "cmd"'
    )
  })

  it('a rejected patch changes nothing', () => {
    const data = dataWith()
    expect(() => updateSettings(data, { code: { shell: 'bash' as 'cmd' } })).toThrow()
    expect(data.settings).toBeUndefined()
  })
})

describe('code settings: stored values', () => {
  function storeWithCode(code: unknown): unknown {
    return { version: 1, sessions: [], groups: [], statuses: [], groupOrder: [], settings: { code } }
  }

  it('a stored code section is kept', () => {
    const parsed = parseStoreData(storeWithCode({ worktreesRoot: ABSOLUTE_ROOT, shell: 'cmd', autoTrustWorktrees: true }))
    expect(resolveSettings(parsed.settings).code).toEqual({
      worktreesRoot: ABSOLUTE_ROOT,
      shell: 'cmd',
      autoTrustWorktrees: true
    })
  })

  it('an old code section without the trust flag still loads with it off', () => {
    const parsed = parseStoreData(storeWithCode({ worktreesRoot: ABSOLUTE_ROOT, shell: 'cmd' }))
    expect(resolveSettings(parsed.settings).code.autoTrustWorktrees).toBe(false)
  })

  it('rejects a non-boolean trust flag', () => {
    expect(() => updateSettings(dataWith(), { code: { autoTrustWorktrees: 'yes' as unknown as boolean } })).toThrow(
      'Invalid settings: code.autoTrustWorktrees must be a boolean'
    )
  })

  it('a stored relative folder drops the settings (the file still loads)', () => {
    const parsed = parseStoreData(storeWithCode({ worktreesRoot: 'rel', shell: 'cmd' }))
    expect(parsed.settings).toBeUndefined()
    expect(parsed.sessions).toEqual([])
  })

  it('a stored shell that is not supported drops the settings', () => {
    expect(parseStoredSettings({ code: { shell: 'bash' } }, [])).toBeUndefined()
  })

  it('a stored folder with surrounding spaces is trimmed', () => {
    const parsed = parseStoreData(storeWithCode({ worktreesRoot: `  ${ABSOLUTE_ROOT} `, shell: 'pwsh' }))
    expect(resolveSettings(parsed.settings).code.worktreesRoot).toBe(ABSOLUTE_ROOT)
  })
})
