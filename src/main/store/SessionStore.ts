import type {
  AppSettings,
  ChecklistItem,
  QueuedPrompt,
  SessionPreset,
  CreateSessionInput,
  Group,
  Id,
  Repo,
  SettingsPatch,
  Session,
  StatusDef,
  StoreData,
  Worktree
} from '../../shared/types'
import { resolveSettings } from '../../shared/types'
import { updateSettings as updateSettingsReducer } from './settings'
import {
  addRepo as addRepoReducer,
  addWorktree as addWorktreeReducer,
  findRepo,
  findWorktree,
  removeRepo as removeRepoReducer,
  removeWorktree as removeWorktreeReducer,
  setRepoCollapsed as setRepoCollapsedReducer,
  setWorktreeCollapsed as setWorktreeCollapsedReducer,
  type AddRepoInput,
  type WorktreeDraft
} from './codeReducers'
import { removePreset as removePresetReducer, upsertPreset } from './presets'
import {
  setSessionChecklist as setSessionChecklistReducer,
  setSessionQueue as setSessionQueueReducer,
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
  setSessionModel as setSessionModelReducer,
  setKeepAwake as setKeepAwakeReducer,
  setLastActiveAt as setLastActiveAtReducer,
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

  /** D79: sets or clears the OpenCode model of a session (persisted). No-op when identical. */
  setSessionModel(id: Id, model: string | undefined): void {
    this.commitIfChanged(setSessionModelReducer(this.data, id, model))
  }

  /** Exempts the session from (or returns it to) the idle sleep timer (persisted). */
  setKeepAwake(id: Id, keepAwake: boolean): void {
    const next = setKeepAwakeReducer(this.data, id, keepAwake)
    if (next === this.data) return
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  /** D61: when the session was last active (the "Last active" sort). Unknown id or same value = no-op. */
  setLastActiveAt(id: Id, at: number): void {
    const next = setLastActiveAtReducer(this.data, id, at)
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

  /** D49: adds a preset or replaces the one with the same id. */
  savePreset(preset: SessionPreset): void {
    const next = upsertPreset(this.data, preset)
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  removePreset(id: Id): void {
    const next = removePresetReducer(this.data, id)
    if (next === this.data) return
    this.data = next
    this.saver.schedule(next)
    this.emit(next)
  }

  setSessionQueue(id: Id, items: readonly QueuedPrompt[]): void {
    const next = setSessionQueueReducer(this.data, id, items)
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

  /** Code mode: adds a repo (or returns the one already stored with that path). Saves only when something was added. */
  addRepo(input: AddRepoInput): Repo {
    const { data, repo } = addRepoReducer(this.data, input, { id: this.deps.newId(), now: this.deps.now() })
    this.commitIfChanged(data)
    return repo
  }

  /** Removes the repo with its worktrees and their sessions (the controller stops the processes first). */
  removeRepo(id: Id): void {
    this.commitIfChanged(removeRepoReducer(this.data, id))
  }

  setRepoCollapsed(id: Id, collapsed: boolean): void {
    this.commitIfChanged(setRepoCollapsedReducer(this.data, id, collapsed))
  }

  /** Code mode: adds a worktree to a stored repo. Throws `Repo not found` or `Worktree already added`. */
  addWorktree(input: WorktreeDraft): Worktree {
    const { data, worktree } = addWorktreeReducer(this.data, input, { id: this.deps.newId(), now: this.deps.now() })
    this.commitIfChanged(data)
    return worktree
  }

  /** Removes the worktree and its sessions (the controller stops the processes first). */
  removeWorktree(id: Id): void {
    this.commitIfChanged(removeWorktreeReducer(this.data, id))
  }

  setWorktreeCollapsed(id: Id, collapsed: boolean): void {
    this.commitIfChanged(setWorktreeCollapsedReducer(this.data, id, collapsed))
  }

  getRepo(id: Id): Repo | undefined {
    return findRepo(this.data, id)
  }

  getWorktree(id: Id): Worktree | undefined {
    return findWorktree(this.data, id)
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
