import { describe, it, expect } from 'vitest'
import { createActiveSessions } from './activeSessions'

describe('createActiveSessions', () => {
  it('get returns null for a role that never set a session', () => {
    const active = createActiveSessions()
    expect(active.get('main')).toBeNull()
    expect(active.get('code')).toBeNull()
  })

  it('keeps the session on screen independent per window role', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('code', 'b')
    expect(active.get('main')).toBe('a')
    expect(active.get('code')).toBe('b')
  })

  it('setting a role again replaces only that role', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('code', 'b')
    active.set('main', 'c')
    expect(active.get('main')).toBe('c')
    expect(active.get('code')).toBe('b')
  })

  it('set with null clears that role', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('main', null)
    expect(active.get('main')).toBeNull()
  })

  it('all lists the sessions on screen without nulls', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('code', null)
    expect(active.all()).toEqual(['a'])
  })

  it('all has no duplicates when two windows show the same session', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('code', 'a')
    expect(active.all()).toEqual(['a'])
  })

  it('all is empty when nothing is on screen', () => {
    expect(createActiveSessions().all()).toEqual([])
  })

  it('clearRole forgets only that role', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('code', 'b')
    active.clearRole('code')
    expect(active.get('code')).toBeNull()
    expect(active.get('main')).toBe('a')
    expect(active.all()).toEqual(['a'])
  })

  it('remove drops the session from every role, leaving others on screen', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('code', 'b')
    active.remove('a')
    expect(active.get('main')).toBeNull()
    expect(active.get('code')).toBe('b')
    expect(active.all()).toEqual(['b'])
  })

  it('remove of two windows showing the same session clears both', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.set('code', 'a')
    active.remove('a')
    expect(active.all()).toEqual([])
  })

  it('remove of an unknown id changes nothing', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    active.remove('missing')
    expect(active.get('main')).toBe('a')
  })

  it('all returns a snapshot that later changes do not mutate', () => {
    const active = createActiveSessions()
    active.set('main', 'a')
    const snapshot = active.all()
    active.set('main', 'b')
    expect(snapshot).toEqual(['a'])
  })
})
