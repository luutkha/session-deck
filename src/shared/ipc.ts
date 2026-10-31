// IPC contract. Renderer -> main via invoke (request/response); main -> renderer via events.
import type {
  AppSettings, ChecklistItem, QueuedPrompt, SessionPreset, CreateSessionInput, Group, Id, RuntimeState, Session, StatusDef, StoreData, LoginItemState, OpenLinkResult, QuotaAlert, ResolvedLink, SettingsPatch, SoundEvent, UsageRefreshResult, UsageState, WorkerInfo, TimelineTurn, AwaySummary, QuotaAutopilotState,
  Repo, RepoBranches, CreateWorktreeInput, CreateWorktreeResult, WorktreeChanges, FileDiff, FilePreview, WindowState, WindowRole
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
  sessionSetKeepAwake: 'session:setKeepAwake', // (id, keepAwake boolean) exempt a session from the idle sleep timer
  sessionSetNotes: 'session:setNotes', // (id, notes string <= 20000 chars)
  sessionSetChecklist: 'session:setChecklist', // (id, items <= 100; ids unique; text 1..300)
  sessionSetQueue: 'session:setQueue', // (id, prompts <= 20; ids unique; text 1..4000) D47 prompt queue
  presetSave: 'preset:save', // (preset) D49: add or replace a saved New Session form (max 30)
  presetRemove: 'preset:remove', // (id) D49
  sessionSendQueuedNow: 'session:sendQueuedNow', // (id, promptId) type that queued prompt now and drop it from the queue (D47)
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
  attentionMarkUnread: 'attention:markUnread', // the user flags a session (silent bell)
  appUserActivity: 'app:userActivity', // fire-and-forget, no args: the user pressed a key / clicked / scrolled in the window (throttled by the renderer)
  settingsSetSound: 'settings:setSound',
  // dialogs
  pickFolder: 'dialog:pickFolder',
  settingsUpdate: 'settings:update', // SettingsPatch -> the full resolved AppSettings (also persisted in StoreData.settings)
  loginItemGet: 'app:loginItemGet',
  loginItemSet: 'app:loginItemSet', // start SessionDeck when the user signs in to Windows (packaged app only)
  linkResolve: 'link:resolve', // (sessionId, candidates[]) -> (ResolvedLink | null)[]; main checks the file system
  linkOpen: 'link:open', // (sessionId, text, reveal) -> OpenLinkResult; main re-resolves, never trusts the renderer
  sessionSleep: 'session:sleep', // stop the Claude process of a session (card and conversation stay); activating it later resumes it
  appQuit: 'app:quit', // really quit (the window close button may only hide to the tray)
  usageGet: 'usage:get',
  usageRefresh: 'usage:refresh', // manual: ask Anthropic's usage endpoint with the local Claude login token (main process only)
  pickSoundFile: 'dialog:pickSoundFile', // audio file picker for custom notification sounds -> absolute path | null
  workersGet: 'workers:get', // -> WorkerInfo[] (OpenCode workers started from inside open Claude sessions)
  timelineGet: 'timeline:get', // (sessionId) -> TimelineTurn[] newest first (D29)
  awayGetLast: 'away:getLast', // -> AwaySummary | null: the last non-empty summary of this app run
  quotaAutopilotGet: 'quota:autopilotGet', // -> QuotaAutopilotState (D30)
  quotaSleepIdle: 'quota:sleepIdle', // -> Id[] slept: open, running, not-working sessions except Keep awake / Remote Control
  quotaWake: 'quota:wake', // ({ sendContinue: boolean }) -> Id[] woken: the sessions held by the autopilot, in the background
  // Code mode (D31)
  repoAdd: 'repo:add', // (folder path) -> Repo; the git top-level of that folder; an already added repo is returned as is
  repoRemove: 'repo:remove', // (repoId) removes the repo, its worktrees and their sessions from SessionDeck; files and branches stay on disk
  repoSetCollapsed: 'repo:setCollapsed', // (repoId, collapsed)
  repoBranches: 'repo:branches', // (repoId) -> RepoBranches
  worktreeCreate: 'worktree:create', // (CreateWorktreeInput) -> CreateWorktreeResult: git worktree add -b, then the first session starts in it
  worktreeRemove: 'worktree:remove', // (worktreeId) stops and removes its sessions and forgets it; the folder and branch stay on disk
  worktreeSetCollapsed: 'worktree:setCollapsed', // (worktreeId, collapsed)
  worktreeChanges: 'worktree:changes', // (worktreeId) -> WorktreeChanges (recomputed now)
  worktreeFileDiff: 'worktree:fileDiff', // (worktreeId, path) -> FileDiff; path must be one of the current changed files
  filePreviewRead: 'file:previewRead', // (worktreeId, path) -> FilePreview; renderable files of the worktree (Code mode)
  windowGetState: 'window:getState', // -> WindowState
  windowPopOutCode: 'window:popOutCode', // opens (or focuses) the separate Code window
  windowDockCode: 'window:dockCode', // closes the Code window; Code mode returns to the main window's switch
  // events main -> renderer
  evStoreChanged: 'ev:store',
  evRuntime: 'ev:runtime',
  evPtyData: 'ev:ptyData',
  evUsage: 'ev:usage', // main -> renderer: UsageState changed
  evSound: 'ev:sound', // main -> renderer: play the user's sound for (sessionId, event); sessionId is '' for 'quota'
  evFocusSession: 'ev:focusSession', // main -> renderer: select/open this session (tray menu, notification click)
  evQuota: 'ev:quota', // main -> renderer: QuotaAlert for an in-app toast
  evWorkers: 'ev:workers', // main -> renderer: the full WorkerInfo[] changed
  evTimeline: 'ev:timeline', // main -> renderer: (sessionId) that session's timeline changed; refetch with timelineGet
  evAwaySummary: 'ev:awaySummary', // main -> renderer: AwaySummary (non-empty) when the user comes back
  evQuotaAutopilot: 'ev:quotaAutopilot', // main -> renderer: QuotaAutopilotState changed
  evWorktreeChanges: 'ev:worktreeChanges', // main -> renderer: WorktreeChanges recomputed (after a turn ended in that worktree)
  evWindowState: 'ev:windowState' // main -> renderer: WindowState changed
} as const

