import { describe, expect, it } from 'vitest'
import { AGENT_OPTIONS, JARVIS_AGENT_OPTIONS } from './AgentPicker'

describe('AGENT_OPTIONS (D81)', () => {
  it('offers Claude Code, OpenCode and Cursor', () => {
    expect(AGENT_OPTIONS).toEqual([
      { value: 'claude', label: 'Claude Code' },
      { value: 'opencode', label: 'OpenCode' },
      { value: 'cursor', label: 'Cursor' }
    ])
  })
})

describe('JARVIS_AGENT_OPTIONS (D81)', () => {
  it('keeps Jarvis on Claude Code and OpenCode only', () => {
    expect(JARVIS_AGENT_OPTIONS).toEqual([
      { value: 'claude', label: 'Claude Code' },
      { value: 'opencode', label: 'OpenCode' }
    ])
  })

  it('does not mutate the shared option list', () => {
    expect(AGENT_OPTIONS.some((option): boolean => option.value === 'cursor')).toBe(true)
    expect(JARVIS_AGENT_OPTIONS.some((option): boolean => option.value === 'cursor')).toBe(false)
  })
})
