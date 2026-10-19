import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  ChecklistItem,
  CreateSessionInput,
  Group,
  Id,
  LoginItemState,
  OpenLinkResult,
  ResolvedLink,
  WorkerInfo,
  QuotaAlert,
  RuntimeState,
  Session,
  SettingsPatch,
  SoundEvent,
  StatusDef,
  StoreData,
  UsageRefreshResult,
  UsageState
} from '../shared/types'
import type { PtyReplay } from '../shared/ipc'

const api: Api = {
  getStore(): Promise<{ data: StoreData; runtime: readonly RuntimeState[] }> {
    return ipcRenderer.invoke(IPC.storeGet)
  },

  createSession(input: CreateSessionInput): Promise<Session> {
    return ipcRenderer.invoke(IPC.sessionCreate, input)
  },

  renameSession(id: Id, name: string): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionRename, id, name)
  },

  setSessionStatus(id: Id, statusId: Id | null): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSetStatus, id, statusId)
  },

  moveSession(id: Id, groupId: Id | null, index: number): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionMove, id, groupId, index)
  },

  removeSession(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionRemove, id)
  },

  closeSession(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionClose, id)
  },

  reopenSession(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionReopen, id)
  },

  setKeepAwake(id: Id, keepAwake: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSetKeepAwake, id, keepAwake)
  },
  setSessionNotes(id: Id, notes: string): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSetNotes, id, notes)
  },

  setSessionChecklist(id: Id, items: readonly ChecklistItem[]): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSetChecklist, id, items)
  },

  getUsage(): Promise<UsageState> {
    return ipcRenderer.invoke(IPC.usageGet)
  },

  getWorkers(): Promise<readonly WorkerInfo[]> {
    return ipcRenderer.invoke(IPC.workersGet)
  },

  refreshUsage(): Promise<UsageRefreshResult> {
    return ipcRenderer.invoke(IPC.usageRefresh)
  },

  createGroup(name: string): Promise<Group> {
    return ipcRenderer.invoke(IPC.groupCreate, name)
  },

  renameGroup(id: Id, name: string): Promise<void> {
    return ipcRenderer.invoke(IPC.groupRename, id, name)
  },

  removeGroup(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.groupRemove, id)
  },

  setGroupCollapsed(id: Id, collapsed: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.groupSetCollapsed, id, collapsed)
  },

  reorderGroups(order: readonly Id[]): Promise<void> {
    return ipcRenderer.invoke(IPC.groupReorder, order)
  },

  upsertStatus(status: StatusDef): Promise<void> {
    return ipcRenderer.invoke(IPC.statusUpsert, status)
  },

  removeStatus(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.statusRemove, id)
  },

  reorderStatuses(order: readonly Id[]): Promise<void> {
    return ipcRenderer.invoke(IPC.statusReorder, order)
  },

  updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },

  getLoginItem(): Promise<LoginItemState> {
    return ipcRenderer.invoke(IPC.loginItemGet)
  },

  setLoginItem(openAtLogin: boolean): Promise<LoginItemState> {
    return ipcRenderer.invoke(IPC.loginItemSet, openAtLogin)
  },

  resolveLinks(sessionId: Id, candidates: readonly string[]): Promise<readonly (ResolvedLink | null)[]> {
    return ipcRenderer.invoke(IPC.linkResolve, sessionId, candidates)
  },

  openLink(sessionId: Id, text: string, reveal: boolean): Promise<OpenLinkResult> {
    return ipcRenderer.invoke(IPC.linkOpen, sessionId, text, reveal)
  },

  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },

  sleepSession(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSleep, id)
  },

  quitApp(): Promise<void> {
    return ipcRenderer.invoke(IPC.appQuit)
  },

  ptyWrite(id: Id, data: string): void {
    ipcRenderer.send(IPC.ptyWrite, id, data)
  },

  ptyResize(id: Id, cols: number, rows: number): void {
    ipcRenderer.send(IPC.ptyResize, id, cols, rows)
  },

  ptyRestart(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.ptyRestart, id)
  },

  ptyReplay(id: Id): Promise<PtyReplay> {
    return ipcRenderer.invoke(IPC.ptyReplay, id)
  },

  clearAttention(id: Id): void {
    ipcRenderer.send(IPC.attentionClear, id)
  },

  markUnread(id: Id): void {
    ipcRenderer.send(IPC.attentionMarkUnread, id)
  },

  setActiveSession(id: Id | null): void {
    ipcRenderer.send(IPC.sessionSetActive, id)
  },

  setSoundEnabled(enabled: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.settingsSetSound, enabled)
  },

  pickFolder(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.pickFolder)
  },

  pickSoundFile(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.pickSoundFile)
  },

  onStoreChanged(cb: (data: StoreData) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, data: StoreData) => cb(data)
    ipcRenderer.on(IPC.evStoreChanged, handler)
    return () => ipcRenderer.off(IPC.evStoreChanged, handler)
  },

  onRuntime(cb: (state: RuntimeState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: RuntimeState) => cb(state)
    ipcRenderer.on(IPC.evRuntime, handler)
    return () => ipcRenderer.off(IPC.evRuntime, handler)
  },

  onUsage(cb: (state: UsageState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: UsageState) => cb(state)
    ipcRenderer.on(IPC.evUsage, handler)
    return () => ipcRenderer.off(IPC.evUsage, handler)
  },

  onPtyData(cb: (id: Id, data: string, seq: number) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, id: Id, data: string, seq: number) => cb(id, data, seq)
    ipcRenderer.on(IPC.evPtyData, handler)
    return () => ipcRenderer.off(IPC.evPtyData, handler)
  },

  onAttentionSound(cb: (id: Id, event: SoundEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, id: Id, event: SoundEvent) => cb(id, event)
    ipcRenderer.on(IPC.evSound, handler)
    return () => ipcRenderer.off(IPC.evSound, handler)
  },

  onFocusSession(cb: (id: Id) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, id: Id) => cb(id)
    ipcRenderer.on(IPC.evFocusSession, handler)
    return () => ipcRenderer.off(IPC.evFocusSession, handler)
  },

  onQuotaAlert(cb: (alert: QuotaAlert) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, alert: QuotaAlert) => cb(alert)
    ipcRenderer.on(IPC.evQuota, handler)
    return () => ipcRenderer.off(IPC.evQuota, handler)
  },

  onWorkers(cb: (workers: readonly WorkerInfo[]) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, workers: readonly WorkerInfo[]) => cb(workers)
    ipcRenderer.on(IPC.evWorkers, handler)
    return () => ipcRenderer.off(IPC.evWorkers, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
