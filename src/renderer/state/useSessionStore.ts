import { useSyncExternalStore, useCallback, useRef, useEffect } from 'react'
import type { StoreData, RuntimeState, Session, Group, StatusDef, ChecklistItem, CreateSessionInput, Id, AppSettings, SettingsPatch } from '../../shared/types'
import type { Api } from '../../shared/ipc'

type Listener = () => void

interface StoreSnapshot {
  readonly data: StoreData | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly runtimeLastChange: ReadonlyMap<Id, number>
  readonly lastError: string | null
}

function createStoreSnapshot(
  data: StoreData | null,
  runtime: ReadonlyMap<Id, RuntimeState>,
  runtimeLastChange: ReadonlyMap<Id, number>,
  lastError: string | null
): StoreSnapshot {
  return { data, runtime, runtimeLastChange, lastError }
}

export interface SessionActions {
  createSession: (input: CreateSessionInput) => Promise<Session>
  renameSession: (id: Id, name: string) => Promise<void>
  setSessionStatus: (id: Id, statusId: Id | null) => Promise<void>
  moveSession: (id: Id, groupId: Id | null, index: number) => Promise<void>
  removeSession: (id: Id) => Promise<void>
  closeSession: (id: Id) => Promise<void>
  reopenSession: (id: Id) => Promise<void>
  createGroup: (name: string) => Promise<Group>
  renameGroup: (id: Id, name: string) => Promise<void>
  removeGroup: (id: Id) => Promise<void>
  setGroupCollapsed: (id: Id, collapsed: boolean) => Promise<void>
  reorderGroups: (order: readonly Id[]) => Promise<void>
  upsertStatus: (status: StatusDef) => Promise<void>
  removeStatus: (id: Id) => Promise<void>
  reorderStatuses: (order: readonly Id[]) => Promise<void>
  setSessionNotes: (id: Id, notes: string) => Promise<void>
  setSessionChecklist: (id: Id, items: readonly ChecklistItem[]) => Promise<void>
  pickFolder: () => Promise<string | null>
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
}

export interface UseSessionStoreResult {
  readonly data: StoreData | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly runtimeLastChange: ReadonlyMap<Id, number>
  readonly lastError: string | null
  readonly clearError: () => void
  readonly actions: SessionActions
}

