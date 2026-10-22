import { app, type BrowserWindow } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SessionStore } from '../store/SessionStore'
import type { RuntimeRegistry } from './runtimeRegistry'
import type { DesktopNotifier } from '../notify/desktopNotifier'
import { createAppTray, type AppTray } from '../tray/appTray'
import type { TrayModelInput, TraySessionInput } from '../tray/trayModel'
import { shouldHideOnClose } from './closeToTray'
import { isQuitting, markQuitting } from './quitState'
import { focusSessionInWindow, showMainWindow } from './window'

/** Marker file: the "still running in the tray" notice was shown once for this install. */
export const TRAY_NOTICE_FILE = 'tray-notice-shown'

export interface TrayWiringDeps {
  readonly win: BrowserWindow
  readonly store: SessionStore
  readonly runtime: RuntimeRegistry
  readonly notifier: DesktopNotifier
  readonly trayIconPath: string | null
  readonly trayAttentionIconPath: string | null
  readonly userDataDir: string
  readonly onError: (where: string, error: unknown) => void
  /** Shows a session from the tray menu in the window that owns it. Default: the main window. */
  readonly focusSession?: (sessionId: string) => void
}

export interface TrayWiring {
  /** True when the tray exists (close-to-tray only works with a tray). */
  available(): boolean
  stop(): void
}

function trayNoticePath(userDataDir: string): string {
  return path.join(userDataDir, TRAY_NOTICE_FILE)
}

/** Shows the one-time notice; the flag file is written only once the notice actually went out. */
function announceFirstHide(deps: TrayWiringDeps): void {
  const flag = trayNoticePath(deps.userDataDir)
  if (existsSync(flag)) return
  if (!deps.notifier.notifyApp('SessionDeck', 'SessionDeck is still running in the tray')) return
  try {
    writeFileSync(flag, new Date().toISOString(), 'utf-8')
  } catch (error) {
    deps.onError('tray notice flag', error)
  }
}

function snapshotOf(deps: TrayWiringDeps): TrayModelInput {
  const sessions = deps.store.get().sessions
    .filter((s) => s.closedAt === undefined)
    .map((s): TraySessionInput => {
      const state = deps.runtime.get(s.id)
      return {
        id: s.id,
        name: s.name,
        attention: state?.attention ?? null,
        run: state?.run ?? 'exited'
      }
    })
  const visible = !deps.win.isDestroyed() && deps.win.isVisible()
  return { sessions, windowVisible: visible }
}

/** Creates the tray, the menu actions and the close-to-tray handler for the main window. Never throws. */
export function attachTrayWiring(deps: TrayWiringDeps): TrayWiring {
  const { win, store, runtime } = deps
  let tray: AppTray | null = null

  if (deps.trayIconPath === null) {
    deps.onError('tray icon', new Error('build/tray.png not found; running without a tray'))
  } else {
    tray = createAppTray({
      iconPath: deps.trayIconPath,
      attentionIconPath: deps.trayAttentionIconPath,
      snapshot: () => snapshotOf(deps),
      onShow: () => showMainWindow(win),
      onToggle: () => {
        if (!win.isDestroyed() && win.isVisible() && win.isFocused()) {
          win.hide()
        } else {
          showMainWindow(win)
        }
      },
      onSession: (sessionId: string) => (deps.focusSession ?? ((id: string) => focusSessionInWindow(win, id)))(sessionId),
      onQuit: () => {
        markQuitting()
        app.quit()
      },
      onError: deps.onError
    })
  }

  const refresh = (): void => {
    tray?.refresh()
  }
  const unsubscribeStore = store.subscribe(refresh)
  const unsubscribeRuntime = runtime.subscribe(refresh)
  win.on('show', refresh)
  win.on('hide', refresh)

  win.on('close', (event) => {
    const hide = shouldHideOnClose({
      quitting: isQuitting(),
      closeToTray: store.getSettings().tray.closeToTray,
      trayAvailable: tray !== null
    })
    if (!hide) return
    event.preventDefault()
    win.hide()
    announceFirstHide(deps)
  })

  return {
    available: () => tray !== null,
    stop(): void {
      unsubscribeStore()
      unsubscribeRuntime()
      tray?.dispose()
      tray = null
    }
  }
}
