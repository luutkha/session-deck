import { describe, expect, it } from 'vitest'
import { detectOutputSignals, findUsageLimitLine, stripAnsi, USAGE_LIMIT_LINE_MAX, USAGE_LIMIT_PATTERNS } from './outputSignals'

describe('stripAnsi', () => {
  it('removes colour, cursor and OSC sequences', () => {
    expect(stripAnsi('\x1b[33mhi\x1b[39m\x1b[2K\x1b]0;title\x07 there')).toBe('hi there')
  })
})

describe('findUsageLimitLine', () => {
  it('returns the matching line without ANSI codes, trimmed', () => {
    const chunk = 'Working…\r\n\x1b[33mClaude usage limit reached. Your limit will reset at 5pm.\x1b[0m\r\n'
    expect(findUsageLimitLine(chunk)).toBe('Claude usage limit reached. Your limit will reset at 5pm.')
  })

  it('returns null when nothing matches', () => {
    expect(findUsageLimitLine('Reading src/app.ts\r\nDone.')).toBeNull()
    expect(findUsageLimitLine('the retry limit reached after three attempts')).toBeNull()
  })

  it('caps the captured wording', () => {
    const long = `${'5-hour limit reached ∙ resets 3pm'} ${'x'.repeat(500)}`
    expect(findUsageLimitLine(long)).toHaveLength(USAGE_LIMIT_LINE_MAX)
  })

  it('still captures when the match crosses a line break', () => {
    const chunk = 'You have hit your\nusage limit\n'
    expect(findUsageLimitLine(chunk)).toBe('You have hit your usage limit')
  })
})

describe('detectOutputSignals', () => {
  it('sees the Remote Control footer, even with spaces squeezed out by cursor moves', () => {
    expect(detectOutputSignals('\x1b[2m/rc active\x1b[0m').remoteControl).toBe(true)
    expect(detectOutputSignals('effort/rcactive').remoteControl).toBe(true)
    expect(detectOutputSignals('  /remote-control is active · Continue here').remoteControl).toBe(true)
  })

  it('does not report Remote Control while it is only connecting or absent', () => {
    expect(detectOutputSignals('/rc connecting…').remoteControl).toBe(false)
    expect(detectOutputSignals('plain output').remoteControl).toBe(false)
  })

  it('sees the spinner of a running turn', () => {
    expect(detectOutputSignals('Kerfuffling… (3s · ↓ 25 tokens)').working).toBe(true)
    expect(detectOutputSignals('(12s · ↑ 1.2k tokens)').working).toBe(true)
  })

  it('does not call a quiet prompt working', () => {
    expect(detectOutputSignals('�?_ Try "how do I log an error?"').working).toBe(false)
  })

  it('sees the usage-limit message of a turn cut off by the plan limit', () => {
    expect(detectOutputSignals('5-hour limit reached ∙ resets 3pm').usageLimit).toBe(true)
    expect(detectOutputSignals('Claude usage limit reached. Your limit will reset at 5pm (Europe/Berlin).').usageLimit).toBe(true)
    expect(detectOutputSignals("You've hit your limit · resets 7pm").usageLimit).toBe(true)
    expect(detectOutputSignals('You have hit your usage limit').usageLimit).toBe(true)
    expect(detectOutputSignals('You’ve hit your limit').usageLimit).toBe(true)
  })

  it('tolerates cursor-moved spaces and case in the usage-limit message', () => {
    expect(detectOutputSignals('\x1b[1CUSAGE\x1b[1CLIMIT\x1b[1CREACHED').usageLimit).toBe(true)
    expect(detectOutputSignals('limit reached\x1b[2C· resets 3pm').usageLimit).toBe(true)
  })

  it('does not call user code about rate limits a usage limit', () => {
    expect(detectOutputSignals('const rateLimit = 5; // rate limit handling').usageLimit).toBe(false)
    expect(detectOutputSignals('retry after the rate limit').usageLimit).toBe(false)
  })

  it('does not treat "limit reached" without a reset nearby as the usage limit', () => {
    expect(detectOutputSignals('the retry limit reached after three attempts').usageLimit).toBe(false)
    expect(detectOutputSignals('limit reached' + ' '.repeat(60) + 'reset the cache').usageLimit).toBe(false)
  })

  it('exports the usage-limit patterns as a constant that can be extended', () => {
    expect(USAGE_LIMIT_PATTERNS.length).toBeGreaterThanOrEqual(3)
    for (const pattern of USAGE_LIMIT_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp)
    }
  })
})
