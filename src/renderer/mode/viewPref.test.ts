import { describe, expect, it } from 'vitest'
import { parseView } from './viewPref'

describe('parseView', () => {
  it('reads hub as the Hub board', () => {
    expect(parseView('hub')).toBe('hub')
  })

  it('reads terminal as the terminals', () => {
    expect(parseView('terminal')).toBe('terminal')
  })

  it('falls back to the terminals for a missing value', () => {
    expect(parseView(null)).toBe('terminal')
  })

  it('falls back to the terminals for garbage', () => {
    expect(parseView('HUB')).toBe('terminal')
    expect(parseView('{}')).toBe('terminal')
  })
})
