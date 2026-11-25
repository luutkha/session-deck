import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type {
  BranchStatus,
  CommitInput,
  CommitResult,
  PushResult,
  PullRequestInput,
  PullRequestResult,
  MergeResult,
  WorktreeRemovalInfo,
  WorktreeRemoveOptions,
  WorktreeRemoveResult,
  AppSettings,
  ChecklistItem,
  JarvisConfirmRequest,
  JarvisUiCommand,
  JarvisSchedule,
  JarvisVoiceResult,
  QueuedPrompt,
  SessionPreset,
  ConversationSearchResult,
  CreateSessionInput,
  Group,
  Id,
  LoginItemState,
  OpenLinkResult,
  ResolvedLink,
  WorkerInfo,
  TimelineTurn,
  AwaySummary,
  QuotaAutopilotState,
  QuotaAlert,
  RuntimeState,
  Session,
  SettingsPatch,
  SoundEvent,
  StatusDef,
  StoreData,
  UsageRefreshResult,
  UsageState,
  Repo,
  RepoBranches,
  CreateWorktreeInput,
  CreateWorktreeResult,
  WorktreeChanges,
  FileDiff,
  DiscardResult,
  DiagnosticsReport,
  FilePreview,
  FileViewResult,
  FileViewRangeResult,
  FileViewStat,
  OpencodeInfo,
  WindowState,
  WindowRole,
  GpuInfo,
  GpuPref
} from '../shared/types'
import type { PtyReplay } from '../shared/ipc'
import { CHANGES_WINDOW_ARG_PREFIX, CODE_WINDOW_ARG, VIEWER_WINDOW_ARG_PREFIX } from '../shared/ipc'

const windowRole: WindowRole = process.argv.includes(CODE_WINDOW_ARG) ? 'code' : 'main'

/** D73: a detached file-viewer window carries its file in a launch argument; anything malformed means "not a viewer". */
function readViewerRequest(): { readonly sessionId: string; readonly text: string } | null {
  const raw = process.argv.find((arg) => arg.startsWith(VIEWER_WINDOW_ARG_PREFIX))
  if (raw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw.slice(VIEWER_WINDOW_ARG_PREFIX.length)))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { sessionId, text } = parsed as { sessionId?: unknown; text?: unknown }
    if (typeof sessionId !== 'string' || typeof text !== 'string' || sessionId.length === 0 || text.length === 0) return null
    return { sessionId, text }
  } catch {
    return null
  }
}


/** D83: a detached Changes window carries its worktree in a launch argument; anything malformed means "not one". */
function readChangesWindowRequest(): { readonly worktreeId: string; readonly title: string } | null {
  const raw = process.argv.find((arg) => arg.startsWith(CHANGES_WINDOW_ARG_PREFIX))
  if (raw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw.slice(CHANGES_WINDOW_ARG_PREFIX.length)))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { worktreeId, title } = parsed as { worktreeId?: unknown; title?: unknown }
    if (typeof worktreeId !== 'string' || worktreeId.length === 0 || typeof title !== 'string') return null
    return { worktreeId, title }
  } catch {
    return null
  }
}

