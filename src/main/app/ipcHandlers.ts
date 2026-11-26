import { app, ipcMain, dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { MAX_LINK_TEXTS } from '../links'
import { createAppLinkService } from '../links/appLinks'
import { readFileView, readPdfRange, statFileView } from '../preview'
import { getOpencodeInfo, recheckOpencode } from '../opencode'
import type { AppSettings, ConversationSearchResult, Id, StoreData, RuntimeState, Session, Group, LoginItemState, UsageRefreshResult, UsageState, WorkerInfo, WindowRole, WindowState, GpuInfo, GpuPref, FileViewResult, FileViewRangeResult, FileViewStat, OpencodeInfo, DiagnosticsReport } from '../../shared/types'
import type { PtyReplay } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { FILE_VIEW_PDF_STREAM_MAX_BYTES } from '../../shared/types'
import type { SessionController } from './sessionController'
import type { ActiveSessions } from './activeSessions'
import {
  assertId,
  assertNullableId,
  assertNonEmptyString,
  assertFiniteInt,
  assertBoolean,
  assertIndex,
  assertIdList,
  assertStatusOrder,
  assertDimension,
  assertPtyWriteData,
  assertStatusDef,
  asCreateSessionInput,
  asNotes,
  asChecklist,
  asPreset,
  asQueue,
  asGpuPref
} from './ipcValidation'
import { SessionStore, normalizeTags } from '../store'
import { PtyManager } from '../pty/PtyManager'
import type { AttentionService } from '../attention'
import type { RuntimeRegistry } from './runtimeRegistry'
import { retryWhileStopping } from './retryWhileStopping'
import { createCoalescedBroadcast } from './storeBroadcast'
import { logMainError } from './errorLog'
import type { UsageRefresher, UsageService } from '../usage'
import type { LoginItem } from './loginItem'
import type { WorkerHub } from '../workers'
import type { PromptQueue } from '../queue/promptQueue'
import type { ConversationSearch } from '../transcripts/conversationSearch'
import { markQuitting } from './quitState'
import { asSettingsPatch } from './settingsValidation'

/** Coalescing window for `evStoreChanged`: several changes in one window cost one full-store send. */
const STORE_BROADCAST_INTERVAL_MS = 40

export interface IpcHandlersDeps {
  readonly store: SessionStore
  readonly controller: SessionController
  readonly pty: PtyManager
  readonly attention: AttentionService
  readonly runtime: RuntimeRegistry
  readonly usage: UsageService
  /** Manual usage refresh (IPC.usageRefresh). The token never leaves the main process. */
  readonly usageRefresher: UsageRefresher
  /** OpenCode workers started from inside Claude sessions (read-only). */
  readonly workers: WorkerHub
  /** D47 prompt queue: sends the next prompt when a turn finishes, or one prompt on request. */
  readonly promptQueue: PromptQueue
  /** D52: read-only search in the saved Claude conversations. */
  readonly conversationSearch: ConversationSearch
  /** Sends to every open window (main and, when popped out, Code). */
  readonly broadcast: (channel: string, ...args: unknown[]) => void
  /** The window that sent an IPC call, used as the dialog parent. Null when it is gone: the dialog then has no parent. */
  readonly windowForSender: (webContentsId: number) => BrowserWindow | null
  /** Which window sent an IPC call. Null for an unknown sender. */
  readonly roleOfSender: (webContentsId: number) => WindowRole | null
  /** The session on screen per window role. */
  readonly activeSessions: ActiveSessions
  /** Whether Code mode is popped out into its own window. */
  readonly windowState: () => WindowState
  readonly popOutCode: () => void
  readonly dockCode: () => void
  /** D73: opens a detached file-viewer window for a file (the side-panel viewer's Detach). */
  readonly openFileViewer: (request: { readonly sessionId: Id; readonly text: string }) => void
  /** D83: opens (or focuses) the detached Changes window of a worktree. */
  readonly openChangesWindow: (worktreeId: Id) => void
  /** D84: docks a detached Changes window back: focuses a session of the worktree with its Changes tab open, then closes the window. */
  readonly attachChangesWindow: (worktreeId: Id) => Promise<void>
  /** D86: the diagnostics report for Settings > Diagnostics. */
  readonly getDiagnostics: () => Promise<DiagnosticsReport>
  /** Directory of main-errors.log. */
  readonly userDataDir: string
  /** Start-on-login state and toggle (packaged app only). */
  readonly loginItem: LoginItem
  /** No-GPU support: this run's GPU classification plus the saved acceleration preference (waits for detection, capped). */
  readonly getGpuInfo: () => Promise<GpuInfo & { readonly pref: GpuPref }>
  /** No-GPU support: saves the acceleration preference; it takes effect at the next start. */
  readonly setGpuPref: (pref: GpuPref) => void
  /** No-GPU support: the window's own WebGL probe result (true = software); remembered for the next start. */
  readonly reportGpuProbe: (softwareSeen: boolean) => void
  /** The user pressed a key / clicked in SessionDeck (resets the app-wide idle sleep timer). */
  readonly onUserActivity: () => void
  /** D61: the user typed into a session's terminal (validated id + data); absent = ignored. */
  readonly onUserInput?: (id: Id, data: string) => void
}

/**
 * Registers an `ipcMain.on` listener that also receives the sender's webContents id. Fire-and-forget channels have
 * no reply, so an exception thrown from the listener would be an uncaught exception in the main process.
 * Instead it is logged and the call is dropped.
 */
function onFireAndForgetFromSender(channel: string, userDataDir: string, listener: (senderId: number, ...args: unknown[]) => void): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    try {
      listener(event.sender.id, ...args)
    } catch (error) {
      logMainError(userDataDir, `ipc ${channel}`, error)
    }
  })
}

