import { app, BrowserWindow, dialog, Notification, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
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
import { createMainWindow, focusSessionInWindow, showMainWindow } from './app/window'
import { createWindowRegistry } from './app/windowRegistry'
import { createActiveSessions } from './app/activeSessions'
import { createCodeWiring } from './app/codeWiring'
import { logMainError } from './app/errorLog'
import { createLoginItem } from './app/loginItem'
import { isQuitting, markQuitting } from './app/quitState'
import { resolveIconPath } from './app/iconPaths'
import { attachTrayWiring } from './app/trayWiring'
import { createDesktopNotifier } from './notify/desktopNotifier'
import { wireAttentionNotices } from './notify/attentionWiring'
import { deliverQuotaAlert, startQuotaWiring, type QuotaDeliveryDeps } from './quota/quotaWiring'
import { createFeatureWiring } from './app/featureWiring'
import { quotaMarkersFilePath } from './quota/quotaMarkers'
import { createSleepScheduler } from './sleep/SleepScheduler'
import { createWorkerHub } from './workers'
import { IPC } from '../shared/ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SAVER_DELAY_MS = 400

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

  app.whenReady().then(async () => {
    const userData = userDataDir()
    const storePath = storeFilePath(userData)
    const attentionSettingsDir = attentionDir(userData)
    const onError = (where: string, error: unknown): void => logMainError(userData, where, error)

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
      const detail = error instanceof Error ? error.message : String(error)
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

    // Code mode (D31): the main window, plus the Code window while it is popped out. Events go to both.
    const windows = createWindowRegistry<BrowserWindow>({
      createWindow: (role) => createMainWindow({
        preloadPath: path.join(__dirname, '../preload/index.mjs'),
        iconPath: appIconPath,
        role,
        parent: mainWindow ?? undefined
      }).window,
      onStateChange: (state) => windows.broadcast(IPC.evWindowState, state),
      onError
    })
    codeWindowFocused = () => windows.code()?.isFocused() === true
    const activeSessions = createActiveSessions()

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

    const pty = new PtyManager()

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

    const attention = createAttentionService({
      isKnownSession: (id: string) => store.get().sessions.some((s) => s.id === id),
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
      },
      onWorkerEvent: (sessionId, payload) => workers.ingest(sessionId, payload)
    })

    function activeSessionId(): string | null {
      return controller.getActiveSessionId()
    }

    /** The session the user is looking at right now (in the focused window): its bell still shows, but it never pings. */
    function isSessionOnScreen(id: string): boolean {
      const role = windows.focusedRole()
      return role !== null && activeSessions.get(role) === id
    }

    // Idle sessions are put to sleep (Claude process stopped, conversation kept) when Settings > Sleep is on.
    const sleepScheduler = createSleepScheduler({
      getSettings: () => store.getSettings().sleep,
      // Shell sessions (Code mode) often run a dev server: never slept automatically (a manual Sleep still works).
      getSessions: () => store.get().sessions.map((s) => (s.agent === 'shell' ? { ...s, keepAwake: true } : s)),
      getRuntime: () => new Map(runtime.snapshot().map((state) => [state.sessionId, state])),
      getActiveSessionId: () => activeSessions.get(windows.focusedRole() ?? 'main') ?? activeSessionId(),
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
      sendPtyData: (id, data, seq) => {
        sleepScheduler.touch(id)
        sendToWindow(IPC.evPtyData, id, data, seq)
      },
      userDataDir: userData,
      onUsageLimit: (id) => features.onUsageLimit(id)
    })

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
      onError
    })

    // Code mode (D31): repos, worktrees, changes and diffs.
    const code = createCodeWiring({ store, controller, broadcast: sendToWindow, homedir: homedir(), now: () => Date.now(), onError })

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

    await features.loadTimeline()
    await attention.start()
    // Test seam: lets an end-to-end script reach the hook server of this run. Does nothing unless the variable is set.
    if (process.env.SESSIONDECK_E2E_ENDPOINT_FILE) {
      writeFile(process.env.SESSIONDECK_E2E_ENDPOINT_FILE, JSON.stringify(attention.endpoint()), 'utf-8').catch((error: unknown) => onError('e2e endpoint file', error))
    }
    sleepScheduler.start()

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

    registerIpcHandlers({
      store,
      controller,
      pty,
      attention,
      runtime,
      usage,
      usageRefresher,
      workers,
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
      getActiveSessionId: activeSessionId,
      userDataDir: userData,
      loginItem: createLoginItem(app),
      onUserActivity: () => {
        sleepScheduler.noteUserInput()
        features.onUserActivity()
      }
    })
    // Start loading first so the quota handlers can wait for it; they are registered before the renderer asks.
    const autopilotLoaded = features.startAutopilot()
    features.registerIpc()
    code.registerIpc()
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
      sleepScheduler.stop()
      clearInterval(workerSweep)
      await runShutdownStep('timeline + autopilot', () => features.shutdown())
      await runShutdownStep('code mode', () => code.shutdown())
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
