import { describe, expect, it } from 'vitest'
import type { StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import { SessionStore } from './SessionStore'

describe('SessionStore notes and checklist', () => {
  function makeStore(): { store: SessionStore; saved: StoreData[] } {
    const saved: StoreData[] = []
    const store = new SessionStore(
      { ...emptyStore(), sessions: [{ id: 's1', name: 'A', cwd: '/x', groupId: null, statusId: null, order: 0, createdAt: 1, claudeArgs: [] }] },
      { schedule: (d) => saved.push(d) },
      { newId: () => 'unused', now: () => 1 }
    )
    return { store, saved }
  }

  it('setSessionNotes replaces state, schedules a save and notifies subscribers', () => {
    const { store, saved } = makeStore()
    const calls: StoreData[] = []
    store.subscribe((d) => calls.push(d))

    store.setSessionNotes('s1', 'remember this')

    expect(store.get().sessions[0].notes).toBe('remember this')
    expect(saved).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('setSessionChecklist replaces state, schedules a save and notifies subscribers', () => {
    const { store, saved } = makeStore()
    const calls: StoreData[] = []
    store.subscribe((d) => calls.push(d))

    store.setSessionChecklist('s1', [{ id: 'a', text: 'todo', done: false }])

    expect(store.get().sessions[0].checklist).toEqual([{ id: 'a', text: 'todo', done: false }])
    expect(saved).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('does not save or notify when the reducer throws', () => {
    const { store, saved } = makeStore()
    const calls: StoreData[] = []
    store.subscribe((d) => calls.push(d))

    expect(() => store.setSessionNotes('nope', 'x')).toThrow('Unknown session: nope')
    expect(() => store.setSessionChecklist('s1', [{ id: '', text: 'x', done: false }])).toThrow('Invalid checklist')
    expect(() => store.setSessionNotes('s1', 'a'.repeat(20001))).toThrow('Notes too long')

    expect(saved).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(store.get().sessions[0].notes).toBeUndefined()
  })
})
