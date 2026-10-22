import { describe, expect, it } from 'vitest'
import { asSettingsPatch } from './settingsValidation'

describe('asSettingsPatch code section', () => {
  it('accepts a code patch with a worktrees folder and a shell', () => {
    expect(asSettingsPatch({ code: { worktreesRoot: 'C:\\wt', shell: 'pwsh' } })).toEqual({
      code: { worktreesRoot: 'C:\\wt', shell: 'pwsh' }
    })
  })

  it('accepts an empty worktrees folder (the default)', () => {
    expect(asSettingsPatch({ code: { worktreesRoot: '' } })).toEqual({ code: { worktreesRoot: '' } })
  })

  it('rejects a shell outside powershell, pwsh and cmd as a wrong-type field', () => {
    expect(() => asSettingsPatch({ code: { shell: 'bash' } })).toThrow('code has a field with the wrong type')
  })

  it('rejects an unknown key inside the code section', () => {
    expect(() => asSettingsPatch({ code: { theme: 'dark' } })).toThrow('unknown key "code.theme"')
  })

  it('rejects a code section that is not an object', () => {
    expect(() => asSettingsPatch({ code: 'cmd' })).toThrow('code must be an object')
  })
})
