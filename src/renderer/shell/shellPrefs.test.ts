import { describe, expect, it } from 'vitest'
import { parseBooleanPref, readStorageItem, writeStorageItem } from './shellPrefs'

describe('parseBooleanPref', () => {
  it('reads "true" and "false" literally', () => {
    expect(parseBooleanPref('true', false)).toBe(true)
    expect(parseBooleanPref('false', true)).toBe(false)
  })

  it('uses the fallback when nothing is stored', () => {
    expect(parseBooleanPref(null, true)).toBe(true)
    expect(parseBooleanPref(null, false)).toBe(false)
  })

  it('uses the fallback for unexpected values', () => {
    expect(parseBooleanPref('yes', false)).toBe(false)
    expect(parseBooleanPref('', true)).toBe(true)
  })
})

describe('storage helpers outside a browser', () => {
  // The node test environment has no localStorage: the helpers must degrade instead of throwing.
  it('reads null when storage is unavailable', () => {
    expect(readStorageItem('any-key')).toBeNull()
  })

  it('does not throw when writing without storage', () => {
    expect(() => writeStorageItem('any-key', 'value')).not.toThrow()
  })
})
