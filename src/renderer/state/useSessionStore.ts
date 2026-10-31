import { useSyncExternalStore, useCallback, useRef, useEffect, useMemo } from 'react'
import type { StoreData, RuntimeState, Session, Group, StatusDef, ChecklistItem, CreateSessionInput, Id, AppSettings, SettingsPatch } from '../../shared/types'
import type { Api } from '../../shared/ipc'
import { errorMessage } from '../../shared/guards'

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
          setError(errorMessage(err))
        })

        unsubStoreRef.current = api.onStoreChanged(updateData)
        unsubRuntimeRef.current = api.onRuntime(updateRuntime)
      } catch (err) {
        setError(errorMessage(err))
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

  // One wrapper for every call into main: a rejection is shown in the store banner and still reaches the caller.
  const actions = useMemo((): SessionActions => {
    async function call<T>(run: (api: Api) => Promise<T>): Promise<T> {
      try {
        return await run(apiRef.current!)
      } catch (err) {
        setError(errorMessage(err))
        throw err
      }
    }
    return {
      createSession: (input) => call((api) => api.createSession(input)),
      renameSession: (id, name) => call((api) => api.renameSession(id, name)),
      setSessionStatus: (id, statusId) => call((api) => api.setSessionStatus(id, statusId)),
      moveSession: (id, groupId, index) => call((api) => api.moveSession(id, groupId, index)),
      removeSession: (id) => call((api) => api.removeSession(id)),
      closeSession: (id) => call((api) => api.closeSession(id)),
      reopenSession: (id) => call((api) => api.reopenSession(id)),
      createGroup: (name) => call((api) => api.createGroup(name)),
      renameGroup: (id, name) => call((api) => api.renameGroup(id, name)),
      removeGroup: (id) => call((api) => api.removeGroup(id)),
      setGroupCollapsed: (id, collapsed) => call((api) => api.setGroupCollapsed(id, collapsed)),
      reorderGroups: (order) => call((api) => api.reorderGroups(order)),
      upsertStatus: (status) => call((api) => api.upsertStatus(status)),
      removeStatus: (id) => call((api) => api.removeStatus(id)),
      reorderStatuses: (order) => call((api) => api.reorderStatuses(order)),
      setSessionNotes: (id, notes) => call((api) => api.setSessionNotes(id, notes)),
      setSessionChecklist: (id, items) => call((api) => api.setSessionChecklist(id, items)),
      pickFolder: () => call((api) => api.pickFolder()),
      updateSettings: (patch) => call((api) => api.updateSettings(patch))
    }
  }, [setError])

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