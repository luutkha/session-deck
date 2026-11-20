import { describe, expect, it } from 'vitest'
import type { OpencodeInfo } from '../../shared/types'
import { OPENCODE_OLDER_HINT, opencodeAgeText, opencodeHint, opencodeStatusText } from './opencodeInfoLogic'

const info = (overrides: Partial<OpencodeInfo>): OpencodeInfo => ({
  version: null,
  supportsStandalone: true,
  checkedAt: 0,
  probing: false,
  ...overrides
})

describe('opencodeStatusText', () => {
  it('shows Checking... while a probe runs', () => {
    expect(opencodeStatusText(info({ version: '2.1.4', probing: true }))).toBe('Checking...')
  })

  it('shows the version and the flag when supported', () => {
    expect(opencodeStatusText(info({ version: '2.1.4', supportsStandalone: true }))).toBe(
      'v2.1.4 · --standalone supported'
    )
  })

  it('shows version unknown when the version could not be read', () => {
    expect(opencodeStatusText(info({ version: null, supportsStandalone: false }))).toBe(
      'version unknown · --standalone not supported'
    )
  })

  it('keeps a prerelease suffix', () => {
    expect(opencodeStatusText(info({ version: '1.4.0-beta.2' }))).toBe('v1.4.0-beta.2 · --standalone supported')
  })
})

describe('opencodeAgeText', () => {
  const now = 1_000_000_000

  it('says not checked yet when nothing probed', () => {
    expect(opencodeAgeText(0, now)).toBe('not checked yet')
  })

  it('says just now for the first minute', () => {
    expect(opencodeAgeText(now - 5_000, now)).toBe('checked just now')
    expect(opencodeAgeText(now - 59_000, now)).toBe('checked just now')
  })

  it('counts minutes', () => {
    expect(opencodeAgeText(now - 60_000, now)).toBe('checked 1 min ago')
    expect(opencodeAgeText(now - 3 * 60_000 - 20_000, now)).toBe('checked 3 min ago')
  })

  it('counts hours and days', () => {
    expect(opencodeAgeText(now - 2 * 3_600_000, now)).toBe('checked 2 h ago')
    expect(opencodeAgeText(now - 50 * 3_600_000, now)).toBe('checked 2 d ago')
  })

  it('clamps a clock that went backwards to just now', () => {
    expect(opencodeAgeText(now + 10_000, now)).toBe('checked just now')
  })
})

describe('opencodeHint', () => {
  it('is shown for an older OpenCode', () => {
    expect(opencodeHint(info({ version: '1.4.0', supportsStandalone: false }))).toBe(OPENCODE_OLDER_HINT)
  })

  it('is hidden when --standalone is supported', () => {
    expect(opencodeHint(info({ version: '2.1.4', supportsStandalone: true }))).toBeNull()
  })

  it('is hidden while a probe is running', () => {
    expect(opencodeHint(info({ supportsStandalone: false, probing: true }))).toBeNull()
  })
})