function onFireAndForget(channel: string, userDataDir: string, listener: (...args: unknown[]) => void): void {
  onFireAndForgetFromSender(channel, userDataDir, (_senderId, ...args) => listener(...args))
}

export function registerIpcHandlers(deps: IpcHandlersDeps): void {
  const { store, controller, pty, attention, runtime, usage, usageRefresher, workers, promptQueue, conversationSearch, broadcast, windowForSender, roleOfSender, activeSessions, windowState, popOutCode, dockCode, openFileViewer, openChangesWindow, attachChangesWindow, getDiagnostics, userDataDir, loginItem, onUserActivity } = deps

  // A burst of store changes (notes, status, rename...) must not send the whole store per change:
  // the first change goes out at once, the rest at most once per interval with the latest state.
  const storeChanged = createCoalescedBroadcast<StoreData, ReturnType<typeof setTimeout>>({
    send: (data) => broadcast(IPC.evStoreChanged, data),
    getLatest: () => store.get(),
    intervalMs: STORE_BROADCAST_INTERVAL_MS,
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (handle) => clearTimeout(handle)
  })

  const sendRuntime = (state: RuntimeState): void => {
    broadcast(IPC.evRuntime, state)
  }

  store.subscribe(() => storeChanged.notify())
  runtime.subscribe(sendRuntime)

  ipcMain.handle(IPC.storeGet, async (): Promise<{ data: StoreData; runtime: readonly RuntimeState[] }> => {
    return { data: store.get(), runtime: runtime.snapshot() }
  })

  ipcMain.handle(IPC.sessionCreate, async (_event, raw: unknown): Promise<Session> => {
    return controller.createSession(asCreateSessionInput(raw))
  })

  ipcMain.handle(IPC.conversationSearch, async (_event, raw: unknown): Promise<ConversationSearchResult> => {
    if (typeof raw !== 'string') throw new Error('Search text must be a string')
    return conversationSearch.search(store.get().sessions, raw)
  })

  ipcMain.handle(IPC.sessionFork, async (_event, raw: unknown): Promise<Session> => {
    return controller.forkSession(assertId(raw, 'session id'))
  })

  ipcMain.handle(IPC.sessionMoveToCode, async (_event, rawId: unknown, rawWorktreeId: unknown): Promise<Session> => {
    return controller.moveToWorktree(assertId(rawId, 'session id'), assertId(rawWorktreeId, 'worktree id'))
  })

  ipcMain.handle(IPC.sessionRename, async (_event, rawId: unknown, rawName: unknown): Promise<void> => {
    const id = assertId(rawId, 'session id')
    const name = assertNonEmptyString(rawName, 'session name')
    store.renameSession(id, name)
  })

  ipcMain.handle(IPC.sessionSetStatus, async (_event, rawId: unknown, rawStatusId: unknown): Promise<void> => {
    store.setSessionStatus(assertId(rawId, 'session id'), assertNullableId(rawStatusId, 'status id'))
  })

  ipcMain.handle(IPC.sessionMove, async (_event, rawId: unknown, rawGroupId: unknown, rawIndex: unknown): Promise<void> => {
    store.moveSession(
      assertId(rawId, 'session id'),
      assertNullableId(rawGroupId, 'group id'),
      assertIndex(rawIndex, 'index')
    )
  })

  ipcMain.handle(IPC.sessionRemove, async (_event, rawId: unknown): Promise<void> => {
    controller.removeSession(assertId(rawId, 'session id'))
  })

  ipcMain.handle(IPC.sessionClose, async (_event, raw: unknown): Promise<void> => {
    controller.closeSession(assertId(raw, 'session id'))
  })

  ipcMain.handle(IPC.sessionReopen, async (_event, raw: unknown): Promise<void> => {
    const id = assertId(raw, 'session id')
    await retryWhileStopping(() => controller.reopenSession(id))
  })

  ipcMain.handle(IPC.sessionSleep, async (_event, raw: unknown): Promise<void> => {
    controller.sleepSession(assertId(raw, 'session id'))
  })

  ipcMain.handle(IPC.sessionSetKeepAwake, async (_event, rawId: unknown, raw: unknown): Promise<void> => {
    if (typeof raw !== 'boolean') throw new Error('keepAwake must be a boolean')
    store.setKeepAwake(assertId(rawId, 'session id'), raw)
  })

  ipcMain.handle(IPC.sessionSetTags, async (_event, rawId: unknown, rawTags: unknown): Promise<void> => {
    store.setSessionTags(assertId(rawId, 'session id'), normalizeTags(rawTags))
  })

  ipcMain.handle(IPC.sessionSetNotes, async (_event, rawId: unknown, rawNotes: unknown): Promise<void> => {
    store.setSessionNotes(assertId(rawId, 'session id'), asNotes(rawNotes))
  })

  ipcMain.handle(IPC.sessionSetChecklist, async (_event, rawId: unknown, rawItems: unknown): Promise<void> => {
    store.setSessionChecklist(assertId(rawId, 'session id'), asChecklist(rawItems))
  })

  ipcMain.handle(IPC.sessionSetQueue, async (_event, rawId: unknown, rawItems: unknown): Promise<void> => {
    const id = assertId(rawId, 'session id')
    store.setSessionQueue(id, asQueue(rawItems))
    promptQueue.onQueueChanged(id)
  })

  ipcMain.handle(IPC.sessionSendQueuedNow, async (_event, rawId: unknown, rawPromptId: unknown): Promise<void> => {
    promptQueue.sendNow(assertId(rawId, 'session id'), assertNonEmptyString(rawPromptId, 'prompt id'))
  })

  ipcMain.handle(IPC.presetSave, async (_event, raw: unknown): Promise<void> => {
    store.savePreset(asPreset(raw))
  })

  ipcMain.handle(IPC.presetRemove, async (_event, rawId: unknown): Promise<void> => {
    store.removePreset(assertId(rawId, 'preset id'))
  })

  ipcMain.handle(IPC.groupCreate, async (_event, rawName: unknown): Promise<Group> => {
    return store.createGroup(assertNonEmptyString(rawName, 'group name'))
  })

  ipcMain.handle(IPC.groupRename, async (_event, rawId: unknown, rawName: unknown): Promise<void> => {
    store.renameGroup(assertId(rawId, 'group id'), assertNonEmptyString(rawName, 'group name'))
  })

  ipcMain.handle(IPC.groupRemove, async (_event, rawId: unknown): Promise<void> => {
    store.removeGroup(assertId(rawId, 'group id'))
  })

  ipcMain.handle(IPC.groupSetCollapsed, async (_event, rawId: unknown, rawCollapsed: unknown): Promise<void> => {
    store.setGroupCollapsed(assertId(rawId, 'group id'), assertBoolean(rawCollapsed, 'collapsed'))
  })

  ipcMain.handle(IPC.groupReorder, async (_event, rawOrder: unknown): Promise<void> => {
    store.reorderGroups(assertIdList(rawOrder, 'group order'))
  })

  ipcMain.handle(IPC.statusUpsert, async (_event, raw: unknown): Promise<void> => {
    store.upsertStatus(assertStatusDef(raw))
  })

  ipcMain.handle(IPC.statusRemove, async (_event, rawId: unknown): Promise<void> => {
    store.removeStatus(assertId(rawId, 'status id'))
  })

  ipcMain.handle(IPC.statusReorder, async (_event, rawOrder: unknown): Promise<void> => {
    store.reorderStatuses(assertStatusOrder(rawOrder, 'status order'))
  })

  onFireAndForget(IPC.ptyWrite, userDataDir, (rawId, rawData) => {
    const id = assertId(rawId, 'session id')
    const data = assertPtyWriteData(rawData)
    // Typing into a terminal is user input for the app-wide idle timer.
    onUserActivity()
    deps.onUserInput?.(id, data)
    controller.writeToPty(id, data)
  })

  // Takes no arguments: any payload from the renderer is ignored.
  onFireAndForget(IPC.appUserActivity, userDataDir, () => onUserActivity())

  onFireAndForget(IPC.ptyResize, userDataDir, (rawId, rawCols, rawRows) => {
    controller.resizePty(
      assertId(rawId, 'session id'),
      assertDimension(rawCols, 'cols'),
      assertDimension(rawRows, 'rows')
    )
  })

  ipcMain.handle(IPC.ptyRestart, async (_event, rawId: unknown): Promise<void> => {
    await controller.restartSession(assertId(rawId, 'session id'))
  })

  ipcMain.handle(IPC.ptyReplay, async (_event, rawId: unknown): Promise<PtyReplay> => {
    return pty.replay(assertId(rawId, 'session id'))
  })

  onFireAndForget(IPC.attentionClear, userDataDir, (rawId) => {
    attention.clear(assertId(rawId, 'session id'))
  })

  onFireAndForget(IPC.attentionMarkUnread, userDataDir, (rawId) => {
    attention.markUnread(assertId(rawId, 'session id'))
  })

  onFireAndForgetFromSender(IPC.sessionSetActive, userDataDir, (senderId, rawId) => {
    const id = assertNullableId(rawId, 'session id')
    activeSessions.set(roleOfSender(senderId) ?? 'main', id)
    controller.setActiveSession(id)
  })

  ipcMain.handle(IPC.windowGetState, async (): Promise<WindowState> => windowState())

  ipcMain.handle(IPC.windowPopOutCode, async (): Promise<void> => {
    popOutCode()
  })

  ipcMain.handle(IPC.windowDockCode, async (): Promise<void> => {
    dockCode()
  })

  ipcMain.handle(IPC.settingsSetSound, async (_event, rawEnabled: unknown): Promise<void> => {
    attention.setSoundEnabled(assertBoolean(rawEnabled, 'sound enabled'))
  })

  ipcMain.handle(IPC.settingsUpdate, async (_event, raw: unknown): Promise<AppSettings> => {
    return store.updateSettings(asSettingsPatch(raw))
  })

  const links = createAppLinkService((id) => store.get().sessions.find((s) => s.id === id)?.cwd ?? null)

  ipcMain.handle(IPC.linkResolve, async (_event, rawId: unknown, rawTexts: unknown) => {
    const id = assertId(rawId, 'session id')
    if (!Array.isArray(rawTexts) || rawTexts.length > MAX_LINK_TEXTS || !rawTexts.every((t) => typeof t === 'string')) {
      throw new Error('link candidates must be a list of at most ' + MAX_LINK_TEXTS + ' strings')
    }
    return links.resolveMany(id, rawTexts as string[])
  })

  // D73: the side-panel viewer. The renderer sends the link TEXT; main resolves it (cwd, home, UNC refused) and reads it, never a raw path.
  ipcMain.handle(IPC.fileViewRead, async (_event, rawId: unknown, rawText: unknown): Promise<FileViewResult> => {
    const resolved = await links.resolve(assertId(rawId, 'session id'), assertNonEmptyString(rawText, 'link text'))
    if (resolved === null || resolved.kind !== 'file') return { ok: false, error: 'Not a file that exists' }
    return readFileView(resolved.target)
  })

  // D75: a PDF over 30 MB is not sent whole: pdf.js asks for byte ranges. Main re-resolves the text like every viewer call,
  // checks the numbers, and readPdfRange caps one answer at FILE_VIEW_PDF_RANGE_MAX_BYTES.
  ipcMain.handle(IPC.fileViewRange, async (_event, rawId: unknown, rawText: unknown, rawStart: unknown, rawEnd: unknown): Promise<FileViewRangeResult> => {
    const start = assertFiniteInt(rawStart, 'range start', 0, FILE_VIEW_PDF_STREAM_MAX_BYTES)
    const end = assertFiniteInt(rawEnd, 'range end', 0, FILE_VIEW_PDF_STREAM_MAX_BYTES)
    const resolved = await links.resolve(assertId(rawId, 'session id'), assertNonEmptyString(rawText, 'link text'))
    if (resolved === null || resolved.kind !== 'file') return { ok: false, error: 'Not a file that exists' }
    return readPdfRange(resolved.target, start, end)
  })

  // D74: the open preview polls this (cheap: stat only) to reload when the file changes on disk.
  ipcMain.handle(IPC.fileViewStat, async (_event, rawId: unknown, rawText: unknown): Promise<FileViewStat> => {
    const resolved = await links.resolve(assertId(rawId, 'session id'), assertNonEmptyString(rawText, 'link text'))
    // The link resolver answers null for a path that is not there (deleted, never existed): that IS "gone" for the live reload.
    if (resolved === null || resolved.kind !== 'file') return { ok: false, error: 'File not found', gone: true }
    return statFileView(resolved.target)
  })

  // D74: the palette's Preview file... picks a file the viewer can show (all files stay selectable).
  ipcMain.handle(IPC.pickViewFile, async (event): Promise<string | null> => {
    return showOpenDialog(event.sender.id, {
      properties: ['openFile'],
      filters: [
        { name: 'Viewable files', extensions: ['md', 'markdown', 'txt', 'log', 'json', 'yaml', 'yml', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'csv', 'tsv', 'xlsx', 'xlsm', 'docx', 'docm', 'dotx', 'pdf'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
  })

  // D74: Settings > Agents shows what the installed OpenCode supports and can probe it again after an upgrade.
  ipcMain.handle(IPC.opencodeInfoGet, async (): Promise<OpencodeInfo> => getOpencodeInfo())
  ipcMain.handle(IPC.opencodeRecheck, async (): Promise<OpencodeInfo> => recheckOpencode())

  ipcMain.handle(IPC.fileViewDetach, async (_event, rawId: unknown, rawText: unknown): Promise<void> => {
    openFileViewer({ sessionId: assertId(rawId, 'session id'), text: assertNonEmptyString(rawText, 'link text') })
  })

  // D83: main resolves the worktree (never trusts the renderer's title) and refuses an id that is not in the store.
  ipcMain.handle(IPC.changesDetach, async (_event, rawId: unknown): Promise<void> => {
    const worktreeId = assertId(rawId, 'worktree id')
    if (store.getWorktree(worktreeId) === undefined) throw new Error('Unknown worktree.')
    openChangesWindow(worktreeId)
  })

  ipcMain.handle(IPC.appDiagnostics, async (): Promise<DiagnosticsReport> => getDiagnostics())

  // D84: dock back. Main picks the session and focuses it before the detached window closes (it stays open on failure).
  ipcMain.handle(IPC.changesAttach, async (_event, rawId: unknown): Promise<void> => {
    const worktreeId = assertId(rawId, 'worktree id')
    if (store.getWorktree(worktreeId) === undefined) throw new Error('Unknown worktree.')
    await attachChangesWindow(worktreeId)
  })

  ipcMain.handle(IPC.linkOpen, async (_event, rawId: unknown, rawText: unknown, rawReveal: unknown) => {
    return links.open(assertId(rawId, 'session id'), assertNonEmptyString(rawText, 'link text'), assertBoolean(rawReveal, 'reveal'))
  })

  ipcMain.handle(IPC.loginItemGet, async (): Promise<LoginItemState> => {
    return loginItem.get()
  })

  ipcMain.handle(IPC.loginItemSet, async (_event, raw: unknown): Promise<LoginItemState> => {
    return loginItem.set(assertBoolean(raw, 'openAtLogin'))
  })

  // No-GPU support: the renderer picks its terminal renderer from this. Never hangs: the wait for the first detection is capped.
  ipcMain.handle(IPC.gpuInfo, async (): Promise<GpuInfo & { readonly pref: GpuPref }> => {
    return deps.getGpuInfo()
  })

  ipcMain.handle(IPC.gpuSetPref, async (_event, raw: unknown): Promise<void> => {
    deps.setGpuPref(asGpuPref(raw))
  })

  ipcMain.handle(IPC.gpuReportProbe, async (_event, raw: unknown): Promise<void> => {
    deps.reportGpuProbe(assertBoolean(raw, 'softwareSeen'))
  })

  // Takes no arguments: any payload from the renderer is ignored. The quit flag is set first so the window close
  // handler lets the window close instead of hiding it to the tray.
  ipcMain.handle(IPC.appQuit, async (): Promise<void> => {
    markQuitting()
    app.quit()
  })

  ipcMain.handle(IPC.workersGet, (): readonly WorkerInfo[] => workers.getWorkers())

  ipcMain.handle(IPC.usageGet, async (): Promise<UsageState> => {
    return usage.getState()
  })

  // Takes no arguments: any payload from the renderer is ignored.
  ipcMain.handle(IPC.usageRefresh, async (): Promise<UsageRefreshResult> => {
    return usageRefresher.refresh()
  })

  /** Opens a file dialog parented to the sender's window (no parent when that window is gone). */
  const showOpenDialog = async (senderId: number, options: OpenDialogOptions): Promise<string | null> => {
    const parent = windowForSender(senderId)
    const result = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options)
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  }

  ipcMain.handle(IPC.pickFolder, async (event): Promise<string | null> => {
    return showOpenDialog(event.sender.id, { properties: ['openDirectory'] })
  })

  ipcMain.handle(IPC.pickSoundFile, async (event): Promise<string | null> => {
    return showOpenDialog(event.sender.id, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'] }]
    })
  })
}
