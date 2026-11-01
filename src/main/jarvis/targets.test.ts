import { describe, expect, it } from 'vitest'
import type { Session, StoreData } from '../../shared/types'
import { resolveGroup, resolveSession, resolveStatus, targetSessions } from './targets'

const session = (id: string, name: string, extra: Partial<Session> = {}): Session => ({
  id, name, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra
})

const data = {
  sessions: [
    session('s1', 'API server'),
    session('s2', 'api tests'),
    session('s3', 'Frontend'),
    session('j', 'Jarvis', { role: 'jarvis' })
  ],
  groups: [{ id: 'g1', name: 'Backend', collapsed: false }],
  statuses: [{ id: 'st1', name: 'Review', color: '#fff' }]
} as unknown as StoreData

describe('resolveSession', () => {
  it('finds by id, by exact name (any case) and by a unique part of the name', () => {
    expect(resolveSession(data, 's3').id).toBe('s3')
    expect(resolveSession(data, 'api TESTS').id).toBe('s2')
    expect(resolveSession(data, 'front').id).toBe('s3')
  })

  it('refuses an ambiguous name and lists the candidates with their ids', () => {
    expect(() => resolveSession(data, 'api')).toThrow(/matches 2 sessions: "API server" \(id s1\), "api tests" \(id s2\)/)
  })

  it('never returns Jarvis, and says when nothing matches', () => {
    expect(() => resolveSession(data, 'Jarvis')).toThrow('No session matches "Jarvis".')
    expect(() => resolveSession(data, 'j')).toThrow('No session matches "j".')
    expect(targetSessions(data).map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(() => resolveSession(data, 42)).toThrow('Say which session')
  })
})

describe('resolveGroup / resolveStatus', () => {
  it('match groups and statuses by name', () => {
    expect(resolveGroup(data, 'backend').id).toBe('g1')
    expect(resolveStatus(data, 'review').id).toBe('st1')
    expect(() => resolveGroup(data, 'nope')).toThrow('No group matches')
  })
})
