import { describe, expect, it } from 'vitest'
import { isOpencodeUsageLimit, OPENCODE_PLUGIN_HEALTH_GRACE_MS, opencodePluginHealth } from './health'

const START = 1_700_000_000_000

describe('opencodePluginHealth', () => {
  it('is starting inside the grace window when no plugin event arrived yet', () => {
    expect(opencodePluginHealth({ startedAtMs: START, nowMs: START, sawPluginEvent: false })).toBe('starting')
    expect(
      opencodePluginHealth({ startedAtMs: START, nowMs: START + OPENCODE_PLUGIN_HEALTH_GRACE_MS - 1, sawPluginEvent: false })
    ).toBe('starting')
  })

  it('is missing once the grace window passed with no plugin event', () => {
    expect(
      opencodePluginHealth({ startedAtMs: START, nowMs: START + OPENCODE_PLUGIN_HEALTH_GRACE_MS, sawPluginEvent: false })
    ).toBe('missing')
    expect(opencodePluginHealth({ startedAtMs: START, nowMs: START + 10 * 60 * 1000, sawPluginEvent: false })).toBe('missing')
  })

  it('is ok as soon as one plugin event arrived, whenever it arrived', () => {
    expect(opencodePluginHealth({ startedAtMs: START, nowMs: START, sawPluginEvent: true })).toBe('ok')
    expect(opencodePluginHealth({ startedAtMs: START, nowMs: START + 10 * 60 * 1000, sawPluginEvent: true })).toBe('ok')
  })

  it('honours a custom grace window', () => {
    expect(opencodePluginHealth({ startedAtMs: START, nowMs: START + 999, sawPluginEvent: false, graceMs: 1000 })).toBe(
      'starting'
    )
    expect(opencodePluginHealth({ startedAtMs: START, nowMs: START + 1000, sawPluginEvent: false, graceMs: 1000 })).toBe(
      'missing'
    )
  })

  it('falls back to the default grace window when the value is unusable', () => {
    for (const graceMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(opencodePluginHealth({ startedAtMs: START, nowMs: START + 1, sawPluginEvent: false, graceMs })).toBe('starting')
    }
  })

  it('stays starting when the clock went backwards (the window cannot be proven to have passed)', () => {
    expect(opencodePluginHealth({ startedAtMs: START, nowMs: START - 5000, sawPluginEvent: false })).toBe('starting')
  })
})

describe('isOpencodeUsageLimit', () => {
  it.each([
    'Free usage limit reached',
    'Go usage limit exceeded',
    'Rate limit exceeded, retry in 20 seconds',
    'rate-limited by the provider',
    'Quota exceeded for this workspace',
    'You have exceeded your quota',
    'insufficient credits',
    'insufficient_quota',
    'Insufficient balance to continue',
    'out of credits',
    'HTTP 429: limit reached',
    '429 Too Many Requests',
    'You have hit your weekly limit',
    'daily limit reached',
    'You have hit your limit',
    '5-hour limit reached'
  ])('flags explicit provider or plan limit wording %j', (text) => {
    expect(isOpencodeUsageLimit(text)).toBe(true)
  })

  it.each([
    '',
    '   ',
    'ECONNRESET: socket hang up',
    'read tcp: connection reset by peer',
    'SyntaxError: Unexpected token < in JSON',
    'const limit = 10',
    'return items.slice(0, limit)',
    'if (used > limit) throw new Error("too many items")',
    'ENOENT: no such file or directory, open C:\\repo\\src\\limit.ts',
    'failed to read src/rate-limit.ts',
    'the retry limit reached after three attempts',
    'HTTP 429',
    'quota'
  ])('does not flag ordinary failures, bare status codes or a stray "limit" %j', (text) => {
    expect(isOpencodeUsageLimit(text)).toBe(false)
  })

  it('flags a 429 only when limit wording is next to it', () => {
    expect(isOpencodeUsageLimit('request failed with status 429: usage limit reached')).toBe(true)
    expect(isOpencodeUsageLimit('429 (quota exceeded)')).toBe(true)
    expect(isOpencodeUsageLimit('failed after 429 attempts')).toBe(false)
  })
})
