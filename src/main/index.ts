import { app, BrowserWindow, clipboard, dialog, nativeImage, Notification, screen, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir, cpus, totalmem, freemem, platform as osPlatform, release as osRelease, arch as osArch } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { createGhCheck, runGh } from './git'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { storeFilePath, attentionDir } from './app/paths'
import { loadStoreFile, createDebouncedSaver } from './store/persistence'
import { SessionStore } from './store/SessionStore'
import { PtyManager } from './pty/PtyManager'
import { createAttentionService } from './attention'
import { createRuntimeRegistry } from './app/runtimeRegistry'
import { createSessionController } from './app/sessionController'
import { createSoundRelay } from './app/soundRelay'
import { createUsageService, createUsageRefresher, readClaudeAccessToken, fetchOAuthUsage } from './usage'
import { registerIpcHandlers } from './app/ipcHandlers'
import { createMainWindow, focusSessionInWindow, showMainWindow, CHANGES_DEFAULT_SIZE } from './app/window'
import { createViewerWindowSet } from './app/viewerWindows'
import { createChangesWindowSet, pickSessionForChanges } from './app/changesWindows'
import { changesBoundsFilePath, createBoundsStore, fitBounds, nodeBoundsStoreIo } from './app/changesWindowBounds'
import { createWindowRegistry } from './app/windowRegistry'
import { createActiveSessions } from './app/activeSessions'
import { createCodeWiring } from './app/codeWiring'
import { logMainError } from './app/errorLog'
import { createLoginItem } from './app/loginItem'
import { createAppLinkService } from './links/appLinks'
import { isQuitting, markQuitting } from './app/quitState'
import { resolveIconPath } from './app/iconPaths'
import { attachTrayWiring } from './app/trayWiring'
import { createDesktopNotifier } from './notify/desktopNotifier'
import { wireAttentionNotices } from './notify/attentionWiring'
import { attentionNotice } from './notify/attentionNotice'
import { deliverQuotaAlert, startQuotaWiring, type QuotaDeliveryDeps } from './quota/quotaWiring'
import { CONTINUE_FAILED_TITLE, continueFailedBody } from './quota/continueFailedNotice'
import { createFeatureWiring } from './app/featureWiring'
import { createLastActiveTracker } from './app/lastActive'
import { quotaMarkersFilePath } from './quota/quotaMarkers'
import { createSleepScheduler } from './sleep/SleepScheduler'
import { createWorkerHub } from './workers'
import { createPromptQueue } from './queue/promptQueue'
import { createLaunchResume, RESUME_FILE_NAME } from './app/launchResume'
import { createConversationSearch, lastAnswer } from './transcripts/conversationSearch'
import { claudeConfigDir } from './app/transcript'
import { readdir, stat } from 'node:fs/promises'
import { IPC } from '../shared/ipc'
import { createJarvisWiring } from './jarvis/jarvisWiring'
import { renderScreenText } from './jarvis/screenText'
import { errorMessage } from '../shared/guards'
import { asChecklist, asPreset, assertNonEmptyString, assertStatusDef } from './app/ipcValidation'
import { asSettingsPatch } from './app/settingsValidation'
import { classifyGpu, parseGpuDevices, type GpuDevice, type GpuInfo } from './app/gpuInfo'
import { createGpuModeStore, decideAcceleration, gpuModeFilePath, shouldRestartForSoftware, type GpuModeFile, type GpuModeStore } from './app/gpuMode'
import type { GpuPref } from '../shared/types'
import { warmOpencodeProbe } from './opencode'
import { createOpencodeExportRunner } from './opencode/exportRunner'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SAVER_DELAY_MS = 400
/** D84: moving/resizing a Changes window saves at most this often. */
const CHANGES_BOUNDS_SAVE_DELAY_MS = 500
/** D84: the renderer needs a moment to switch to Code mode and the Changes tab after the session is focused. */
const ATTACH_FOCUS_DELAY_MS = 450

/** userData when Electron can provide it; the temp dir otherwise, so error logging still has a place to write. */
function userDataDir(): string {
  try {
    return app.getPath('userData')
  } catch {
    return tmpdir()
  }
}

// Installed before any window exists. Without these, an uncaught exception or unhandled rejection in the main
// process shows Electron's blocking error dialog and leaves the app wedged. They are logged instead.
process.on('uncaughtException', (error: Error) => {
  logMainError(userDataDir(), 'uncaughtException', error)
})

process.on('unhandledRejection', (reason: unknown) => {
  logMainError(userDataDir(), 'unhandledRejection', reason)
})

let mainWindow: BrowserWindow | null = null
let codeWindowFocused: () => boolean = () => false

