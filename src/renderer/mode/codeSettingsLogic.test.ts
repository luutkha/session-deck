import { describe, expect, it } from 'vitest'
import { errorDetail, isShellKind, normalizeWorktreesRoot, SHELL_OPTIONS } from './codeSettingsLogic'

describe('SHELL_OPTIONS', () => {
  it('lists PowerShell, PowerShell 7 and Command Prompt with their program names', () => {
    expect(SHELL_OPTIONS).toEqual([
      { value: 'powershell', label: 'PowerShell' },
      { value: 'pwsh', label: 'PowerShell 7' },
      { value: 'cmd', label: 'Command Prompt' }
    ])
  })
})

describe('isShellKind', () => {
  it('accepts every listed shell', () => {
    expect(isShellKind('powershell')).toBe(true)
    expect(isShellKind('pwsh')).toBe(true)
    expect(isShellKind('cmd')).toBe(true)
  })

  it('rejects anything else, including other shells', () => {
    expect(isShellKind('bash')).toBe(false)
    expect(isShellKind('')).toBe(false)
  })
})

describe('normalizeWorktreesRoot', () => {
  it('removes surrounding spaces', () => {
    expect(normalizeWorktreesRoot('  D:\\wt  ')).toBe('D:\\wt')
  })

  it('keeps an empty value empty (the default folder)', () => {
    expect(normalizeWorktreesRoot('   ')).toBe('')
  })
})

describe('errorDetail', () => {
  it('returns the text after the last "Error: " of a wrapped IPC error', () => {
    const wrapped = new Error(
      "Error invoking remote method 'settings:update': Error: Worktrees folder must be an absolute path"
    )
    expect(errorDetail(wrapped)).toBe('Worktrees folder must be an absolute path')
  })

  it('returns the whole message when there is no marker', () => {
    expect(errorDetail(new Error('Disk is full'))).toBe('Disk is full')
  })

  it('handles values that are not Error objects', () => {
    expect(errorDetail('plain text')).toBe('plain text')
  })

  it('keeps the full message when nothing follows the marker', () => {
    const message = 'boom Error: '
    expect(errorDetail(new Error(message))).toBe(message)
  })
})
