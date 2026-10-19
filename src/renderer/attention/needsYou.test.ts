import { describe, expect, it } from 'vitest'
import type { AttentionReason, RuntimeState, Session } from '../../shared/types'
import { needsYouItems, needsYouReasonText, readToggleLabel } from './needsYou'

function session(id: string, name: string, closedAt?: number): Session {
  return {
    id,
    name,
    cwd: `C:/work/${id}`,
    groupId: null,
    statusId: null,
    createdAt: 1,
    ...(closedAt !== undefined ? { closedAt } : {})
  } as Session
}

function state(id: string, attention: AttentionReason | null, attentionAt?: number): RuntimeState {
  return {
    sessionId: id,
    run: 'running',
    exitCode: null,
    attention,
    ...(attentionAt !== undefined ? { attentionAt } : {})
  }
}

describe('needsYouItems', () => {
  it('lists only open sessions that have a bell', () => {
    const sessions = [session('a', 'A'), session('b', 'B'), session('c', 'C', 5), session('d', 'D')]
    const runtime = new Map([
      ['a', state('a', 'done', 10)],
      ['b', state('b', null)],
      ['c', state('c', 'permission', 20)]
    ])
    expect(needsYouItems(sessions, runtime).map((item) => item.id)).toEqual(['a'])
  })

  it('puts the newest bell first and bells without a time last, by name', () => {
    const sessions = [session('a', 'Zed'), session('b', 'Old'), session('c', 'New'), session('d', 'Amy')]
    const runtime = new Map([
      ['a', state('a', 'unread')],
      ['b', state('b', 'done', 100)],
      ['c', state('c', 'permission', 300)],
      ['d', state('d', 'bell')]
    ])
    expect(needsYouItems(sessions, runtime).map((item) => item.name)).toEqual(['New', 'Old', 'Amy', 'Zed'])
  })

  it('carries the reason, folder and time', () => {
    const items = needsYouItems([session('a', 'A')], new Map([['a', state('a', 'permission', 42)]]))
    expect(items[0]).toEqual({ id: 'a', name: 'A', cwd: 'C:/work/a', reason: 'permission', at: 42 })
  })
})

describe('needsYouReasonText', () => {
  it('has text for every reason', () => {
    const reasons: AttentionReason[] = ['permission', 'done', 'idle', 'bell', 'unread']
    for (const reason of reasons) {
      expect(needsYouReasonText(reason).length).toBeGreaterThan(0)
    }
    expect(needsYouReasonText('done')).toBe('Finished, waiting for you')
    expect(needsYouReasonText('unread')).toBe('Marked unread')
  })
})

describe('readToggleLabel', () => {
  it('offers mark as read for a bell and mark as unread otherwise', () => {
    expect(readToggleLabel('done')).toBe('Mark as read')
    expect(readToggleLabel('unread')).toBe('Mark as read')
    expect(readToggleLabel(null)).toBe('Mark as unread')
  })
})
