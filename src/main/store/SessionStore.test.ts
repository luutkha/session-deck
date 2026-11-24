import { describe, expect, it } from 'vitest'
import type { CreateSessionInput, StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import { SessionStore } from './SessionStore'

describe('SessionStore', () => {
  function makeStore(initial?: StoreData) {
    const saved: StoreData[] = []
    const saver = { schedule: (d: StoreData) => saved.push(d) }
    const deps = { newId: () => `id-${saved.length + 1}`, now: () => 1000 + saved.length }
    const store = new SessionStore(initial ?? emptyStore(), saver, deps)
    return { store, saved, deps }
  }

  it('returns current data', () => {
    const { store } = makeStore()
    expect(store.get()).toEqual(emptyStore())
  })

  it('notifies subscribers on changes', () => {
    const { store } = makeStore()
    const calls: StoreData[] = []
    const unsub = store.subscribe((d) => calls.push(d))
    store.createGroup('G')
    expect(calls).toHaveLength(1)
    unsub()
    store.createGroup('H')
    expect(calls).toHaveLength(1)
  })

  it('does not notify when reducer throws', () => {
    const { store } = makeStore()
    const calls: StoreData[] = []
    store.subscribe((d) => calls.push(d))
    expect(() => store.renameSession('nope', 'A')).toThrow('Unknown session: nope')
    expect(calls).toHaveLength(0)
  })

  it('does not change state when reducer throws', () => {
    const { store } = makeStore()
    expect(() => store.renameSession('nope', 'A')).toThrow()
    expect(store.get()).toEqual(emptyStore())
  })

  it('createSession returns the created session and updates state', () => {
    const { store } = makeStore()
    const session = store.createSession({ cwd: '/home/u/proj' })
    expect(session.name).toBe('proj')
    expect(store.get().sessions).toHaveLength(1)
  })

  it('schedules saver once per successful mutation', () => {
    const { store, saved } = makeStore()
    store.createGroup('G')
    store.renameGroup('id-1', 'New')
    expect(saved).toHaveLength(2)
  })

  it('createSession passes through all input fields', () => {
    const { store } = makeStore()
    const input: CreateSessionInput = {
      cwd: '/x',
      name: 'Named',
      groupId: null,
      statusId: 'todo',
      claudeArgs: ['--verbose']
    }
    const session = store.createSession(input)
    expect(session.name).toBe('Named')
    expect(session.statusId).toBe('todo')
    expect(session.claudeArgs).toEqual(['--verbose'])
  })

  it('exposes all reducer operations', () => {
    const { store } = makeStore()
    store.createGroup('G')
    store.createSession({ cwd: '/x', groupId: 'id-1' })
    store.renameSession('id-2', 'Renamed')
    store.setSessionStatus('id-2', 'working')
    store.moveSession('id-2', null, 0)
    store.removeSession('id-2')
    store.renameGroup('id-1', 'Renamed Group')
    store.setGroupCollapsed('id-1', true)
    store.reorderGroups(['id-1'])
    store.upsertStatus({ id: 'new', name: 'New', color: '#123456' })
    store.removeStatus('new')
    expect(store.get().sessions).toHaveLength(0)
    expect(store.get().groups[0].name).toBe('Renamed Group')
  })

  it('handles removeGroup', () => {
    const { store } = makeStore()
    store.createGroup('G')
    store.createSession({ cwd: '/x', groupId: 'id-1' })
    store.removeGroup('id-1')
    expect(store.get().groups).toHaveLength(0)
    expect(store.get().sessions[0].groupId).toBeNull()
  })

  it('setClaudeSessionId sets the id and persists', () => {
    const { store } = makeStore()
    const session = store.createSession({ cwd: '/x' })
    store.setClaudeSessionId(session.id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(store.get().sessions[0].claudeSessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('setKeepAwake sets and clears the flag, and a repeat changes nothing', () => {
    const { store } = makeStore()
    const session = store.createSession({ cwd: '/x' })
    store.setKeepAwake(session.id, true)
    expect(store.get().sessions[0].keepAwake).toBe(true)
    const same = store.get()
    store.setKeepAwake(session.id, true)
    expect(store.get()).toBe(same)
    store.setKeepAwake(session.id, false)
    expect(store.get().sessions[0]).not.toHaveProperty('keepAwake')
  })

  it('setClaudeSessionId validates the value', () => {
    const { store } = makeStore()
    const session = store.createSession({ cwd: '/x' })
    expect(() => store.setClaudeSessionId(session.id, 'not-a-uuid')).toThrow('Invalid claudeSessionId')
    expect(() => store.setClaudeSessionId(session.id, '')).toThrow('Invalid claudeSessionId')
  })

  it('setClaudeSessionId throws for unknown session', () => {
    const { store } = makeStore()
    expect(() => store.setClaudeSessionId('nope', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toThrow(
      'Unknown session: nope'
    )
  })

  describe('closeSession / reopenSession', () => {
    const FIXED_NOW = 4242

    function makeFixedStore() {
      const saved: StoreData[] = []
      const saver = { schedule: (d: StoreData) => saved.push(d) }
      const store = new SessionStore(emptyStore(), saver, { newId: () => 's1', now: () => FIXED_NOW })
      store.createSession({ cwd: '/home/u/proj' })
      saved.length = 0
      return { store, saved }
    }

    it('closeSession stamps closedAt from the clock and notifies subscribers once', () => {
      const { store, saved } = makeFixedStore()
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))

      store.closeSession('s1')

      expect(store.get().sessions[0].closedAt).toBe(FIXED_NOW)
      expect(calls).toHaveLength(1)
      expect(saved).toHaveLength(1)
    })

    it('closeSession on an already closed session does not notify or schedule a save', () => {
      const { store, saved } = makeFixedStore()
      store.closeSession('s1')
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))
      saved.length = 0

      store.closeSession('s1')

      expect(calls).toHaveLength(0)
      expect(saved).toHaveLength(0)
    })

    it('reopenSession clears closedAt and notifies subscribers', () => {
      const { store, saved } = makeFixedStore()
      store.closeSession('s1')
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))
      saved.length = 0

      store.reopenSession('s1')

      expect(store.get().sessions[0].closedAt).toBeUndefined()
      expect(calls).toHaveLength(1)
      expect(saved).toHaveLength(1)
    })

    it('reopenSession on an open session does not notify', () => {
      const { store, saved } = makeFixedStore()
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))

      store.reopenSession('s1')

      expect(calls).toHaveLength(0)
      expect(saved).toHaveLength(0)
    })

    it('closeSession with an unknown id throws without notifying', () => {
      const { store } = makeFixedStore()
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))

      expect(() => store.closeSession('nope')).toThrow('Unknown session: nope')
      expect(calls).toHaveLength(0)
    })

    it('reopenSession with an unknown id throws', () => {
      const { store } = makeFixedStore()
      expect(() => store.reopenSession('nope')).toThrow('Unknown session: nope')
    })
  })

  describe('reorderStatuses', () => {
    it('replaces statuses, schedules a save and notifies subscribers on success', () => {
      const { store, saved } = makeStore()
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))
      const ids = store.get().statuses.map((s) => s.id)
      const reversed = [...ids].reverse()

      store.reorderStatuses(reversed)

      expect(store.get().statuses.map((s) => s.id)).toEqual(reversed)
      expect(saved).toHaveLength(1)
      expect(saved[0].statuses.map((s) => s.id)).toEqual(reversed)
      expect(calls).toHaveLength(1)
      expect(calls[0].statuses.map((s) => s.id)).toEqual(reversed)
    })

    it('does not save or notify when the order is invalid', () => {
      const { store, saved } = makeStore()
      const before = store.get()
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))

      expect(() => store.reorderStatuses(['todo'])).toThrow('Invalid status order')

      expect(store.get()).toBe(before)
      expect(saved).toHaveLength(0)
      expect(calls).toHaveLength(0)
    })

    it('does not notify when an unknown id is given', () => {
      const { store, saved } = makeStore()
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))
      const ids = store.get().statuses.map((s) => s.id)

      expect(() => store.reorderStatuses([...ids.slice(1), 'ghost'])).toThrow('Invalid status order')
      expect(calls).toHaveLength(0)
      expect(saved).toHaveLength(0)
    })
  })

  describe('setCursorChatId (D81)', () => {
    it('persists and notifies; a duplicate id saves nothing', () => {
      const { store, saved } = makeStore()
      store.createSession({ cwd: '/x', agent: 'cursor' })
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))
      const savesBefore = saved.length

      store.setCursorChatId('id-1', 'chat_ABCDEF12')
      expect(saved).toHaveLength(savesBefore + 1)
      expect(calls).toHaveLength(1)
      expect(store.get().sessions[0].cursorChatId).toBe('chat_ABCDEF12')

      store.setCursorChatId('id-1', 'chat_ABCDEF12')
      expect(saved).toHaveLength(savesBefore + 1)
      expect(calls).toHaveLength(1)
    })

    it('invalid ids throw and neither save nor notify', () => {
      const { store, saved } = makeStore()
      store.createSession({ cwd: '/x', agent: 'cursor' })
      const calls: StoreData[] = []
      store.subscribe((d) => calls.push(d))
      const savesBefore = saved.length

      expect(() => store.setCursorChatId('id-1', 'bad id')).toThrow('Invalid cursorChatId')
      expect(saved).toHaveLength(savesBefore)
      expect(calls).toHaveLength(0)
    })
  })
})
