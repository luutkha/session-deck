import { describe, expect, it } from 'vitest'
import { sessionAgent } from './AgentBadge'

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
})
