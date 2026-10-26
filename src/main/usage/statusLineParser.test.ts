import { describe, it, expect } from 'vitest'
import { clampPercent, parseResetsAt, parseStatusLine } from './statusLineParser'

const SAMPLE = {
  session_id: 'abc',
  transcript_path: '/tmp/x.jsonl',
  cwd: '/home/u/proj',
  model: { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' },
  effort: { level: 'medium' },
  cost: { total_cost_usd: 0.4215, total_duration_ms: 1000 },
  context_window: { used_percentage: 8, context_window_size: 200000, total_input_tokens: 15000 },
  rate_limits: {
    five_hour: { used_percentage: 38, resets_at: 1791894600 },
    seven_day: { used_percentage: 34, resets_at: 1792332000 }
  },
  version: '2.1.285'
}

describe('parseStatusLine', () => {
  it('reads the real Claude Code payload shape', () => {
    const result = parseStatusLine(SAMPLE, 500)
    expect(result.account).toEqual({
      fiveHour: { usedPercentage: 38, resetsAt: 1791894600 },
      sevenDay: { usedPercentage: 34, resetsAt: 1792332000 }
    })
    expect(result.session).toEqual({
      model: 'Sonnet 5.5',
      contextPercent: 8,
      costUsd: 0.4215,
      effort: 'medium',
      updatedAt: 500
    })
  })

  it('returns null account when rate_limits is missing or empty', () => {
    expect(parseStatusLine({ ...SAMPLE, rate_limits: undefined }, 1).account).toBeNull()
    expect(parseStatusLine({ ...SAMPLE, rate_limits: {} }, 1).account).toBeNull()
    expect(parseStatusLine({ ...SAMPLE, rate_limits: 'nope' }, 1).account).toBeNull()
  })

  it('returns null account when neither window is usable', () => {
    const result = parseStatusLine({ rate_limits: { five_hour: { used_percentage: 'x' } } }, 1)
    expect(result.account).toBeNull()
  })

  it('keeps one window when the other is missing', () => {
    const result = parseStatusLine({ rate_limits: { five_hour: { used_percentage: 10 } } }, 1)
    expect(result.account).toEqual({ fiveHour: { usedPercentage: 10, resetsAt: null }, sevenDay: null })
  })

  it('clamps percentages to 0..100 and rejects non-finite values', () => {
    const result = parseStatusLine(
      {
        rate_limits: {
          five_hour: { used_percentage: 150, resets_at: 1 },
          seven_day: { used_percentage: -5 }
        },
        context_window: { used_percentage: Number.NaN }
      },
      1
    )
    expect(result.account?.fiveHour?.usedPercentage).toBe(100)
    expect(result.account?.sevenDay?.usedPercentage).toBe(0)
    expect(result.session.contextPercent).toBeNull()
  })

  it('drops a window whose percentage is not a number', () => {
    const result = parseStatusLine({ rate_limits: { five_hour: { used_percentage: '38' } } }, 1)
    expect(result.account).toBeNull()
  })

  it('converts resets_at from numeric string and ISO string', () => {
    const numeric = parseStatusLine({ rate_limits: { five_hour: { used_percentage: 1, resets_at: '1791894600' } } }, 1)
    expect(numeric.account?.fiveHour?.resetsAt).toBe(1791894600)

    const iso = parseStatusLine(
      { rate_limits: { five_hour: { used_percentage: 1, resets_at: '2026-10-13T10:00:00Z' } } },
      1
    )
    expect(iso.account?.fiveHour?.resetsAt).toBe(Date.parse('2026-10-13T10:00:00Z') / 1000)
  })

  it('uses null resets_at for garbage', () => {
    const result = parseStatusLine({ rate_limits: { five_hour: { used_percentage: 1, resets_at: 'soon' } } }, 1)
    expect(result.account?.fiveHour?.resetsAt).toBeNull()
  })

  it('accepts only finite cost >= 0', () => {
    expect(parseStatusLine({ cost: { total_cost_usd: 0 } }, 1).session.costUsd).toBe(0)
    expect(parseStatusLine({ cost: { total_cost_usd: -1 } }, 1).session.costUsd).toBeNull()
    expect(parseStatusLine({ cost: { total_cost_usd: '1' } }, 1).session.costUsd).toBeNull()
    expect(parseStatusLine({ cost: { total_cost_usd: Number.POSITIVE_INFINITY } }, 1).session.costUsd).toBeNull()
  })

  it('trims strings and limits them to 60 characters', () => {
    const long = `  ${'m'.repeat(100)}  `
    const result = parseStatusLine({ model: { display_name: long }, effort: { level: '  high  ' } }, 1)
    expect(result.session.model).toBe('m'.repeat(60))
    expect(result.session.effort).toBe('high')
  })

  it('treats blank strings as null', () => {
    const result = parseStatusLine({ model: { display_name: '   ' } }, 1)
    expect(result.session.model).toBeNull()
  })

  it('never throws on odd input', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      0,
      'text',
      true,
      [],
      [SAMPLE],
      { model: null, effort: [], cost: 'x', context_window: [], rate_limits: [] },
      { rate_limits: { five_hour: null, seven_day: [] } }
    ]
    for (const input of inputs) {
      expect(() => parseStatusLine(input, 1)).not.toThrow()
      const result = parseStatusLine(input, 1)
      expect(result.session).toEqual({ model: null, contextPercent: null, costUsd: null, effort: null, updatedAt: 1 })
      expect(result.account).toBeNull()
    }
  })

  it('defaults to the Claude provider and never reads a monthly window from it', () => {
    const result = parseStatusLine(
      { ...SAMPLE, rate_limits: { ...SAMPLE.rate_limits, monthly: { used_percentage: 5, resets_at: 1 } } },
      1
    )
    expect(result.provider).toBe('claude')
    expect(result.account?.monthly).toBeUndefined()
    expect(result.account).not.toHaveProperty('monthly')
  })

  it('falls back to Claude for an unknown source', () => {
    expect(parseStatusLine({ ...SAMPLE, source: 'something-else' }, 1).provider).toBe('claude')
    expect(parseStatusLine({ ...SAMPLE, source: 7 }, 1).provider).toBe('claude')
    expect(parseStatusLine({ ...SAMPLE, source: 'opencode-go' }, 1).provider).toBe('opencode-go')
  })

  it('reads the OpenCode Go windows, including the monthly one and ISO reset times', () => {
    const result = parseStatusLine(
      {
        source: 'opencode-go',
        rate_limits: {
          five_hour: { used_percentage: 7, resets_at: '2026-10-13T10:00:00Z' },
          seven_day: { used_percentage: 3, resets_at: '2026-10-20T10:00:00Z' },
          monthly: { used_percentage: 1, resets_at: '2026-11-01T00:00:00Z' }
        }
      },
      1
    )
    expect(result.provider).toBe('opencode-go')
    expect(result.account).toEqual({
      fiveHour: { usedPercentage: 7, resetsAt: Date.parse('2026-10-13T10:00:00Z') / 1000 },
      sevenDay: { usedPercentage: 3, resetsAt: Date.parse('2026-10-20T10:00:00Z') / 1000 },
      monthly: { usedPercentage: 1, resetsAt: Date.parse('2026-11-01T00:00:00Z') / 1000 }
    })
  })

  it('keeps a Go account whose only usable window is monthly', () => {
    const result = parseStatusLine(
      { source: 'opencode-go', rate_limits: { monthly: { used_percentage: 12 } } },
      1
    )
    expect(result.account).toEqual({ fiveHour: null, sevenDay: null, monthly: { usedPercentage: 12, resetsAt: null } })
  })

  it('returns a null Go account when its rate_limits are unusable', () => {
    const result = parseStatusLine(
      { source: 'opencode-go', rate_limits: { five_hour: { used_percentage: 'x' }, monthly: [] } },
      1
    )
    expect(result.provider).toBe('opencode-go')
    expect(result.account).toBeNull()
  })
})

describe('clampPercent', () => {
  it('clamps finite numbers and rejects everything else', () => {
    expect(clampPercent(50)).toBe(50)
    expect(clampPercent(101)).toBe(100)
    expect(clampPercent(-1)).toBe(0)
    expect(clampPercent(Number.NaN)).toBeNull()
    expect(clampPercent('5')).toBeNull()
  })
})

describe('parseResetsAt', () => {
  it('floors numbers and rejects negative or non-finite values', () => {
    expect(parseResetsAt(1791894600.9)).toBe(1791894600)
    expect(parseResetsAt(-1)).toBeNull()
    expect(parseResetsAt(Number.NaN)).toBeNull()
  })

  it('handles numeric strings, ISO strings and blanks', () => {
    expect(parseResetsAt('42')).toBe(42)
    expect(parseResetsAt('  ')).toBeNull()
    expect(parseResetsAt('not a date')).toBeNull()
    expect(parseResetsAt(null)).toBeNull()
  })
})