const api: Api = {
  windowRole,
  viewerRequest: readViewerRequest(),
  changesWindowRequest: readChangesWindowRequest(),

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
  setSessionTags(id: Id, tags: readonly string[]): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSetTags, id, tags)
  },

  setSessionChecklist(id: Id, items: readonly ChecklistItem[]): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSetChecklist, id, items)
  },

  searchConversations(query: string): Promise<ConversationSearchResult> {
    return ipcRenderer.invoke(IPC.conversationSearch, query)
  },

  forkSession(id: Id): Promise<Session> {
    return ipcRenderer.invoke(IPC.sessionFork, id)
  },

  openJarvis(): Promise<Session> {
    return ipcRenderer.invoke(IPC.jarvisOpen)
  },

  resetJarvis(): Promise<Session> {
    return ipcRenderer.invoke(IPC.jarvisReset)
  },

  jarvisConfirmReply(requestId: string, yes: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.jarvisConfirmReply, requestId, yes)
  },

  jarvisVoice(): Promise<JarvisVoiceResult> {
    return ipcRenderer.invoke(IPC.jarvisVoice)
  },

  cancelJarvisVoice(): Promise<void> {
    return ipcRenderer.invoke(IPC.jarvisVoiceCancel)
  },

  onJarvisReply(cb: (text: string) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on(IPC.evJarvisReply, handler)
    return () => ipcRenderer.off(IPC.evJarvisReply, handler)
  },

  undoJarvis(): Promise<string> {
    return ipcRenderer.invoke(IPC.jarvisUndo)
  },

  getJarvisSchedules(): Promise<readonly JarvisSchedule[]> {
    return ipcRenderer.invoke(IPC.jarvisSchedulesGet)
  },

  removeJarvisSchedule(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC.jarvisScheduleRemove, id)
  },

  setJarvisScheduleEnabled(id: string, enabled: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.jarvisScheduleSetEnabled, id, enabled)
  },

  onJarvisSchedules(cb: (schedules: readonly JarvisSchedule[]) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, schedules: readonly JarvisSchedule[]) => cb(schedules)
    ipcRenderer.on(IPC.evJarvisSchedules, handler)
    return () => ipcRenderer.off(IPC.evJarvisSchedules, handler)
  },

  onJarvisConfirm(cb: (request: JarvisConfirmRequest) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, request: JarvisConfirmRequest) => cb(request)
    ipcRenderer.on(IPC.evJarvisConfirm, handler)
    return () => ipcRenderer.off(IPC.evJarvisConfirm, handler)
  },

  onJarvisUi(cb: (command: JarvisUiCommand) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, command: JarvisUiCommand) => cb(command)
    ipcRenderer.on(IPC.evJarvisUi, handler)
    return () => ipcRenderer.off(IPC.evJarvisUi, handler)
  },

  jarvisUiReply(commandId: string, ok: boolean, text: string): Promise<void> {
    return ipcRenderer.invoke(IPC.jarvisUiReply, commandId, ok, text)
  },

  setSessionQueue(id: Id, items: readonly QueuedPrompt[]): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSetQueue, id, items)
  },

  sendQueuedNow(id: Id, promptId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.sessionSendQueuedNow, id, promptId)
  },

  savePreset(preset: SessionPreset): Promise<void> {
    return ipcRenderer.invoke(IPC.presetSave, preset)
  },

  removePreset(id: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.presetRemove, id)
  },

  getUsage(): Promise<UsageState> {
    return ipcRenderer.invoke(IPC.usageGet)
  },

  getWorkers(): Promise<readonly WorkerInfo[]> {
    return ipcRenderer.invoke(IPC.workersGet)
  },

  getTimeline(sessionId: Id): Promise<readonly TimelineTurn[]> {
    return ipcRenderer.invoke(IPC.timelineGet, sessionId)
  },

  getLastAwaySummary(): Promise<AwaySummary | null> {
    return ipcRenderer.invoke(IPC.awayGetLast)
  },

  getQuotaAutopilot(): Promise<QuotaAutopilotState> {
    return ipcRenderer.invoke(IPC.quotaAutopilotGet)
  },

  quotaSleepIdle(): Promise<readonly Id[]> {
    return ipcRenderer.invoke(IPC.quotaSleepIdle)
  },

  quotaWake(options: { readonly sendContinue: boolean }): Promise<readonly Id[]> {
    return ipcRenderer.invoke(IPC.quotaWake, options)
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

  getGpuInfo(): Promise<GpuInfo & { readonly pref: GpuPref }> {
    return ipcRenderer.invoke(IPC.gpuInfo)
  },

  setGpuPref(pref: GpuPref): Promise<void> {
    return ipcRenderer.invoke(IPC.gpuSetPref, pref)
  },
  reportGpuProbe(softwareSeen: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.gpuReportProbe, softwareSeen)
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

  reportUserActivity(): void {
    ipcRenderer.send(IPC.appUserActivity)
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
  },

  onTimeline(cb: (sessionId: Id) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: Id) => cb(sessionId)
    ipcRenderer.on(IPC.evTimeline, handler)
    return () => ipcRenderer.off(IPC.evTimeline, handler)
  },

  onAwaySummary(cb: (summary: AwaySummary) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, summary: AwaySummary) => cb(summary)
    ipcRenderer.on(IPC.evAwaySummary, handler)
    return () => ipcRenderer.off(IPC.evAwaySummary, handler)
  },

  onQuotaAutopilot(cb: (state: QuotaAutopilotState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: QuotaAutopilotState) => cb(state)
    ipcRenderer.on(IPC.evQuotaAutopilot, handler)
    return () => ipcRenderer.off(IPC.evQuotaAutopilot, handler)
  },

  addRepo(folder: string): Promise<Repo> {
    return ipcRenderer.invoke(IPC.repoAdd, folder)
  },

  removeRepo(repoId: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.repoRemove, repoId)
  },

  setRepoCollapsed(repoId: Id, collapsed: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.repoSetCollapsed, repoId, collapsed)
  },

  getRepoBranches(repoId: Id): Promise<RepoBranches> {
    return ipcRenderer.invoke(IPC.repoBranches, repoId)
  },

  createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
    return ipcRenderer.invoke(IPC.worktreeCreate, input)
  },

  removeWorktree(worktreeId: Id, options?: WorktreeRemoveOptions): Promise<WorktreeRemoveResult> {
    return options === undefined ? ipcRenderer.invoke(IPC.worktreeRemove, worktreeId) : ipcRenderer.invoke(IPC.worktreeRemove, worktreeId, options)
  },

  getWorktreeRemovalInfo(worktreeId: Id): Promise<WorktreeRemovalInfo> {
    return ipcRenderer.invoke(IPC.worktreeRemovalInfo, worktreeId)
  },

  getWorktreeBranchStatus(worktreeId: Id): Promise<BranchStatus> {
    return ipcRenderer.invoke(IPC.worktreeBranchStatus, worktreeId)
  },

  commitWorktree(input: CommitInput): Promise<CommitResult> {
    return ipcRenderer.invoke(IPC.worktreeCommit, input)
  },

  pushWorktree(worktreeId: Id): Promise<PushResult> {
    return ipcRenderer.invoke(IPC.worktreePush, worktreeId)
  },

  createWorktreePr(worktreeId: Id, input: PullRequestInput): Promise<PullRequestResult> {
    return ipcRenderer.invoke(IPC.worktreeCreatePr, worktreeId, input)
  },

  mergeWorktree(worktreeId: Id): Promise<MergeResult> {
    return ipcRenderer.invoke(IPC.worktreeMerge, worktreeId)
  },

  setWorktreeCollapsed(worktreeId: Id, collapsed: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.worktreeSetCollapsed, worktreeId, collapsed)
  },

  getWorktreeChanges(worktreeId: Id): Promise<WorktreeChanges> {
    return ipcRenderer.invoke(IPC.worktreeChanges, worktreeId)
  },

  getWorktreeFileDiff(worktreeId: Id, path: string): Promise<FileDiff> {
    return ipcRenderer.invoke(IPC.worktreeFileDiff, worktreeId, path)
  },
  discardWorktreeFile(worktreeId: Id, path: string): Promise<DiscardResult> {
    return ipcRenderer.invoke(IPC.worktreeDiscardFile, worktreeId, path)
  },
  discardWorktreeHunk(worktreeId: Id, path: string, hunkIndex: number, hunkHeader: string): Promise<DiscardResult> {
    return ipcRenderer.invoke(IPC.worktreeDiscardHunk, worktreeId, path, hunkIndex, hunkHeader)
  },
  getDiagnostics(): Promise<DiagnosticsReport> {
    return ipcRenderer.invoke(IPC.appDiagnostics)
  },

  readFileView(sessionId: Id, text: string): Promise<FileViewResult> {
    return ipcRenderer.invoke(IPC.fileViewRead, sessionId, text)
  },

  readFileViewRange(sessionId: Id, text: string, start: number, end: number): Promise<FileViewRangeResult> {
    return ipcRenderer.invoke(IPC.fileViewRange, sessionId, text, start, end)
  },

  statFileView(sessionId: Id, text: string): Promise<FileViewStat> {
    return ipcRenderer.invoke(IPC.fileViewStat, sessionId, text)
  },

  pickViewFile(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.pickViewFile)
  },

  getOpencodeInfo(): Promise<OpencodeInfo> {
    return ipcRenderer.invoke(IPC.opencodeInfoGet)
  },

  recheckOpencode(): Promise<OpencodeInfo> {
    return ipcRenderer.invoke(IPC.opencodeRecheck)
  },

  detachFileView(sessionId: Id, text: string): Promise<void> {
    return ipcRenderer.invoke(IPC.fileViewDetach, sessionId, text)
  },

  detachChanges(worktreeId: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.changesDetach, worktreeId)
  },

  attachChanges(worktreeId: Id): Promise<void> {
    return ipcRenderer.invoke(IPC.changesAttach, worktreeId)
  },

  getWorktreeFilePreview(worktreeId: Id, path: string): Promise<FilePreview> {
    return ipcRenderer.invoke(IPC.filePreviewRead, worktreeId, path)
  },

  getWindowState(): Promise<WindowState> {
    return ipcRenderer.invoke(IPC.windowGetState)
  },

  popOutCode(): Promise<void> {
    return ipcRenderer.invoke(IPC.windowPopOutCode)
  },

  dockCode(): Promise<void> {
    return ipcRenderer.invoke(IPC.windowDockCode)
  },

  onWorktreeChanges(cb: (changes: WorktreeChanges) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, changes: WorktreeChanges) => cb(changes)
    ipcRenderer.on(IPC.evWorktreeChanges, handler)
    return () => ipcRenderer.off(IPC.evWorktreeChanges, handler)
  },

  onWindowState(cb: (state: WindowState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowState) => cb(state)
    ipcRenderer.on(IPC.evWindowState, handler)
    return () => ipcRenderer.off(IPC.evWindowState, handler)
  },

  onNotice(cb: (message: string) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => cb(message)
    ipcRenderer.on(IPC.evNotice, handler)
    return () => ipcRenderer.off(IPC.evNotice, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
