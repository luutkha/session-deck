// IPC contract. Renderer -> main via invoke (request/response); main -> renderer via events.
import type {
  AppSettings, ChecklistItem, CreateSessionInput, Group, Id, RuntimeState, Session, StatusDef, StoreData, LoginItemState, QuotaAlert, SettingsPatch, SoundEvent, UsageRefreshResult, UsageState
} from './types'

export const IPC = {
  // store (renderer -> main, invoke)
  storeGet: 'store:get',
  sessionCreate: 'session:create',
  sessionRename: 'session:rename',
  sessionSetStatus: 'session:setStatus',
  sessionMove: 'session:move', // to group + index
  sessionRemove: 'session:remove',
  sessionClose: 'session:close', // kill process + mark closed (moves to the Closed section)
  sessionReopen: 'session:reopen', // clear closed + start with --resume
  sessionSetNotes: 'session:setNotes', // (id, notes string <= 20000 chars)
  sessionSetChecklist: 'session:setChecklist', // (id, items <= 100; ids unique; text 1..300)
  sessionSetActive: 'session:setActive', // renderer tells main which session is on screen (attention is suppressed for it)
  groupCreate: 'group:create',
  groupRename: 'group:rename',
  groupRemove: 'group:remove', // sessions become ungrouped
  groupSetCollapsed: 'group:setCollapsed',
  groupReorder: 'group:reorder',
  statusUpsert: 'status:upsert',
  statusRemove: 'status:remove',
  statusReorder: 'status:reorder', // order = exact permutation of all status ids; the array order is the Hub column order
  // pty (renderer -> main)
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyRestart: 'pty:restart',
  ptyReplay: 'pty:replay', // invoke -> PtyReplay (buffered output for reattach)
  // attention
  attentionClear: 'attention:clear',
  settingsSetSound: 'settings:setSound',
  // dialogs
  pickFolder: 'dialog:pickFolder',
  settingsUpdate: 'settings:update', // SettingsPatch -> the full resolved AppSettings (also persisted in StoreData.settings)
  loginItemGet: 'app:loginItemGet',
  loginItemSet: 'app:loginItemSet', // start SessionDeck when the user signs in to Windows (packaged app only)
  appQuit: 'app:quit', // really quit (the window close button may only hide to the tray)
  usageGet: 'usage:get',
  usageRefresh: 'usage:refresh', // manual: ask Anthropic's usage endpoint with the local Claude login token (main process only)
  pickSoundFile: 'dialog:pickSoundFile', // audio file picker for custom notification sounds -> absolute path | null
  // events main -> renderer
  evStoreChanged: 'ev:store',
  evRuntime: 'ev:runtime',
  evPtyData: 'ev:ptyData',
  evUsage: 'ev:usage', // main -> renderer: UsageState changed
  evSound: 'ev:sound', // main -> renderer: play the user's sound for (sessionId, event); sessionId is '' for 'quota'
  evFocusSession: 'ev:focusSession', // main -> renderer: select/open this session (tray menu, notification click)
  evQuota: 'ev:quota' // main -> renderer: QuotaAlert for an in-app toast
} as const

/** Buffered output for reattach. `seq` = sequence number of the last chunk included (0 if none).
 *  Live chunks carry increasing `seq` per session; the renderer drops live chunks with seq <= replay.seq. */
export interface PtyReplay {
  readonly data: string
  readonly seq: number
}

export interface Api {
  getStore(): Promise<{ data: StoreData; runtime: readonly RuntimeState[] }>
  createSession(input: CreateSessionInput): Promise<Session>
  renameSession(id: Id, name: string): Promise<void>
  setSessionStatus(id: Id, statusId: Id | null): Promise<void>
  moveSession(id: Id, groupId: Id | null, index: number): Promise<void>
  removeSession(id: Id): Promise<void>
  closeSession(id: Id): Promise<void>
  reopenSession(id: Id): Promise<void>
  createGroup(name: string): Promise<Group>
  renameGroup(id: Id, name: string): Promise<void>
  removeGroup(id: Id): Promise<void>
  setGroupCollapsed(id: Id, collapsed: boolean): Promise<void>
  reorderGroups(order: readonly Id[]): Promise<void>
  upsertStatus(status: StatusDef): Promise<void>
  removeStatus(id: Id): Promise<void>
  reorderStatuses(order: readonly Id[]): Promise<void>
  setSessionNotes(id: Id, notes: string): Promise<void>
  setSessionChecklist(id: Id, items: readonly ChecklistItem[]): Promise<void>
  getUsage(): Promise<UsageState>
  updateSettings(patch: SettingsPatch): Promise<AppSettings>
  getLoginItem(): Promise<LoginItemState>
  setLoginItem(openAtLogin: boolean): Promise<LoginItemState>
  quitApp(): Promise<void>
  refreshUsage(): Promise<UsageRefreshResult>
  ptyWrite(id: Id, data: string): void
  ptyResize(id: Id, cols: number, rows: number): void
  ptyRestart(id: Id): Promise<void>
  ptyReplay(id: Id): Promise<PtyReplay>
  clearAttention(id: Id): void
  setActiveSession(id: Id | null): void
  setSoundEnabled(enabled: boolean): Promise<void>
  pickFolder(): Promise<string | null>
  pickSoundFile(): Promise<string | null>
  onStoreChanged(cb: (data: StoreData) => void): () => void
  onRuntime(cb: (state: RuntimeState) => void): () => void
  onPtyData(cb: (id: Id, data: string, seq: number) => void): () => void
  onUsage(cb: (state: UsageState) => void): () => void
  onAttentionSound(cb: (id: Id, event: SoundEvent) => void): () => void
  onFocusSession(cb: (id: Id) => void): () => void
  onQuotaAlert(cb: (alert: QuotaAlert) => void): () => void
}

declare global {
  interface Window { api: Api }
}
