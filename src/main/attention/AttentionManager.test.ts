import { describe, it, expect, beforeEach } from 'vitest'
import { createAttentionManager, type AttentionManager } from './AttentionManager'
import type { AttentionReason, HookEvent } from '../../shared/types'

describe('AttentionManager', () => {
  let manager: AttentionManager
  let changes: Array<{ id: string; reason: AttentionReason | null }> = []

  beforeEach(() => {
    changes = []

    manager = createAttentionManager()

    manager.onChange((id, reason) => {
      changes.push({ id, reason })
    })
  })

  it('raises attention for unfocused session', () => {
    manager.raise('session-1', 'permission')
    expect(manager.get('session-1')).toBe('permission')
  })

  it('raises for the session on screen too (focus only decides pinging, in the service)', () => {
    manager.raise('session-1', 'permission')
    expect(manager.get('session-1')).toBe('permission')
  })

  it('priority: permission > done > idle > bell', () => {

    manager.raise('session-1', 'bell')
    expect(manager.get('session-1')).toBe('bell')

    manager.raise('session-1', 'idle')
    expect(manager.get('session-1')).toBe('idle')

    manager.raise('session-1', 'done')
    expect(manager.get('session-1')).toBe('done')

    manager.raise('session-1', 'permission')
    expect(manager.get('session-1')).toBe('permission')
  })

  it('does not downgrade priority', () => {

    manager.raise('session-1', 'permission')
    manager.raise('session-1', 'idle')
    expect(manager.get('session-1')).toBe('permission')

    manager.raise('session-1', 'done')
    expect(manager.get('session-1')).toBe('permission')

    manager.raise('session-1', 'bell')
    expect(manager.get('session-1')).toBe('permission')
  })

  it('clear removes attention', () => {
    manager.raise('session-1', 'permission')
    expect(manager.get('session-1')).toBe('permission')

    manager.clear('session-1')
    expect(manager.get('session-1')).toBeNull()
  })

  it('clear on already-cleared session is no-op', () => {
    manager.clear('session-1')
    expect(manager.get('session-1')).toBeNull()
  })

  it('get returns null for unknown session', () => {
    expect(manager.get('unknown')).toBeNull()
  })

  it('handleHook UserPromptSubmit never raises attention', () => {
    manager.handleHook({ sessionId: 'session-1', event: 'UserPromptSubmit' })
    expect(manager.get('session-1')).toBeNull()
    expect(changes).toEqual([])
  })

  it('handleHook Notification raises permission', () => {
    const event: HookEvent = { sessionId: 'session-1', event: 'Notification' }
    manager.handleHook(event)
    expect(manager.get('session-1')).toBe('permission')
  })

  it('handleHook Stop raises done', () => {
    const event: HookEvent = { sessionId: 'session-1', event: 'Stop' }
    manager.handleHook(event)
    expect(manager.get('session-1')).toBe('done')
  })

  it('forget removes session entirely', () => {
    manager.raise('session-1', 'permission')
    expect(manager.get('session-1')).toBe('permission')

    manager.forget('session-1')
    expect(manager.get('session-1')).toBeNull()
  })

  it('forget clears attention and notifies', () => {
    manager.raise('session-1', 'permission')
    expect(changes).toContainEqual({ id: 'session-1', reason: 'permission' })

    manager.forget('session-1')
    expect(changes).toContainEqual({ id: 'session-1', reason: null })
  })

  it('onChange notifies on raise', () => {
    manager.raise('session-1', 'idle')
    expect(changes).toContainEqual({ id: 'session-1', reason: 'idle' })
  })

  it('onChange notifies on clear', () => {
    manager.raise('session-1', 'idle')
    changes = []
    manager.clear('session-1')
    expect(changes).toContainEqual({ id: 'session-1', reason: null })
  })

  it('onChange returns unsubscribe function', () => {
    const localChanges: Array<{ id: string; reason: AttentionReason | null }> = []
    const unsubscribe = manager.onChange((id, reason) => {
      localChanges.push({ id, reason })
    })
    expect(typeof unsubscribe).toBe('function')

    manager.raise('session-1', 'idle')
    expect(localChanges).toHaveLength(1)
    expect(localChanges[0]).toEqual({ id: 'session-1', reason: 'idle' })

    localChanges.length = 0
    unsubscribe()
    manager.raise('session-1', 'permission')
    expect(localChanges).toHaveLength(0)
  })

  it('clear then raise works', () => {
    manager.raise('session-1', 'permission')
    manager.clear('session-1')
    manager.raise('session-1', 'idle')
    expect(manager.get('session-1')).toBe('idle')
  })

  it('markUnread flags a session', () => {
    manager.markUnread('session-1')
    expect(manager.get('session-1')).toBe('unread')
    expect(changes).toEqual([{ id: 'session-1', reason: 'unread' }])
  })

  it('markUnread never replaces a real reason', () => {
    manager.raise('session-1', 'done')
    manager.markUnread('session-1')
    expect(manager.get('session-1')).toBe('done')
  })

  it('a real reason replaces the unread flag, and clear removes it', () => {
    manager.markUnread('session-1')
    manager.raise('session-1', 'bell')
    expect(manager.get('session-1')).toBe('bell')
    manager.clear('session-1')
    manager.markUnread('session-2')
    manager.clear('session-2')
    expect(manager.get('session-2')).toBeNull()
  })
})