/** No-GPU support: the GPU process is off for this run (we called app.disableHardwareAcceleration()). */
let accelerationDisabled = false
/** The last classification; 'unknown' until detection finished. */
let gpuInfo: GpuInfo = { mode: 'unknown', renderer: '', accelerationDisabled: false, webgl: '' }
/** The first detection, so IPC.gpuInfo can wait for it instead of answering 'unknown' too early. */
let gpuDetection: Promise<GpuInfo> | null = null
/** gpu-mode.json: the preference and whether the last run rendered in software. Null when its file is unusable. */
let gpuModeStore: GpuModeStore | null = null
const GPU_DETECTION_WAIT_MS = 3000

/** The GPU classification plus the stored preference: what Settings > Terminal shows, and what Jarvis reads (D71). */
async function readGpuWithPref(): Promise<GpuInfo & { readonly pref: GpuPref }> {
  if (gpuDetection !== null) gpuInfo = await withTimeout(gpuDetection, gpuInfo, GPU_DETECTION_WAIT_MS)
  // The stored preference (not the env override): it is what the user's control shows and what the next start uses.
  return { ...gpuInfo, pref: gpuModeStore?.load().pref ?? 'auto' }
}

function saveGpuPref(pref: GpuPref): void {
  if (gpuModeStore === null) throw new Error('GPU preference storage is unavailable')
  gpuModeStore.save({ pref })
}
/** Cap for waiting on Chromium's first GPU report; detection must not delay the renderer's startup for long. */
const GPU_INFO_UPDATE_WAIT_MS = 1200

/** Resolves with `promise`, or with `fallback` when it takes longer than `ms`: a renderer call must never hang. */
function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

/**
 * Chromium reports its GPU asynchronously: Electron's own docs say app.getGPUFeatureStatus() is only usable after
 * 'gpu-info-update'. Waiting (bounded) avoids classifying a still-initialising GPU process as software.
 */
function waitForGpuInfoUpdate(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      app.off('gpu-info-update', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    app.on('gpu-info-update', finish)
  })
}

