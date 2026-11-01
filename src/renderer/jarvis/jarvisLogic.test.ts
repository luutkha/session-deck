import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session, StoreData } from '../../shared/types'
import { findJarvis, isJarvisShortcut, jarvisRowState, withoutJarvis } from './jarvisLogic'

const session = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: id, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra
})
const data = { sessions: [session('a'), session('j', { role: 'jarvis' })], groups: [], statuses: [] } as unknown as StoreData
const key = (k: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...extra })

describe('jarvisLogic', () => {
  it('finds Jarvis and leaves it out of the lists', () => {
    expect(findJarvis(data)?.id).toBe('j')
    expect(withoutJarvis(data).sessions.map((s) => s.id)).toEqual(['a'])
    const plain = { ...data, sessions: [session('a')] }
    expect(withoutJarvis(plain)).toBe(plain)
    expect(findJarvis(null)).toBeNull()
  })

  it('opens on Ctrl+Shift+J only, never over a dialog', () => {
    expect(isJarvisShortcut(key('J'), false)).toBe(true)
    expect(isJarvisShortcut(key('j'), false)).toBe(true)
    expect(isJarvisShortcut(key('J'), true)).toBe(false)
    expect(isJarvisShortcut(key('j', { shiftKey: false }), false)).toBe(false) // plain Ctrl+J is a newline in Claude
    expect(isJarvisShortcut(key('J', { altKey: true }), false)).toBe(false)
  })

  it('describes the row state', () => {
    const run = (extra: Partial<RuntimeState>): RuntimeState => ({ sessionId: 'j', run: 'running', exitCode: null, attention: null, ...extra })
    const jarvis = session('j', { role: 'jarvis' })
    expect(jarvisRowState(null, undefined)).toBe('Not started')
    expect(jarvisRowState({ ...jarvis, closedAt: 1 }, undefined)).toBe('Closed')
    expect(jarvisRowState(jarvis, run({ sleeping: true }))).toBe('Sleeping')
    expect(jarvisRowState(jarvis, run({ run: 'exited' }))).toBe('Stopped')
    expect(jarvisRowState(jarvis, run({ activity: 'working' }))).toBe('Working…')
    expect(jarvisRowState(jarvis, run({ activity: 'needs-input' }))).toBe('Needs you')
    expect(jarvisRowState(jarvis, run({ activity: 'finished' }))).toBe('Ready')
  })
})
