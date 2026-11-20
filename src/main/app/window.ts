import { app, BrowserWindow, nativeImage, shell, type BrowserWindowConstructorOptions, type NativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { attachWindowDiagnostics } from './windowDiagnostics'
import { isSameDocumentNavigation } from './navigation'
import { IPC, CODE_WINDOW_ARG, VIEWER_WINDOW_ARG_PREFIX } from '../../shared/ipc'
import type { WindowRole } from '../../shared/types'

import type { WindowLike } from './windowRegistry'

export type { WindowLike } from './windowRegistry'

const WINDOW_BACKGROUND = '#0a0a0a'
const WINDOW_MIN_WIDTH = 900
const WINDOW_MIN_HEIGHT = 600
const SHOW_AFTER_LOAD_MS = 250
const SHOW_DEADLINE_MS = 4000
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 800
/** A popped-out Code window opens this far right and down from the main window. */
const CODE_WINDOW_OFFSET = 32
const VIEWER_WIDTH = 860
const VIEWER_HEIGHT = 720
const VIEWER_MIN_WIDTH = 420
const VIEWER_MIN_HEIGHT = 300
const MAIN_WINDOW_TITLE = 'SessionDeck'
const CODE_WINDOW_TITLE = 'SessionDeck · Code'

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
  /** 'code' opens the popped-out Code window. Default 'main'. */
  readonly role?: WindowRole
  /** The main window; a 'code' window opens offset from it. Not a modal parent: it is an independent window. */
  readonly parent?: BrowserWindow
  /** D73: opens a small file-viewer window for this file instead of the app (role stays 'main', it is not registered). */
  readonly viewer?: { readonly sessionId: string; readonly text: string }
}

export interface MainWindow {
  readonly window: BrowserWindow
  readonly isFocused: () => boolean
}

/** Typed view of a BrowserWindow for the window registry (checked at compile time by windowRegistry users). */
export function asWindowLike(win: BrowserWindow): WindowLike {
  return win
}

/** Top-left for a Code window: offset from the parent when it is alive, otherwise the OS default. */
function codeWindowPosition(parent: BrowserWindow | undefined): Pick<BrowserWindowConstructorOptions, 'x' | 'y'> {
  if (parent === undefined || parent.isDestroyed()) return {}
  const [x, y] = parent.getPosition()
  return { x: x + CODE_WINDOW_OFFSET, y: y + CODE_WINDOW_OFFSET }
}

/** Keeps the Code window title: the page's <title> would otherwise replace it. */
function lockTitle(win: BrowserWindow): void {
  win.webContents.on('page-title-updated', (event) => event.preventDefault())
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

/** The options that differ between the main and the Code window. */
function roleOptions(role: WindowRole, parent: BrowserWindow | undefined): Pick<BrowserWindowConstructorOptions, 'title' | 'x' | 'y'> & { readonly additionalArguments: readonly string[] } {
  if (role === 'code') {
    return { title: CODE_WINDOW_TITLE, ...codeWindowPosition(parent), additionalArguments: [CODE_WINDOW_ARG] }
  }
  return { title: MAIN_WINDOW_TITLE, additionalArguments: [] }
}

/** The title and launch argument of a detached viewer window: the file's base name, the request in the argument. */
function viewerOptions(viewer: { readonly sessionId: string; readonly text: string }): { readonly title: string; readonly additionalArguments: readonly string[] } {
  const base = viewer.text.replace(/[:]\d+(:\d+)?$/, '').split(/[\\/]/).pop() ?? ''
  return { title: base.length > 0 ? `${base} · SessionDeck` : MAIN_WINDOW_TITLE, additionalArguments: [VIEWER_WINDOW_ARG_PREFIX + encodeURIComponent(JSON.stringify(viewer))] }
}

export function createMainWindow(deps: MainWindowDeps): MainWindow {
  const { preloadPath, iconPath, parent, viewer } = deps
  const role: WindowRole = deps.role ?? 'main'
  const { additionalArguments, ...placement } = viewer === undefined ? roleOptions(role, parent) : viewerOptions(viewer)

  let isWindowFocused = false

  const mainWindow = new BrowserWindow({
    width: viewer === undefined ? DEFAULT_WIDTH : VIEWER_WIDTH,
    height: viewer === undefined ? DEFAULT_HEIGHT : VIEWER_HEIGHT,
    minWidth: viewer === undefined ? WINDOW_MIN_WIDTH : VIEWER_MIN_WIDTH,
    minHeight: viewer === undefined ? WINDOW_MIN_HEIGHT : VIEWER_MIN_HEIGHT,
    backgroundColor: WINDOW_BACKGROUND,
    icon: loadIcon(iconPath),
    ...titleBarOptions(),
    ...placement,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [...additionalArguments]
    }
  })

  if (role === 'code' || viewer !== undefined) lockTitle(mainWindow)

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
    if (!isSameDocumentNavigation(mainWindow.webContents.getURL(), url)) {
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