export function useSessionStore(): UseSessionStoreResult {
  const snapshotRef = useRef<StoreSnapshot>(createStoreSnapshot(null, new Map(), new Map(), null))
  const listenersRef = useRef<Set<Listener>>(new Set())
  const apiRef = useRef<Api | null>(null)
  const unsubStoreRef = useRef<(() => void) | null>(null)
  const unsubRuntimeRef = useRef<(() => void) | null>(null)

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) {
      listener()
    }
  }, [])

  const clearError = useCallback(() => {
    snapshotRef.current = createStoreSnapshot(
      snapshotRef.current.data,
      snapshotRef.current.runtime,
      snapshotRef.current.runtimeLastChange,
      null
    )
    notify()
  }, [notify])

  const setError = useCallback((message: string) => {
    snapshotRef.current = createStoreSnapshot(
      snapshotRef.current.data,
      snapshotRef.current.runtime,
      snapshotRef.current.runtimeLastChange,
      message
    )
    notify()
  }, [notify])

  const updateData = useCallback((data: StoreData) => {
    const previousRuntime = snapshotRef.current.runtime
    const nextRuntime = new Map<Id, RuntimeState>()
    const nextLastChange = new Map<Id, number>()
    for (const session of data.sessions) {
      const state = previousRuntime.get(session.id)
      if (state !== undefined) {
        nextRuntime.set(session.id, state)
        const previous = snapshotRef.current.runtimeLastChange.get(session.id)
        if (previous !== undefined) {
          nextLastChange.set(session.id, previous)
        } else {
          nextLastChange.set(session.id, session.createdAt)
        }
      }
    }
    snapshotRef.current = createStoreSnapshot(
      data,
      nextRuntime,
      nextLastChange,
      snapshotRef.current.lastError
    )
    notify()
  }, [notify])

  const updateRuntime = useCallback((state: RuntimeState) => {
    const previousRuntime = snapshotRef.current.runtime
    const newRuntime = new Map(previousRuntime)
    newRuntime.set(state.sessionId, state)
    // A runtime event just arrived for this session: stamp it "now".
    const newLastChange = new Map(snapshotRef.current.runtimeLastChange)
    newLastChange.set(state.sessionId, Date.now())
    snapshotRef.current = createStoreSnapshot(
      snapshotRef.current.data,
      newRuntime,
      newLastChange,
      snapshotRef.current.lastError
    )
    notify()
  }, [notify])

  const getSnapshot = useCallback(() => snapshotRef.current, [])

  const getServerSnapshot = useCallback(() => snapshotRef.current, [])

  const subscribe = useCallback((callback: Listener) => {
    listenersRef.current.add(callback)
    return () => {
      listenersRef.current.delete(callback)
    }
  }, [])

  useEffect((): (() => void) => {
    const api: Api | undefined = typeof window !== 'undefined' ? window.api : undefined

    if (typeof api?.getStore === 'function') {
      apiRef.current = api
      try {
        api.getStore().then(({ data, runtime }) => {
          const runtimeMap = new Map(runtime.map(r => [r.sessionId, r]))
          const lastChange = new Map<Id, number>()
          for (const session of data.sessions) {
            lastChange.set(session.id, session.createdAt)
          }
          snapshotRef.current = createStoreSnapshot(data, runtimeMap, lastChange, null)
          notify()
        }).catch(err => {
          setError(err instanceof Error ? err.message : String(err))
        })

        unsubStoreRef.current = api.onStoreChanged(updateData)
        unsubRuntimeRef.current = api.onRuntime(updateRuntime)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } else {
      setError('Application bridge not available')
    }

    return (): void => {
      unsubStoreRef.current?.()
      unsubRuntimeRef.current?.()
      unsubStoreRef.current = null
      unsubRuntimeRef.current = null
    }
  }, [notify, updateData, updateRuntime, setError])

  const actions: SessionActions = {
    createSession: async (input: CreateSessionInput) => {
      try {
        return await apiRef.current!.createSession(input)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    renameSession: async (id: Id, name: string) => {
      try {
        await apiRef.current!.renameSession(id, name)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    setSessionStatus: async (id: Id, statusId: Id | null) => {
      try {
        await apiRef.current!.setSessionStatus(id, statusId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    moveSession: async (id: Id, groupId: Id | null, index: number) => {
      try {
        await apiRef.current!.moveSession(id, groupId, index)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    removeSession: async (id: Id) => {
      try {
        await apiRef.current!.removeSession(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    closeSession: async (id: Id) => {
      try {
        await apiRef.current!.closeSession(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    reopenSession: async (id: Id) => {
      try {
        await apiRef.current!.reopenSession(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    createGroup: async (name: string) => {
      try {
        return await apiRef.current!.createGroup(name)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    renameGroup: async (id: Id, name: string) => {
      try {
        await apiRef.current!.renameGroup(id, name)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    removeGroup: async (id: Id) => {
      try {
        await apiRef.current!.removeGroup(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    setGroupCollapsed: async (id: Id, collapsed: boolean) => {
      try {
        await apiRef.current!.setGroupCollapsed(id, collapsed)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    reorderGroups: async (order: readonly Id[]) => {
      try {
        await apiRef.current!.reorderGroups(order)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    upsertStatus: async (status: StatusDef) => {
      try {
        await apiRef.current!.upsertStatus(status)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    removeStatus: async (id: Id) => {
      try {
        await apiRef.current!.removeStatus(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    reorderStatuses: async (order: readonly Id[]) => {
      try {
        await apiRef.current!.reorderStatuses(order)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    setSessionNotes: async (id: Id, notes: string) => {
      try {
        await apiRef.current!.setSessionNotes(id, notes)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    setSessionChecklist: async (id: Id, items: readonly ChecklistItem[]) => {
      try {
        await apiRef.current!.setSessionChecklist(id, items)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    pickFolder: async () => {
      try {
        return await apiRef.current!.pickFolder()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    updateSettings: async (patch: SettingsPatch) => {
      try {
        return await apiRef.current!.updateSettings(patch)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    }
  }

  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return {
    data: store.data,
    runtime: store.runtime,
    runtimeLastChange: store.runtimeLastChange,
    lastError: store.lastError,
    clearError,
    actions
  }
}