/** True while ANY SessionDeck window (main or the popped-out Code window) has focus. */
function isMainWindowFocused(): boolean {
  return (mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isFocused()) || codeWindowFocused()
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow(mainWindow)
  })

  // No-GPU support: hardware acceleration must be decided BEFORE ready. A PC whose last run rendered in software
  // starts with acceleration off (no more WebGL-on-SwiftShader burning the CPU); every 10th launch keeps it on to
  // re-check. SESSIONDECK_GPU=on|off overrides the file. Never fatal: a broken file only means the default.
  try {
    const userDataForGpu = userDataDir()
    const store = createGpuModeStore({
      filePath: gpuModeFilePath(userDataForGpu),
      readFileSync: (filePath) => readFileSync(filePath, 'utf-8'),
      writeFileSync: (filePath, text) => writeFileSync(filePath, text, 'utf-8'),
      mkdirSync: (dirPath) => {
        mkdirSync(dirPath, { recursive: true })
      },
      onError: (where, error) => logMainError(userDataForGpu, where, error)
    })
    gpuModeStore = store
    store.recordLaunch()
    if (decideAcceleration(store.load(), process.env.SESSIONDECK_GPU).disable) {
      app.disableHardwareAcceleration()
      accelerationDisabled = true
      // Sane answer for an IPC call that arrives before detection ran.
      gpuInfo = classifyGpu({ featureStatus: null, devices: [], accelerationDisabled: true })
    }
  } catch (error) {
    logMainError(userDataDir(), 'gpu mode', error)
  }

  app.whenReady().then(async () => {
    const userData = userDataDir()
    const storePath = storeFilePath(userData)
    const attentionSettingsDir = attentionDir(userData)
    const onError = (where: string, error: unknown): void => logMainError(userData, where, error)
    const changesBounds = createBoundsStore(changesBoundsFilePath(userData), nodeBoundsStoreIo(onError))

    // D74: find out what the installed OpenCode supports in the background, so the first OpenCode session never waits on it.
    warmOpencodeProbe()

    const iconDeps = {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      exists: existsSync
    }
    const appIconPath = resolveIconPath('icon.png', iconDeps)
    const trayIconPath = resolveIconPath('tray.png', iconDeps)
    const trayAttentionIconPath = resolveIconPath('tray-attention.png', iconDeps)

    let loaded: Awaited<ReturnType<typeof loadStoreFile>>
    try {
      loaded = await loadStoreFile(storePath)
    } catch (error) {
      logMainError(userData, 'store load', error)
      const detail = errorMessage(error)
      dialog.showErrorBox(
        'SessionDeck',
        `Could not read the session store at ${storePath}.\n\n${detail}\n\n` +
          'The file was left untouched. Fix the problem (permissions, antivirus lock) and start SessionDeck again.'
      )
      app.quit()
      return
    }
    const { data: initialStoreData, warning } = loaded
    if (warning) {
      logMainError(userData, 'store load', warning)
      // A corrupt store was recovered as empty: tell the user even though no window exists yet.
      dialog.showErrorBox('SessionDeck', warning)
    }

    const store = new SessionStore(initialStoreData, {
      schedule: (data) => {
        saver.schedule(data)
      }
    }, {
      newId: () => randomUUID(),
      now: () => Date.now()
    })

    const saver = createDebouncedSaver(storePath, SAVER_DELAY_MS)
    const activeSessions = createActiveSessions()

    // Code mode (D31): the main window, plus the Code window while it is popped out. Events go to both.
    const viewerWindows = createViewerWindowSet()
    const changesWindows = createChangesWindowSet()
    const windows = createWindowRegistry<BrowserWindow>({
      createWindow: (role) => createMainWindow({
        preloadPath: path.join(__dirname, '../preload/index.mjs'),
        iconPath: appIconPath,
        role,
        parent: mainWindow ?? undefined
      }).window,
      onStateChange: (state) => {
        // A docked/closed Code window must not keep its last session "on screen" (attention + sleep checks).
        if (!state.codePoppedOut) activeSessions.clearRole('code')
        windows.broadcast(IPC.evWindowState, state)
      },
      onError
    })
    codeWindowFocused = () => windows.code()?.isFocused() === true

    /** Notification / tray click: a Code session opens in the Code window when it is popped out, else in the main window. */
    function focusSession(id: string): void {
      const session = store.get().sessions.find((s) => s.id === id)
      const codeWin = windows.code()
      if (session?.worktreeId !== undefined && codeWin !== null) {
        focusSessionInWindow(codeWin, id)
        return
      }
      focusSessionInWindow(mainWindow, id)
    }

    /**
     * D84: dock back. Picks an open session of the worktree, shows it in the window focusSession chooses and asks the
     * same renderer for the Changes tab Jarvis opens. The detached window closes only after all of that succeeded.
     */
    async function attachChangesWindow(worktreeId: string): Promise<void> {
      const activeId = activeSessions.get('code') ?? activeSessions.get('main')
      const session = pickSessionForChanges(store.get().sessions, worktreeId, activeId, (id) => runtime.get(id)?.run === 'running')
      if (session === undefined) throw new Error('This worktree has no session to show the changes on.')
      focusSession(session.id)
      await new Promise<void>((resolve) => setTimeout(resolve, ATTACH_FOCUS_DELAY_MS))
      const codeWin = windows.code()
      const target = session.worktreeId !== undefined && codeWin !== null ? codeWin : mainWindow
      if (target !== null && !target.isDestroyed()) {
        target.webContents.send(IPC.evJarvisUi, {
          id: randomUUID(),
          mode: 'code',
          action: { kind: 'sidePanel', open: true, tab: 'changes' }
        })
      }
      changesWindows.close(worktreeId)
    }

    /** D84: remembers a detached Changes window's normal (not maximised) bounds, debounced while it is dragged/resized. */
    function trackChangesBounds(worktreeId: string, win: BrowserWindow): void {
      let timer: ReturnType<typeof setTimeout> | null = null
      const save = (): void => {
        if (win.isDestroyed()) return
        changesBounds.set(worktreeId, win.getNormalBounds())
      }
      const schedule = (): void => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          save()
        }, CHANGES_BOUNDS_SAVE_DELAY_MS)
      }
      win.on('resize', schedule)
      win.on('move', schedule)
      win.on('close', (): void => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        save()
      })
    }

    const notifier = createDesktopNotifier({
      NotificationCtor: Notification,
      isSupported: () => Notification.isSupported(),
      getSettings: () => store.getSettings().tray,
      isWindowFocused: isMainWindowFocused,
      onClickSession: (id) => focusSession(id),
      onClickApp: () => showMainWindow(mainWindow),
      iconPath: appIconPath ?? undefined,
      onError
    })

    // Active terminals get a short batch window; hidden ones can wait longer (output still lands in replay).
    const pty = new PtyManager({
      flushDelayMs: (id) => (activeSessions.all().includes(id) ? 16 : 100)
    })

    function sendToWindow(channel: string, ...args: unknown[]): void {
      windows.broadcast(channel, ...args)
    }

    const runtime = createRuntimeRegistry()

    // Plan usage and per-session model/context/cost, fed by Claude Code's statusLine (see attention/claudeSettings).
    const usage = createUsageService({ now: () => Date.now() })
    usage.onChange((state) => sendToWindow(IPC.evUsage, state))
    // Usage entries of sessions that were removed from the store are dropped.
    store.subscribe((data) => {
      const live = new Set(data.sessions.map((s) => s.id))
      for (const entry of usage.getState().sessions) {
        if (!live.has(entry.sessionId)) {
          usage.forget(entry.sessionId)
        }
      }
    })

    // Manual only (IPC.usageRefresh): never polled. The login token is read here and never crosses IPC.
    const usageRefresher = createUsageRefresher({
      readToken: () => readClaudeAccessToken({
        readFile: (filePath) => readFile(filePath, 'utf-8'),
        env: process.env,
        homedir
      }),
      fetchUsage: (token) => fetchOAuthUsage(token, {
        fetch: (url, init) => fetch(url, init),
        now: () => Date.now()
      }),
      service: usage,
      now: () => Date.now(),
      userDataDir: userData
    })

    // The renderer plays the user's sound for IPC.evSound; shell.beep() is only the fallback without a live window.
    const relaySound = createSoundRelay({
      getWindow: () => mainWindow,
      fallbackBeep: () => shell.beep(),
      onError: (where, error) => logMainError(userData, where, error)
    })

    // How a quota alert reaches the user: toast, sound and desktop notice (the guard and the autopilot share it).
    const quotaDelivery: QuotaDeliveryDeps = {
      sendAlert: (alert) => sendToWindow(IPC.evQuota, alert),
      playSound: () => relaySound('', 'quota'),
      notifyApp: (title, body) => {
        notifier.notifyApp(title, body)
      },
      onError
    }

    // OpenCode workers started from Claude terminals report here (through the worker plugin) and show as read-only tabs.
    const workers = createWorkerHub({
      now: () => Date.now(),
      isKnownSession: (id: string) => store.get().sessions.some((s) => s.id === id),
      isOpencodeSession: (id: string) => store.get().sessions.some((s) => s.id === id && s.agent === 'opencode'),
      onChange: (list) => sendToWindow(IPC.evWorkers, list)
    })
    store.subscribe((data) => {
      const live = new Set(data.sessions.map((s) => s.id))
      for (const worker of workers.getWorkers()) {
        for (const owner of worker.ownerSessionIds) {
          if (!live.has(owner)) workers.forgetSession(owner)
        }
      }
    })
    const workerSweep = setInterval(() => workers.sweep(), 5000)

    // A new pty process (start, restart, sleep/wake) invalidates the owner handshake of the previous process:
    // the first process that reports for an OpenCode session after this moment is the owner again.
    pty.onStart((id: string) => workers.forgetSession(id))

    const attention = createAttentionService({
      isKnownSession: (id: string) => store.get().sessions.some((s) => s.id === id),
      // A worker child of an OpenCode session (any proc other than the first-reported owner) must not touch
      // the parent's attention, activity/status, timeline or usage.
      isIgnoredProcess: (id: string, proc: string) => workers.isWorkerProc(id, proc),
      isFocused: isSessionOnScreen,
      beep: (id, reason) => relaySound(id, reason),
      flash: (on: boolean) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.flashFrame(on)
        }
      },
      isWindowFocused: isMainWindowFocused,
      settingsDir: attentionSettingsDir,
      onStatusLine: (id, payload) => usage.ingest(id, payload),
      // Activity (working / needs-input / finished) and auto status. The controller is created below; the hook
      // callback only runs once the server is up, so it is never called before the controller exists.
      onHookEvent: (event) => {
        controller.handleHookEvent(event)
        features.onHookEvent(event)
        code.onHookEvent(event)
        jarvis.onHookEvent(event)
      },
      onWorkerEvent: (sessionId, payload) => workers.ingest(sessionId, payload),
      // Bell escalation (D44): the service replays the sound/flash; the desktop notice reuses the same text builder as
      // the first raise (permission/done only; idle and bell stay in-app).
      getReminderSettings: () => store.getSettings().reminder,
      onReminder: (id, reason) => {
        const session = store.get().sessions.find((candidate) => candidate.id === id)
        if (session === undefined) return
        const notice = attentionNotice({
          name: session.name,
          reason,
          activityMessage: runtime.get(id)?.activityMessage
        })
        if (notice !== null) notifier.notifySession(id, notice.title, notice.body)
      }
    })

    /**
     * Every session visible in an OPEN window: main and Code can show different sessions. Jarvis (D53) always counts:
     * it is the user's own assistant panel, so it never pings, never shows a bell and is never put to sleep.
     */
    function onScreenSessionIds(): ReadonlySet<string> {
      const ids = new Set(activeSessions.all())
      for (const session of store.get().sessions) if (session.role === 'jarvis') ids.add(session.id)
      return ids
    }

    /** A session the user can see right now (in any open window): its bell still shows, but it never pings. */
    function isSessionOnScreen(id: string): boolean {
      return onScreenSessionIds().has(id)
    }

    // Idle sessions are put to sleep (Claude process stopped, conversation kept) when Settings > Sleep is on.
    const sleepScheduler = createSleepScheduler({
      getSettings: () => store.getSettings().sleep,
      // Shell sessions (Code mode) often run a dev server: never slept automatically (a manual Sleep still works).
      getSessions: () => store.get().sessions.map((s) => (s.agent === 'shell' ? { ...s, keepAwake: true } : s)),
      getRuntime: () => new Map(runtime.snapshot().map((state) => [state.sessionId, state])),
      getOnScreenSessionIds: onScreenSessionIds,
      sleepSession: (id) => controller.sleepSession(id),
      now: () => Date.now(),
      onError
    })
    runtime.subscribe((state) => sleepScheduler.touch(state.sessionId))

    const controller = createSessionController({
      store,
      pty,
      attention,
      runtime,
      activeSessions,
      sendPtyData: (id, data, seq) => {
        sleepScheduler.touch(id)
        sendToWindow(IPC.evPtyData, id, data, seq)
      },
      userDataDir: userData,
      onUsageLimit: (id) => features.onUsageLimit(id),
      // Only Jarvis gets extra arguments (D53); `jarvis` is created below, before any session can start.
      launchExtras: (session) => jarvis.launchExtrasFor(session)
    })

    // Prompt queue (D47): the next queued prompt is typed in when a session's turn finishes.
    const promptQueue = createPromptQueue({
      getData: () => store.get(),
      setQueue: (id, items) => store.setSessionQueue(id, items),
      getRuntime: (id) => runtime.get(id),
      subscribeRuntime: (listener) => runtime.subscribe(listener),
      write: (id, data) => controller.writeToPty(id, data),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (timer) => clearTimeout(timer),
      onError
    })

    // D61: Session.lastActiveAt for the sidebar / Hub sorts (turn start/end + a submitted line), throttled.
    const lastActive = createLastActiveTracker({
      now: () => Date.now(),
      write: (id, at) => store.setLastActiveAt(id, at),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout)
    })
    runtime.subscribe((state) => lastActive.onRuntime(state))

    // Timeline + "While you were away" (D29) and the quota autopilot (D30).
    const features = createFeatureWiring({
      userDataDir: userData,
      store,
      runtime,
      usage,
      pty,
      controller,
      send: sendToWindow,
      deliverAlert: (alert) => deliverQuotaAlert(quotaDelivery, alert),
      notifyContinueFailed: (sessionName) => {
        relaySound('', 'quota')
        notifier.notifyApp(CONTINUE_FAILED_TITLE, continueFailedBody(sessionName))
      },
      onError
    })

    const conversationSearch = createConversationSearch({
      configDir: claudeConfigDir,
      readdir: (dir) => readdir(dir),
      stat: async (file) => {
        try {
          const info = await stat(file)
          return { size: info.size, mtimeMs: info.mtimeMs }
        } catch {
          return null
        }
      },
      readFile: (file) => readFile(file, 'utf-8'),
      // D79: OpenCode has no transcript file; its turns come from `opencode session export` through this runner.
      runOpencodeExport: createOpencodeExportRunner()
    })

    // Jarvis (D53): when each session's process started and last printed, so a prompt is typed only once it settled.
    const ptyStartedAt = new Map<string, number>()
    const ptyLastOutputAt = new Map<string, number>()
    pty.onStart((id: string) => ptyStartedAt.set(id, Date.now()))
    pty.onData((id: string) => ptyLastOutputAt.set(id, Date.now()))
    store.subscribe((data) => {
      const live = new Set(data.sessions.map((s) => s.id))
      for (const map of [ptyStartedAt, ptyLastOutputAt]) for (const id of map.keys()) if (!live.has(id)) map.delete(id)
    })

    // D58: Jarvis opens terminal links through the same service as a click.
    const jarvisLinks = createAppLinkService((id) => store.get().sessions.find((s) => s.id === id)?.cwd ?? null)
    const jarvis = createJarvisWiring({
      userDataDir: userData,
      store,
      controller,
      tools: {
        getRuntime: (id) => runtime.get(id),
        store,
        queueChanged: (id) => promptQueue.onQueueChanged(id),
        screenText: (id, lines) => {
          const size = pty.size(id) ?? { cols: 120, rows: 30 }
          return renderScreenText(pty.replay(id).data, size.cols, size.rows, lines)
        },
        rawOutput: (id) => pty.replay(id).data,
        timeline: (id) => features.timeline.get(id),
        search: (query) => conversationSearch.search(store.get().sessions, query),
        lastAnswer: async (session) => {
          // D81: Cursor keeps its last reply in memory (its afterAgentResponse hook), not in a transcript file.
          if (session.agent === 'cursor') return controller.lastCursorAnswer(session.id)
          const messages = await conversationSearch.messagesOfSession(session)
          return messages === null ? null : lastAnswer(messages)
        },
        usage: () => usage.getState(),
        allTurns: () => features.timeline.all(),
        lastAway: () => features.lastAway(),
        // `code` is created below; these run only when Jarvis calls a tool, long after startup.
        code: {
          addRepo: (folder) => code.addRepo(folder),
          createWorktree: (input) => code.createWorktree(input),
          branches: (repoId) => code.branches(repoId),
          changes: (worktreeId) => code.changes(worktreeId),
          removeWorktree: (worktreeId) => code.removeWorktree(worktreeId),
          // D60: a getter, because `code` does not exist yet while this object is built.
          get git() { return code.git }
        },
        // D55: the rest of the app, through the same functions (and validation) as the IPC handlers.
        app: {
          getSettings: () => store.getSettings(),
          updateSettings: (raw) => store.updateSettings(asSettingsPatch(raw)),
          setChecklist: (id, raw) => store.setSessionChecklist(id, asChecklist(raw)),
          sendQueuedNow: (id, promptId) => promptQueue.sendNow(id, promptId),
          renameGroup: (id, name) => store.renameGroup(id, assertNonEmptyString(name, 'group name')),
          setGroupCollapsed: (id, collapsed) => store.setGroupCollapsed(id, collapsed),
          reorderGroups: (order) => store.reorderGroups(order),
          upsertStatus: (raw) => store.upsertStatus(assertStatusDef(raw)),
          removeStatus: (id) => store.removeStatus(id),
          reorderStatuses: (order) => store.reorderStatuses(order),
          savePreset: (raw) => store.savePreset(asPreset(raw)),
          removePreset: (id) => store.removePreset(id),
          clearAttention: (id) => attention.clear(id),
          markUnread: (id) => attention.markUnread(id),
          refreshUsage: () => usageRefresher.refresh(),
          autopilot: {
            state: async () => features.autopilot.getState(),
            sleepIdle: async () => features.autopilot.sleepIdle(),
            wake: async (sendContinue) => features.autopilot.wake({ sendContinue })
          },
          removeRepo: (id) => code.removeRepo(id),
          fileDiff: (worktreeId, filePath) => code.fileDiff(worktreeId, filePath),
          workers: () => workers.getWorkers(),
          windowState: () => windows.state(),
          popOutCode: () => { windows.popOutCode() },
          dockCode: () => windows.dockCode()
        },
        // D58: the last parts of the app, through the same functions as the IPC handlers.
        control: {
          setRepoCollapsed: (id, collapsed) => store.setRepoCollapsed(id, collapsed),
          setWorktreeCollapsed: (id, collapsed) => store.setWorktreeCollapsed(id, collapsed),
          openLink: (id, text, reveal) => jarvisLinks.open(id, text, reveal),
          pathKind: async (target) => {
            try {
              const info = await stat(target)
              return info.isDirectory() ? 'folder' : 'file'
            } catch {
              return null
            }
          },
          copyImage: (target) => {
            const image = nativeImage.createFromPath(target)
            if (image.isEmpty()) return false
            clipboard.writeImage(image)
            return true
          },
          loginItem: createLoginItem(app),
          showWindow: () => showMainWindow(mainWindow),
          hideWindow: () => { if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.hide() },
          quit: () => {
            markQuitting()
            app.quit()
          }
        },
        // D71: Jarvis reads the PC (specs, screens, GPU) and sets the GPU preference, to tune the settings for it.
        system: {
          systemInfo: () => {
            const cores = cpus()
            return {
              platform: osPlatform(),
              osRelease: osRelease(),
              arch: osArch(),
              cpuModel: cores[0]?.model ?? '',
              cpuCores: cores.length,
              totalMemoryMB: Math.round(totalmem() / (1024 * 1024)),
              freeMemoryMB: Math.round(freemem() / (1024 * 1024)),
              displays: screen.getAllDisplays().map((d) => ({ widthPx: d.size.width, heightPx: d.size.height, scaleFactor: d.scaleFactor }))
            }
          },
          getGpu: readGpuWithPref,
          setGpuPref: saveGpuPref
        },
        openSession: (id) => focusSession(id),
        startedAt: (id) => ptyStartedAt.get(id),
        lastOutputAt: (id) => ptyLastOutputAt.get(id)
      },
      sendConfirm: (request) => {
        if (mainWindow === null || mainWindow.isDestroyed()) return false
        showMainWindow(mainWindow)
        mainWindow.webContents.send(IPC.evJarvisConfirm, request)
        return true
      },
      // D55: a Code-mode command goes to the popped-out Code window when there is one, everything else to the main window.
      sendUi: (command) => {
        const codeWin = windows.code()
        const target = command.mode === 'code' && codeWin !== null ? codeWin : mainWindow
        if (target === null || target.isDestroyed()) return false
        target.webContents.send(IPC.evJarvisUi, command)
        return true
      },
      appVersion: app.getVersion(),
      broadcast: sendToWindow,
      notify: (title, body) => notifier.notifyApp(title, body),
      onError
    })

    // Code mode (D31): repos, worktrees, changes and diffs.
    // D60: an e2e run lists the pages it would open instead of opening a browser on the PC (inert when unset).
    const openedUrlsFile = process.env.SESSIONDECK_E2E_OPENED_URLS_FILE
    const code = createCodeWiring({
      store, controller, broadcast: sendToWindow, homedir: homedir(), now: () => Date.now(), onError,
      openExternal: (url) => openedUrlsFile ? appendFile(openedUrlsFile, `${url}\n`, 'utf-8') : shell.openExternal(url),
      ghReady: process.env.SESSIONDECK_E2E_NO_GH === '1' ? async () => false : createGhCheck(runGh, () => Date.now(), homedir())
    })

    // Quota thresholds and reset notices (see quota/quotaGuard.ts). Markers survive restarts. Every guard alert goes
    // through the autopilot first (it adds the sleep/wake offer or acts by itself).
    startQuotaWiring({
      ...quotaDelivery,
      usage,
      getSettings: () => store.getSettings().quota,
      markersFile: quotaMarkersFilePath(userData),
      now: () => Date.now(),
      autopilot: features.autopilot
    })

    // Sessions saved without a Claude conversation id get one now, so they start fresh instead of resuming a random id.
    controller.initializeRestoredSessions()

    // Resume on launch (D50): the sessions that were running when the app last quit start again in the background.
    const resumeFile = path.join(userData, RESUME_FILE_NAME)
    const launchResume = createLaunchResume({
      readFile: () => readFile(resumeFile, 'utf-8'),
      writeFile: (text) => writeFile(resumeFile, text, 'utf-8'),
      getSessions: () => store.get().sessions,
      subscribeRuntime: (listener) => runtime.subscribe(listener),
      resume: (id) => controller.resumeInBackground(id),
      enabled: () => store.getSettings().launch.resumeRunning,
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (timer) => clearTimeout(timer),
      onError
    })
    const resumeIds = await launchResume.loadSaved()
    launchResume.startTracking()

    await features.loadTimeline()
    await attention.start()
    // Before any session starts: Jarvis's launch files must exist when it is resumed below.
    await jarvis.start().catch((error: unknown) => onError('jarvis start', error))
    // Test seam: lets an end-to-end script reach the hook server of this run. Does nothing unless the variable is set.
    if (process.env.SESSIONDECK_E2E_ENDPOINT_FILE) {
      writeFile(process.env.SESSIONDECK_E2E_ENDPOINT_FILE, JSON.stringify(attention.endpoint()), 'utf-8').catch((error: unknown) => onError('e2e endpoint file', error))
    }
    sleepScheduler.start()
    // After the hook server is up: a resumed session needs its env (port, token) to report attention and status.
    launchResume.resumeSaved(resumeIds)

    // Desktop notification for permission requests and finished turns (the attention manager raises each once).
    wireAttentionNotices({
      attention,
      store,
      runtime,
      notifySession: (id, title, body) => notifier.notifySession(id, title, body),
      isFocused: isSessionOnScreen
    })

    const { window: win } = createMainWindow({
      preloadPath: path.join(__dirname, '../preload/index.mjs'),
      iconPath: appIconPath
    })

    mainWindow = win
    windows.setMain(win)

    // No-GPU support: classify once the first window exists (Chromium has reported its GPU by then) and remember the
    // result, so the next launch can turn acceleration off on a machine that only renders in software. Every step is
    // guarded: a failure leaves 'unknown' and the renderer keeps its default renderer.
    async function detectGpu(): Promise<GpuInfo> {
      let featureStatus: Record<string, string> | null = null
      let devices: readonly GpuDevice[] = []
      await waitForGpuInfoUpdate(GPU_INFO_UPDATE_WAIT_MS)
      try {
        // app.getGPUFeatureStatus() is typed as an interface; the classifier takes the plain status map.
        featureStatus = { ...app.getGPUFeatureStatus() }
      } catch (error) {
        onError('gpu feature status', error)
      }
      try {
        devices = parseGpuDevices(await app.getGPUInfo('basic'))
      } catch (error) {
        onError('gpu info', error)
      }
      const info = classifyGpu({ featureStatus, devices, accelerationDisabled })
      gpuInfo = info
      try {
        const before = gpuModeStore?.load()
        gpuModeStore?.recordDetection(info.mode, accelerationDisabled)
        if (info.mode === 'software') restartWithoutGpuOnFirstRun(before)
      } catch (error) {
        onError('gpu mode detection', error)
      }
      return info
    }

    /**
     * First run on a PC without a GPU: this run started with the GPU process on (nothing was known yet), so restart once
     * with it off. `before` is the stored state before the detection was recorded. See shouldRestartForSoftware.
     */
    let restartingForGpu = false
    function restartWithoutGpuOnFirstRun(before: GpuModeFile | undefined): void {
      if (restartingForGpu || before === undefined || gpuModeStore === null) return
      const decided = process.argv.some((arg) => arg.startsWith('--disable-gpu')) || process.env.SESSIONDECK_GPU_NO_RESTART === '1'
      if (!shouldRestartForSoftware({ file: before, env: process.env.SESSIONDECK_GPU, accelerationDisabled, softwareSeen: true, gpuDecidedByLaunch: decided })) return
      restartingForGpu = true
      // Saved first: even if the relaunch is cut short, no second restart can follow.
      gpuModeStore.save({ autoRestarted: true, lastSoftware: true })
      app.relaunch()
      app.quit()
    }
    gpuDetection = detectGpu().catch((error: unknown) => {
      onError('gpu detection', error)
      return gpuInfo
    })

    registerIpcHandlers({
      store,
      controller,
      pty,
      attention,
      runtime,
      usage,
      usageRefresher,
      workers,
      promptQueue,
      conversationSearch,
      broadcast: sendToWindow,
      windowForSender: (senderId) => {
        const role = windows.roleOf(senderId)
        return role === 'code' ? windows.code() : role === 'main' ? windows.main() : null
      },
      roleOfSender: (senderId) => windows.roleOf(senderId),
      activeSessions,
      windowState: () => windows.state(),
      popOutCode: () => { windows.popOutCode() },
      dockCode: () => windows.dockCode(),
      openFileViewer: (request) => {
        viewerWindows.request(() => createMainWindow({ preloadPath: path.join(__dirname, '../preload/index.mjs'), iconPath: appIconPath, viewer: request }).window)
      },
      // D83: the title comes from the store, never from the renderer; one window per worktree, capped.
      openChangesWindow: (worktreeId) => {
        const worktree = store.getWorktree(worktreeId)
        if (worktree === undefined) return
        const title = `Changes · ${worktree.name} · SessionDeck`
        const bounds = fitBounds(changesBounds.get(worktreeId), screen.getAllDisplays().map((display) => display.workArea), CHANGES_DEFAULT_SIZE)
        changesWindows.request(worktreeId, () => {
          const win = createMainWindow({ preloadPath: path.join(__dirname, '../preload/index.mjs'), iconPath: appIconPath, changes: { worktreeId, title, bounds } }).window
          trackChangesBounds(worktreeId, win)
          return win
        })
      },
      attachChangesWindow,
      userDataDir: userData,
      loginItem: createLoginItem(app),
      getGpuInfo: readGpuWithPref,
      reportGpuProbe: (softwareSeen: boolean): void => {
        // Only software evidence is stored from the window: 'hardware' from main already covers the other case, and a
        // window that merely failed to probe must not undo a good detection. recordDetection ignores runs where we turned the GPU off.
        if (!softwareSeen) return
        const before = gpuModeStore?.load()
        gpuModeStore?.recordDetection('software', accelerationDisabled)
        restartWithoutGpuOnFirstRun(before)
      },
      setGpuPref: saveGpuPref,
      onUserActivity: () => {
        sleepScheduler.noteUserInput()
        features.onUserActivity()
      },
      onUserInput: (id, data) => lastActive.onUserInput(id, data)
    })
    // Start loading first so the quota handlers can wait for it; they are registered before the renderer asks.
    const autopilotLoaded = features.startAutopilot()
    features.registerIpc()
    code.registerIpc()
    jarvis.registerIpc()
    await autopilotLoaded

    // Tray icon and menu, close-to-tray (the window is hidden, sessions keep running). Never throws.
    const trayWiring = attachTrayWiring({
      win,
      store,
      runtime,
      notifier,
      trayIconPath,
      trayAttentionIconPath,
      userDataDir: userData,
      onError,
      focusSession
    })

    async function runShutdownStep(step: string, action: () => void | Promise<void>): Promise<void> {
      try {
        await action()
      } catch (error) {
        logMainError(userData, `shutdown: ${step}`, error)
      }
    }

    async function shutdown(): Promise<void> {
      // First: the list of running sessions is saved before the kills below would empty it.
      await runShutdownStep('save running sessions', () => launchResume.stop())
      sleepScheduler.stop()
      clearInterval(workerSweep)
      workers.dispose()
      promptQueue.stop()
      await runShutdownStep('jarvis', () => jarvis.stop())
      await runShutdownStep('timeline + autopilot', () => features.shutdown())
      await runShutdownStep('code mode', () => code.shutdown())
      await runShutdownStep('last active', () => lastActive.flush())
      await runShutdownStep('close Code window', () => windows.closeCode())
      await runShutdownStep('flush store', () => saver.flush())
      await runShutdownStep('kill sessions', () => pty.killAll())
      await runShutdownStep('dispose pty', () => pty.dispose())
      await runShutdownStep('stop attention', () => attention.stop())
      await runShutdownStep('dispose tray', () => trayWiring.stop())
    }

    let shutdownStarted = false
    let shutdownDone = false

    app.on('before-quit', (event) => {
      markQuitting()
      if (shutdownDone) return
      // Electron does not await async listeners, so the quit is held until the shutdown steps finish.
      event.preventDefault()
      if (shutdownStarted) return
      shutdownStarted = true
      void shutdown().then(() => {
        shutdownDone = true
        app.quit()
      })
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin' && !isQuitting()) {
        app.quit()
      }
    })
  }).catch((error: unknown) => {
    logMainError(userDataDir(), 'startup', error)
  })
}
