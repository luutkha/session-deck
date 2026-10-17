import { describe, it, expect, vi, type Mock } from 'vitest'
import type { Id, Session, StoreData } from '../../shared/types'
import { DEFAULT_APP_SETTINGS, DEFAULT_STATUSES } from '../../shared/types'
import { createAutoStatusApplier, type AutoStatusStore } from './applyAutoStatus'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'one',
    cwd: '/tmp/one',
    groupId: null,
    statusId: 'todo',
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...overrides
  }
}

interface FakeStore extends AutoStatusStore {
  readonly setSessionStatus: Mock<(id: Id, statusId: Id | null) => void>
  read(): StoreData
}

function fakeStore(initial: StoreData): FakeStore {
  const state = { data: initial }
  const setSessionStatus = vi.fn((id: Id, statusId: Id | null): void => {
    state.data = {
      ...state.data,
      sessions: state.data.sessions.map((s) => (s.id === id ? { ...s, statusId } : s))
    }
  })
  return {
    get: () => state.data,
    setSessionStatus,
    read: () => state.data
  }
}
function dataWith(sessions: Session[], extra: Partial<StoreData> = {}): StoreData {
  return {
    version: 1,
    sessions,
    groups: [],
    statuses: DEFAULT_STATUSES,
    groupOrder: [],
    ...extra
  }
}

describe('createAutoStatusApplier', () => {
  it('moves the session to the mapped status using the CURRENT store state', () => {
    const store = fakeStore(dataWith([session()]))
    const apply = createAutoStatusApplier({ store, onError: vi.fn() })

    apply('s1', 'working')

    expect(store.setSessionStatus).toHaveBeenCalledWith('s1', 'working')
    expect(store.read().sessions[0].statusId).toBe('working')
  })

  it('reads settings from the store (a disabled setting blocks the move)', () => {
    const disabled = { ...DEFAULT_APP_SETTINGS, autoStatus: { ...DEFAULT_APP_SETTINGS.autoStatus, enabled: false } }
    const store = fakeStore(dataWith([session()], { settings: disabled }))
    const apply = createAutoStatusApplier({ store, onError: vi.fn() })

    apply('s1', 'finished')

    expect(store.setSessionStatus).not.toHaveBeenCalled()
  })

  it('does nothing when no status comes back (same status, closed, unknown session)', () => {
    const store = fakeStore(dataWith([session({ statusId: 'working' }), session({ id: 'c', closedAt: 1 })]))
    const apply = createAutoStatusApplier({ store, onError: vi.fn() })

    apply('s1', 'working')
    apply('c', 'working')
    apply('ghost', 'working')

    expect(store.setSessionStatus).not.toHaveBeenCalled()
  })

  it('a store failure is reported through onError and not thrown', () => {
    const store = fakeStore(dataWith([session()]))
    store.setSessionStatus.mockImplementation(() => {
      throw new Error('disk full')
    })
    const onError = vi.fn()
    const apply = createAutoStatusApplier({ store, onError })

    expect(() => apply('s1', 'working')).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toContain('s1')
  })
})
