import { describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import { canMoveToCode } from './SessionCard'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Session',
    cwd: 'C:\\Works\\app',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...overrides
  }
}

describe('canMoveToCode (D88 context-menu show/hide rule)', () => {
  it('shows the entry for an Ops session', () => {
    expect(canMoveToCode(session())).toBe(true)
    expect(canMoveToCode(session({ agent: 'opencode' }))).toBe(true)
    expect(canMoveToCode(session({ agent: 'shell', closedAt: 1 }))).toBe(true)
  })

  it('hides the entry for a Code session (a session with a worktree)', () => {
    expect(canMoveToCode(session({ worktreeId: 'w1' }))).toBe(false)
  })

  it('hides the entry for Jarvis', () => {
    expect(canMoveToCode(session({ role: 'jarvis' }))).toBe(false)
  })

  it('hides the entry when both reasons apply', () => {
    expect(canMoveToCode(session({ worktreeId: 'w1', role: 'jarvis' }))).toBe(false)
  })
})
