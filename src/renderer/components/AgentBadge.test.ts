import { describe, expect, it } from 'vitest'
import { agentBadgeCode, sessionAgent } from './AgentBadge'

describe('sessionAgent', () => {
  it('defaults to claude when the agent field is absent', () => {
    expect(sessionAgent({})).toBe('claude')
  })

  it('returns claude when the session explicitly stores claude', () => {
    expect(sessionAgent({ agent: 'claude' })).toBe('claude')
  })

  it('returns opencode when the session stores opencode', () => {
    expect(sessionAgent({ agent: 'opencode' })).toBe('opencode')
  })

  it('returns cursor when the session stores cursor (D81)', () => {
    expect(sessionAgent({ agent: 'cursor' })).toBe('cursor')
  })
})

describe('agentBadgeCode', () => {
  it('leaves Claude unmarked, including an absent agent', () => {
    expect(agentBadgeCode(undefined)).toBeNull()
    expect(agentBadgeCode('claude')).toBeNull()
  })

  it('marks OpenCode with OC and Cursor with CU', () => {
    expect(agentBadgeCode('opencode')).toBe('OC')
    expect(agentBadgeCode('cursor')).toBe('CU')
  })

  it('leaves Shell unmarked (its own icon shows it)', () => {
    expect(agentBadgeCode('shell')).toBeNull()
  })
})
