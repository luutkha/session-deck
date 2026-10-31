import { app, ipcMain, dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createLinkService, MAX_LINK_TEXTS } from '../links'
import type { AppSettings, StoreData, RuntimeState, Session, Group, LoginItemState, UsageRefreshResult, UsageState, WorkerInfo, WindowRole, WindowState } from '../../shared/types'
import type { PtyReplay } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import type { SessionController } from './sessionController'
import type { ActiveSessions } from './activeSessions'
import {
  assertId,
  assertNullableId,
  assertNonEmptyString,
  assertBoolean,
  assertIndex,
  assertIdList,
  assertStatusOrder,
  assertDimension,
  assertPtyWriteData,
  assertStatusDef,
  asCreateSessionInput,
  asNotes,
  asChecklist
} from './ipcValidation'
import { SessionStore } from '../store'
import { PtyManager } from '../pty/PtyManager'
import type { AttentionService } from '../attention'
import type { RuntimeRegistry } from './runtimeRegistry'
import { retryWhileStopping } from './retryWhileStopping'
import { logMainError } from './errorLog'
import type { UsageRefresher, UsageService } from '../usage'
import type { LoginItem } from './loginItem'
import type { WorkerHub } from '../workers'
import { markQuitting } from './quitState'
import { asSettingsPatch } from './settingsValidation'

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
  /** Directory of main-errors.log. */
  readonly userDataDir: string
  /** Start-on-login state and toggle (packaged app only). */
  readonly loginItem: LoginItem
  /** The user pressed a key / clicked in SessionDeck (resets the app-wide idle sleep timer). */
  readonly onUserActivity: () => void
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
  const { store, controller, pty, attention, runtime, usage, usageRefresher, workers, broadcast, windowForSender, roleOfSender, activeSessions, windowState, popOutCode, dockCode, userDataDir, loginItem, onUserActivity } = deps

  const sendStoreChanged = (data: StoreData): void => {
    broadcast(IPC.evStoreChanged, data)
  }

  const sendRuntime = (state: RuntimeState): void => {
    broadcast(IPC.evRuntime, state)
  }

  store.subscribe(sendStoreChanged)
  runtime.subscribe(sendRuntime)

  ipcMain.handle(IPC.storeGet, async (): Promise<{ data: StoreData; runtime: readonly RuntimeState[] }> => {
    return { data: store.get(), runtime: runtime.snapshot() }
  })

  ipcMain.handle(IPC.sessionCreate, async (_event, raw: unknown): Promise<Session> => {
    return controller.createSession(asCreateSessionInput(raw))
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

  ipcMain.handle(IPC.sessionSetNotes, async (_event, rawId: unknown, rawNotes: unknown): Promise<void> => {
    store.setSessionNotes(assertId(rawId, 'session id'), asNotes(rawNotes))
  })

  ipcMain.handle(IPC.sessionSetChecklist, async (_event, rawId: unknown, rawItems: unknown): Promise<void> => {
    store.setSessionChecklist(assertId(rawId, 'session id'), asChecklist(rawItems))
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

  const links = createLinkService({
    getSessionCwd: (id) => store.get().sessions.find((s) => s.id === id)?.cwd ?? null,
    stat: async (target) => {
      try {
        const info = await stat(target)
        return { isFile: info.isFile(), isDirectory: info.isDirectory() }
      } catch {
        return null // a missing or unreadable path is simply not a link
      }
    },
    openPath: (target) => shell.openPath(target),
    openExternal: (url) => shell.openExternal(url),
    showItemInFolder: (target) => shell.showItemInFolder(target),
    homedir
  })

  ipcMain.handle(IPC.linkResolve, async (_event, rawId: unknown, rawTexts: unknown) => {
    const id = assertId(rawId, 'session id')
    if (!Array.isArray(rawTexts) || rawTexts.length > MAX_LINK_TEXTS || !rawTexts.every((t) => typeof t === 'string')) {
      throw new Error('link candidates must be a list of at most ' + MAX_LINK_TEXTS + ' strings')
    }
    return links.resolveMany(id, rawTexts as string[])
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
