import { describe, it, expect } from 'vitest'
import { validateName } from './inlineEditValidation'

describe('validateName', () => {
  it('returns ok with trimmed value for valid name', () => {
    const result = validateName('  My Session  ')
    expect(result).toEqual({ ok: true, value: 'My Session' })
  })

  it('returns ok for name at exactly 100 chars', () => {
    const name = 'a'.repeat(100)
    const result = validateName(name)
    expect(result).toEqual({ ok: true, value: name })
  })

  it('returns error for empty string', () => {
    const result = validateName('')
    expect(result).toEqual({ ok: false, error: 'Name required' })
  })

  it('returns error for whitespace only', () => {
    const result = validateName('   ')
    expect(result).toEqual({ ok: false, error: 'Name required' })
  })

  it('returns error for name longer than 100 chars', () => {
    const name = 'a'.repeat(101)
    const result = validateName(name)
    expect(result).toEqual({ ok: false, error: 'Name too long' })
  })

  it('trims before checking length', () => {
    const name = '  ' + 'a'.repeat(101) + '  '
    const result = validateName(name)
    expect(result).toEqual({ ok: false, error: 'Name too long' })
  })

  it('handles unicode characters in length check', () => {
    const name = '日本語セッション'
    const result = validateName(name)
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toBe(name)
  })

  it('returns error for unicode longer than 100 chars', () => {
    const name = 'あ'.repeat(101)
    const result = validateName(name)
    expect(result).toEqual({ ok: false, error: 'Name too long' })
  })
})