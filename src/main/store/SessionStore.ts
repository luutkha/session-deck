import type {
  AppSettings,
  ChecklistItem,
  CreateSessionInput,
  Group,
  Id,
  SettingsPatch,
  Session,
  StatusDef,
  StoreData
} from '../../shared/types'
import { resolveSettings } from '../../shared/types'
import { updateSettings as updateSettingsReducer } from './settings'
import {
  setSessionChecklist as setSessionChecklistReducer,
  setSessionNotes as setSessionNotesReducer
} from './sessionNotes'
import {
  closeSession as closeSessionReducer,
  reopenSession as reopenSessionReducer,
  createGroup as createGroupReducer,
  createSession as createSessionReducer,
  moveSession as moveSessionReducer,
  removeGroup as removeGroupReducer,
  removeSession as removeSessionReducer,
  removeStatus as removeStatusReducer,
  renameGroup as renameGroupReducer,
  renameSession as renameSessionReducer,
  reorderGroups as reorderGroupsReducer,
  reorderStatuses as reorderStatusesReducer,
  setClaudeSessionId as setClaudeSessionIdReducer,
  setOpencodeSessionId as setOpencodeSessionIdReducer,
  setKeepAwake as setKeepAwakeReducer,
  setGroupCollapsed as setGroupCollapsedReducer,
  setSessionStatus as setSessionStatusReducer,
  upsertStatus as upsertStatusReducer
} from './reducers'

export interface SessionStoreDeps {
  readonly newId: () => string
  readonly now: () => number
}

export interface SessionStoreSaver {
  readonly schedule: (data: StoreData) => void
}

export class SessionStore {
  private data: StoreData
  private readonly saver: SessionStoreSaver
  private readonly deps: SessionStoreDeps
  private readonly subscribers = new Set<(data: StoreData) => void>()

  constructor(initial: StoreData, saver: SessionStoreSaver, deps: SessionStoreDeps) {
    this.data = initial
    this.saver = saver
    this.deps = deps
  }

  get(): StoreData {
    return this.data
  }

  subscribe(callback: (data: StoreData) => void): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  private emit(data: StoreData): void {
    for (const callback of this.subscribers) {
      callback(data)
    }
  }

  createSession(input: CreateSessionInput): Session {
    const { data, session } = createSessionReducer(this.data, input, {
      id: this.deps.newId(),
      now: this.deps.now()
    })
    this.data = data
    this.saver.schedule(data)
    this.emit(data)
    return session
  }

  renameSession(id: Id, name: string): void {
    const next = renameSessionReducer(this.data, id, name)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  setSessionStatus(id: Id, statusId: Id | null): void {
    const next = setSessionStatusReducer(this.data, id, statusId)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  moveSession(id: Id, groupId: Id | null, index: number): void {
    const next = moveSessionReducer(this.data, id, groupId, index)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  removeSession(id: Id): void {
    const next = removeSessionReducer(this.data, id)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  createGroup(name: string): Group {
    const { data, group } = createGroupReducer(this.data, name, this.deps.newId())
    this.data = data
    this.saver.schedule(data)
    this.emit(data)
    return group
  }

  renameGroup(id: Id, name: string): void {
    const next = renameGroupReducer(this.data, id, name)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  removeGroup(id: Id): void {
    const next = removeGroupReducer(this.data, id)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  setGroupCollapsed(id: Id, collapsed: boolean): void {
    const next = setGroupCollapsedReducer(this.data, id, collapsed)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  reorderGroups(order: readonly Id[]): void {
    const next = reorderGroupsReducer(this.data, order)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  upsertStatus(status: StatusDef): void {
    const next = upsertStatusReducer(this.data, status)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  removeStatus(id: Id): void {
    const next = removeStatusReducer(this.data, id)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  reorderStatuses(order: readonly Id[]): void {
    const next = reorderStatusesReducer(this.data, order)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  setClaudeSessionId(id: Id, claudeSessionId: string): void {
    const next = setClaudeSessionIdReducer(this.data, id, claudeSessionId)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  /** Stores the OpenCode conversation id the injected plugin reported (persisted). No-op when identical. */
  setOpencodeSessionId(id: Id, opencodeSessionId: string): void {
    if (this.data.sessions.find((session) => session.id === id)?.opencodeSessionId === opencodeSessionId) return
    const next = setOpencodeSessionIdReducer(this.data, id, opencodeSessionId)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  /** Exempts the session from (or returns it to) the idle sleep timer (persisted). */
  setKeepAwake(id: Id, keepAwake: boolean): void {
    const next = setKeepAwakeReducer(this.data, id, keepAwake)
    if (next === this.data) return
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  setSessionNotes(id: Id, notes: string): void {
    const next = setSessionNotesReducer(this.data, id, notes)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  setSessionChecklist(id: Id, items: readonly ChecklistItem[]): void {
    const next = setSessionChecklistReducer(this.data, id, items)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  /** Resolved app settings (defaults filled in). */
  getSettings(): AppSettings {
    return resolveSettings(this.data.settings)
  }

  /** Merges the patch, saves and notifies. Returns the full resolved settings. Throws on invalid input (nothing changes). */
  updateSettings(patch: SettingsPatch): AppSettings {
    const next = updateSettingsReducer(this.data, patch)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
    return resolveSettings(next.settings)
  }

  /** Stamps closedAt with the store clock. No save or notification when already closed. */
  closeSession(id: Id): void {
    this.commitIfChanged(closeSessionReducer(this.data, id, this.deps.now()))
  }

  /** Clears closedAt. No save or notification when the session is not closed. */
  reopenSession(id: Id): void {
    this.commitIfChanged(reopenSessionReducer(this.data, id))
  }

  private commitIfChanged(next: StoreData): void {
    if (next === this.data) return
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }
}
