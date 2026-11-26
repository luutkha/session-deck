import { describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import { canMoveToCode, eligibleMoveToCodeIds, moveToCodeLabel } from './SessionCard'

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

describe('eligibleMoveToCodeIds (D89 bulk selection)', () => {
  const sessions = [
    session({ id: 'a' }),
    session({ id: 'b', name: 'Jarvis', role: 'jarvis' }),
    session({ id: 'c', name: 'Code', worktreeId: 'w1' }),
    session({ id: 'd', name: 'OpenCode' })
  ]

  it('keeps the view order and skips Jarvis, Code sessions and unknown ids', () => {
    expect(eligibleMoveToCodeIds(sessions, ['c', 'd', 'b', 'a', 'gone'])).toEqual(['d', 'a'])
  })

  it('ignores duplicate ids', () => {
    expect(eligibleMoveToCodeIds(sessions, ['a', 'a', 'd', 'b', 'd'])).toEqual(['a', 'd'])
  })

  it('keeps closed Ops sessions, like the single-session rule', () => {
    expect(eligibleMoveToCodeIds([session({ id: 'x', closedAt: 1 })], ['x'])).toEqual(['x'])
  })
})

describe('moveToCodeLabel (D89)', () => {
  it('keeps the D88 wording for one session', () => {
    expect(moveToCodeLabel(1)).toBe('Move to Code mode…')
  })

  it('shows the count for several sessions', () => {
    expect(moveToCodeLabel(3)).toBe('Move 3 sessions to Code mode…')
  })
})
