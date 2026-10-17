import { app, BrowserWindow, nativeImage, shell, type BrowserWindowConstructorOptions, type NativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { attachWindowDiagnostics } from './windowDiagnostics'
import { IPC } from '../../shared/ipc'

const WINDOW_BACKGROUND = '#0a0a0a'
const WINDOW_MIN_WIDTH = 900
const WINDOW_MIN_HEIGHT = 600
const SHOW_AFTER_LOAD_MS = 250
const SHOW_DEADLINE_MS = 4000
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 800

// Orca chrome: hidden native title bar. Windows/Linux draw the window controls as an overlay
// in the same dark tone; macOS keeps the inset traffic lights.
const TITLE_BAR_OVERLAY = { color: '#0a0a0a', symbolColor: '#a1a1a1', height: 36 } as const

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function titleBarOptions(): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset' }
  }
  return { titleBarStyle: 'hidden', titleBarOverlay: TITLE_BAR_OVERLAY }
}

export interface MainWindowDeps {
  readonly preloadPath: string
  /** Absolute path of icon.png, or null when the file is missing (the default app icon is used then). */
  readonly iconPath: string | null
}

export interface MainWindow {
  readonly window: BrowserWindow
  readonly isFocused: () => boolean
}

/** Restores (when minimized), shows and focuses the window. Null-safe: a missing or destroyed window is ignored. */
export function showMainWindow(win: BrowserWindow | null): void {
  if (win === null || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Brings the window up and asks the renderer to select the given session. */
export function focusSessionInWindow(win: BrowserWindow | null, sessionId: string): void {
  if (win === null || win.isDestroyed()) return
  showMainWindow(win)
  win.webContents.send(IPC.evFocusSession, sessionId)
}

function loadIcon(iconPath: string | null): NativeImage | undefined {
  if (iconPath === null) return undefined
  const image = nativeImage.createFromPath(iconPath)
  return image.isEmpty() ? undefined : image
}

export function createMainWindow(deps: MainWindowDeps): MainWindow {
  const { preloadPath, iconPath } = deps

  let isWindowFocused = false

  const mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    backgroundColor: WINDOW_BACKGROUND,
    icon: loadIcon(iconPath),
    ...titleBarOptions(),
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  attachWindowDiagnostics(mainWindow, app.getPath('userData'))

  mainWindow.on('focus', () => {
    isWindowFocused = true
    mainWindow.flashFrame(false)
  })

  mainWindow.on('blur', () => {
    isWindowFocused = false
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl && !url.startsWith(currentUrl)) {
      event.preventDefault()
    }
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 'ready-to-show' alone is not reliable here (it never fired with the hidden title bar on Windows, leaving an
  // invisible window). Show on whichever comes first: ready-to-show, a short delay after load, or a hard deadline.
  let shown = false
  const showOnce = (): void => {
    if (shown || mainWindow.isDestroyed()) return
    shown = true
    mainWindow.show()
  }
  mainWindow.once('ready-to-show', showOnce)
  mainWindow.webContents.once('did-finish-load', () => setTimeout(showOnce, SHOW_AFTER_LOAD_MS))
  setTimeout(showOnce, SHOW_DEADLINE_MS)

  return {
    window: mainWindow,
    isFocused: () => isWindowFocused
  }
}