import { useSyncExternalStore, useCallback, useRef, useEffect, useMemo } from 'react'
import type { StoreData, RuntimeState, Session, Group, StatusDef, ChecklistItem, QueuedPrompt, SessionPreset, CreateSessionInput, Id, AppSettings, SettingsPatch } from '../../shared/types'
import type { Api } from '../../shared/ipc'
import { errorMessage } from '../../shared/guards'
import { shareStructure } from './shareStructure'
import { createRuntimeBatch } from './runtimeBatch'

/** Longest delay of a runtime event behind the one before it (the first one of a quiet period is not delayed). */
const RUNTIME_BATCH_MS = 100

type Listener = () => void

interface StoreSnapshot {
  readonly data: StoreData | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastError: string | null
}

export interface SessionActions {
  createSession: (input: CreateSessionInput) => Promise<Session>
  /** D52: a new Claude session on a copy of this session's conversation. */
  forkSession: (id: Id) => Promise<Session>
  /** D88: moves an Ops session into a Code-mode worktree (same card, new folder, fresh conversation). */
  moveSessionToCode: (id: Id, worktreeId: Id) => Promise<Session>
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
  setSessionQueue: (id: Id, items: readonly QueuedPrompt[]) => Promise<void>
  sendQueuedNow: (id: Id, promptId: string) => Promise<void>
  savePreset: (preset: SessionPreset) => Promise<void>
  removePreset: (id: Id) => Promise<void>
  pickFolder: () => Promise<string | null>
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
}

export interface UseSessionStoreResult {
  readonly data: StoreData | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastError: string | null
  readonly clearError: () => void
  readonly actions: SessionActions
}

export function useSessionStore(): UseSessionStoreResult {
  const snapshotRef = useRef<StoreSnapshot>({ data: null, runtime: new Map(), lastError: null })
  const listenersRef = useRef<Set<Listener>>(new Set())
  const apiRef = useRef<Api | null>(null)
  const unsubStoreRef = useRef<(() => void) | null>(null)
  const unsubRuntimeRef = useRef<(() => void) | null>(null)
  const unsubNoticeRef = useRef<(() => void) | null>(null)

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) {
      listener()
    }
  }, [])

  const clearError = useCallback(() => {
    snapshotRef.current = { ...snapshotRef.current, lastError: null }
    notify()
  }, [notify])

  const setError = useCallback((message: string) => {
    snapshotRef.current = { ...snapshotRef.current, lastError: message }
    notify()
  }, [notify])

  const updateData = useCallback((data: StoreData) => {
    // Runtime entries of sessions that are no longer in the store are dropped.
    const previousRuntime = snapshotRef.current.runtime
    const nextRuntime = new Map<Id, RuntimeState>()
    for (const session of data.sessions) {
      const state = previousRuntime.get(session.id)
      if (state !== undefined) {
        nextRuntime.set(session.id, state)
      }
    }
    // A broadcast replaces the whole store with new objects; share the unchanged subtrees so memo'd
    // components (sessions, settings) keep their identity.
    const previousData = snapshotRef.current.data
    const dataToKeep = previousData === null ? data : shareStructure(previousData, data)
    snapshotRef.current = { ...snapshotRef.current, data: dataToKeep, runtime: nextRuntime }
    notify()
  }, [notify])

  const applyRuntime = useCallback((states: readonly RuntimeState[]) => {
    const newRuntime = new Map(snapshotRef.current.runtime)
    for (const state of states) {
      newRuntime.set(state.sessionId, state)
    }
    snapshotRef.current = { ...snapshotRef.current, runtime: newRuntime }
    notify()
  }, [notify])

  // Runtime events arrive per session several times a second with many agents: one render per RUNTIME_BATCH_MS at most.
  const runtimeBatch = useMemo(() => createRuntimeBatch<ReturnType<typeof setTimeout>>({
    apply: applyRuntime,
    intervalMs: RUNTIME_BATCH_MS,
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (handle) => { clearTimeout(handle) }
  }), [applyRuntime])
  const updateRuntime = useCallback((state: RuntimeState) => { runtimeBatch.push(state) }, [runtimeBatch])

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
          snapshotRef.current = { data, runtime: new Map(runtime.map(r => [r.sessionId, r])), lastError: null }
          notify()
        }).catch(err => {
          setError(errorMessage(err))
        })

        unsubStoreRef.current = api.onStoreChanged(updateData)
        unsubRuntimeRef.current = api.onRuntime(updateRuntime)
        // D79: a one-line advisory notice from main uses the existing banner (same slot as an action error).
        unsubNoticeRef.current = typeof api.onNotice === 'function' ? api.onNotice(setError) : null
      } catch (err) {
        setError(errorMessage(err))
      }
    } else {
      setError('Application bridge not available')
    }

    return (): void => {
      unsubStoreRef.current?.()
      unsubRuntimeRef.current?.()
      unsubNoticeRef.current?.()
      runtimeBatch.dispose()
      unsubStoreRef.current = null
      unsubRuntimeRef.current = null
      unsubNoticeRef.current = null
    }
  }, [notify, updateData, updateRuntime, runtimeBatch, setError])

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
      forkSession: (id) => call((api) => api.forkSession(id)),
      moveSessionToCode: (id, worktreeId) => call((api) => api.moveSessionToCode(id, worktreeId)),
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
      setSessionQueue: (id, items) => call((api) => api.setSessionQueue(id, items)),
      sendQueuedNow: (id, promptId) => call((api) => api.sendQueuedNow(id, promptId)),
      savePreset: (preset) => call((api) => api.savePreset(preset)),
      removePreset: (id) => call((api) => api.removePreset(id)),
      pickFolder: () => call((api) => api.pickFolder()),
      updateSettings: (patch) => call((api) => api.updateSettings(patch))
    }
  }, [setError])

  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return {
    data: store.data,
    runtime: store.runtime,
    lastError: store.lastError,
    clearError,
    actions
  }
}