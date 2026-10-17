import { describe, expect, it } from 'vitest'
import { appendLogChunk, EMPTY_LOG_STATE, MAX_WORKER_LINES, summarizeTool } from './logParser'

const NL = String.fromCharCode(10)
const ev = (o: unknown): string => JSON.stringify(o) + NL

describe('appendLogChunk', () => {
  it('turns text, tool calls and step costs into lines and totals', () => {
    const chunk =
      ev({ type: 'text', timestamp: 1000, part: { text: ' Reading files ' } }) +
      ev({ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed', input: { command: 'npm test' + NL + 'second' } } } }) +
      ev({ type: 'step_finish', part: { cost: 0.02, tokens: { total: 150 } } }) +
      ev({ type: 'step_finish', part: { cost: 0.01, tokens: { total: 50 } } })
    const s = appendLogChunk(EMPTY_LOG_STATE, chunk)
    expect(s.lines).toEqual([
      { kind: 'text', text: 'Reading files' },
      { kind: 'tool', tool: 'bash', text: 'npm test', state: 'done' }
    ])
    expect(s.costUsd).toBeCloseTo(0.03)
    expect(s.tokens).toBe(200)
    expect(s.firstAt).toBe(1000)
  })

  it('marks failed and pending tool calls', () => {
    const s = appendLogChunk(
      EMPTY_LOG_STATE,
      ev({ type: 'tool_use', part: { tool: 'edit', state: { status: 'error', input: { filePath: 'a.ts' }, error: 'no match' + NL + 'more' } } }) +
        ev({ type: 'tool_use', part: { tool: 'read', state: { status: 'running', input: { filePath: 'b.ts' } } } })
    )
    expect(s.lines[0]).toEqual({ kind: 'tool', tool: 'edit', text: 'a.ts — no match', state: 'error' })
    expect(s.lines[1]).toMatchObject({ tool: 'read', text: 'b.ts', state: 'running' })
  })

  it('reports error events', () => {
    const s = appendLogChunk(EMPTY_LOG_STATE, ev({ type: 'error', error: { name: 'APIError', data: { message: 'Go usage limit exceeded' } } }))
    expect(s.lines).toEqual([{ kind: 'error', text: 'Go usage limit exceeded' }])
  })

  it('joins an event split across two chunks and skips garbage', () => {
    const line = ev({ type: 'text', part: { text: 'whole' } })
    const a = appendLogChunk(EMPTY_LOG_STATE, 'not json' + NL + line.slice(0, 20))
    expect(a.lines).toHaveLength(0)
    const b = appendLogChunk(a, line.slice(20))
    expect(b.lines).toEqual([{ kind: 'text', text: 'whole' }])
  })

  it('keeps only the newest lines and does not mutate the previous state', () => {
    let s = EMPTY_LOG_STATE
    for (let i = 0; i < MAX_WORKER_LINES + 5; i += 1) s = appendLogChunk(s, ev({ type: 'text', part: { text: 'line ' + i } }))
    expect(s.lines).toHaveLength(MAX_WORKER_LINES)
    expect(s.lines[MAX_WORKER_LINES - 1]?.text).toBe('line ' + (MAX_WORKER_LINES + 4))
    expect(EMPTY_LOG_STATE.lines).toHaveLength(0)
  })
})

describe('summarizeTool', () => {
  it('falls back to JSON for unknown inputs and empty for none', () => {
    expect(summarizeTool({ a: 1 })).toBe('{"a":1}')
    expect(summarizeTool({})).toBe('')
    expect(summarizeTool(null)).toBe('')
  })
})