/** Buffered output for reattach. `seq` = sequence number of the last chunk included (0 if none).
 *  Live chunks carry increasing `seq` per session; the renderer drops live chunks with seq <= replay.seq. */
export interface PtyReplay {
  readonly data: string
  readonly seq: number
}

export interface Api {
  /** Which window this renderer runs in (fixed for its lifetime). */
  readonly windowRole: WindowRole
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
  setKeepAwake(id: Id, keepAwake: boolean): Promise<void>
  setSessionChecklist(id: Id, items: readonly ChecklistItem[]): Promise<void>
  /** D47: replaces the session's prompt queue (the first item is typed in when the current turn finishes). */
  setSessionQueue(id: Id, items: readonly QueuedPrompt[]): Promise<void>
  /** D47: types one queued prompt now (running, awake Claude/OpenCode session only) and removes it from the queue. */
  sendQueuedNow(id: Id, promptId: string): Promise<void>
  /** D49: adds a preset or replaces the one with the same id. */
  savePreset(preset: SessionPreset): Promise<void>
  removePreset(id: Id): Promise<void>
  getUsage(): Promise<UsageState>
  getWorkers(): Promise<readonly WorkerInfo[]>
  getTimeline(sessionId: Id): Promise<readonly TimelineTurn[]>
  getLastAwaySummary(): Promise<AwaySummary | null>
  getQuotaAutopilot(): Promise<QuotaAutopilotState>
  /** Sleeps idle sessions now for the quota (critical toast button). Resolves with the ids slept. */
  quotaSleepIdle(): Promise<readonly Id[]>
  /** Wakes the sessions held by the autopilot without opening them. Resolves with the ids woken. */
  quotaWake(options: { readonly sendContinue: boolean }): Promise<readonly Id[]>
  updateSettings(patch: SettingsPatch): Promise<AppSettings>
  getLoginItem(): Promise<LoginItemState>
  setLoginItem(openAtLogin: boolean): Promise<LoginItemState>
  /** Classifies terminal text (URL / existing file / existing folder, relative paths resolved against the session cwd). null = not a link. */
  resolveLinks(sessionId: Id, candidates: readonly string[]): Promise<readonly (ResolvedLink | null)[]>
  /** URL -> default browser; file -> default app (reveal=true: show in Explorer); folder -> Explorer. */
  openLink(sessionId: Id, text: string, reveal: boolean): Promise<OpenLinkResult>
  /** Absolute path of a File from a drag-and-drop (Electron webUtils); empty string when the file has no path on disk. */
  pathForFile(file: File): string
  /** Puts a session to sleep now (same as the idle timer would). */
  sleepSession(id: Id): Promise<void>
  quitApp(): Promise<void>
  refreshUsage(): Promise<UsageRefreshResult>
  ptyWrite(id: Id, data: string): void
  ptyResize(id: Id, cols: number, rows: number): void
  ptyRestart(id: Id): Promise<void>
  ptyReplay(id: Id): Promise<PtyReplay>
  clearAttention(id: Id): void
  markUnread(id: Id): void
  /** Tells main the user is at the keyboard (key, click or wheel in the window). Feeds the "sleep all when idle" timer. */
  reportUserActivity(): void
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
  onWorkers(cb: (workers: readonly WorkerInfo[]) => void): () => void
  onTimeline(cb: (sessionId: Id) => void): () => void
  onAwaySummary(cb: (summary: AwaySummary) => void): () => void
  onQuotaAutopilot(cb: (state: QuotaAutopilotState) => void): () => void
  // Code mode (D31)
  addRepo(folder: string): Promise<Repo>
  removeRepo(repoId: Id): Promise<void>
  setRepoCollapsed(repoId: Id, collapsed: boolean): Promise<void>
  getRepoBranches(repoId: Id): Promise<RepoBranches>
  createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult>
  removeWorktree(worktreeId: Id): Promise<void>
  setWorktreeCollapsed(worktreeId: Id, collapsed: boolean): Promise<void>
  getWorktreeChanges(worktreeId: Id): Promise<WorktreeChanges>
  getWorktreeFileDiff(worktreeId: Id, path: string): Promise<FileDiff>
  /** Rendered preview of one worktree file (rich previews, Code mode): image base64 or markdown/text. */
  getWorktreeFilePreview(worktreeId: Id, path: string): Promise<FilePreview>
  getWindowState(): Promise<WindowState>
  popOutCode(): Promise<void>
  dockCode(): Promise<void>
  onWorktreeChanges(cb: (changes: WorktreeChanges) => void): () => void
  onWindowState(cb: (state: WindowState) => void): () => void
}

/** Command-line flag main passes to the Code window (webPreferences.additionalArguments); preload reads it. */
export const CODE_WINDOW_ARG = '--sessiondeck-window=code'

declare global {
  interface Window { api: Api }
}
