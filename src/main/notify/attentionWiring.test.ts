import { describe, it, expect } from 'vitest'
import type { AttentionReason, RuntimeState, Session, StoreData } from '../../shared/types'
import { wireAttentionNotices, type AttentionWiringDeps } from './attentionWiring'

const SESSION: Session = {
  id: 's1',
  name: 'Api work',
  cwd: '/tmp',
  groupId: null,
  statusId: null,
  order: 0,
  createdAt: 0,
  claudeArgs: []
}

function harness(runtimeMessage: string | null = null): {
  fire: (id: string, reason: AttentionReason | null) => void
  notified: Array<{ id: string; title: string; body: string }>
  deps: AttentionWiringDeps
} {
  let listener: ((id: string, reason: AttentionReason | null) => void) | null = null
  const notified: Array<{ id: string; title: string; body: string }> = []
  const data: StoreData = { version: 1, sessions: [SESSION], groups: [], statuses: [], groupOrder: [] }
  const state: RuntimeState = { sessionId: 's1', run: 'running', exitCode: null, attention: null, activityMessage: runtimeMessage }
  const deps: AttentionWiringDeps = {
    attention: {
      onChange: (cb) => {
        listener = cb
        return () => {
          listener = null
        }
      }
    },
    store: { get: () => data },
    runtime: { get: (id) => (id === 's1' ? state : undefined) },
    notifySession: (id, title, body) => {
      notified.push({ id, title, body })
      return true
    }
  }
  return {
    fire: (id, reason) => listener?.(id, reason),
    notified,
    deps
  }
}

describe('wireAttentionNotices', () => {
  it('notifies a permission raise with the session name and the request text', () => {
    const h = harness('Run npm test?')
    wireAttentionNotices(h.deps)
    h.fire('s1', 'permission')
    expect(h.notified).toEqual([{ id: 's1', title: 'Api work', body: 'Needs your permission: Run npm test?' }])
  })

  it('notifies a done raise', () => {
    const h = harness()
    wireAttentionNotices(h.deps)
    h.fire('s1', 'done')
    expect(h.notified).toEqual([{ id: 's1', title: 'Api work', body: 'Finished, waiting for you' }])
  })

  it('does not notify idle or bell raises', () => {
    const h = harness()
    wireAttentionNotices(h.deps)
    h.fire('s1', 'idle')
    h.fire('s1', 'bell')
    expect(h.notified).toEqual([])
  })

  it('does not notify when attention is cleared', () => {
    const h = harness()
    wireAttentionNotices(h.deps)
    h.fire('s1', null)
    expect(h.notified).toEqual([])
  })

  it('ignores a session that is not in the store', () => {
    const h = harness()
    wireAttentionNotices(h.deps)
    h.fire('unknown', 'done')
    expect(h.notified).toEqual([])
  })

  it('stops listening after unsubscribe', () => {
    const h = harness()
    const unsubscribe = wireAttentionNotices(h.deps)
    unsubscribe()
    h.fire('s1', 'done')
    expect(h.notified).toEqual([])
  })
})
