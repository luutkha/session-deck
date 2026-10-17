import type { TraySettings } from '../../shared/types'

export const DEDUPE_WINDOW_MS = 3000

export interface NotificationOptions {
  readonly title: string
  readonly body: string
  readonly icon?: string
}

/** The subset of Electron's Notification used here. */
export interface NotificationLike {
  on(event: 'click' | 'close', listener: () => void): unknown
  show(): void
}

export type NotificationCtor = new (options: NotificationOptions) => NotificationLike

export interface DesktopNotifierDeps {
  readonly NotificationCtor: NotificationCtor
  readonly isSupported: () => boolean
  readonly getSettings: () => TraySettings
  readonly isWindowFocused: () => boolean
  readonly onClickSession: (id: string) => void
  readonly onClickApp: () => void
  readonly iconPath?: string
  readonly now?: () => number
  readonly onError?: (where: string, error: unknown) => void
}

export interface DesktopNotifier {
  /** Returns true when a notification was shown. */
  notifySession(id: string, title: string, body: string): boolean
  /** Returns true when a notification was shown. */
  notifyApp(title: string, body: string): boolean
  /** Number of notifications still open (referenced until they close). */
  liveCount(): number
}

export function createDesktopNotifier(deps: DesktopNotifierDeps): DesktopNotifier {
  const { NotificationCtor, isSupported, getSettings, isWindowFocused, onClickSession, onClickApp, iconPath } = deps
  const now = deps.now ?? (() => Date.now())
  const report = (where: string, error: unknown): void => {
    deps.onError?.(where, error)
  }

  // Keeps the Notification objects alive: a collected object would drop its click handler.
  const live = new Set<NotificationLike>()
  const recent = new Map<string, number>()

  function pruneRecent(current: number): void {
    for (const [key, at] of recent) {
      if (current - at >= DEDUPE_WINDOW_MS) {
        recent.delete(key)
      }
    }
  }

  function allowed(): boolean {
    if (!isSupported()) return false
    const settings = getSettings()
    if (!settings.desktopNotifications) return false
    if (settings.notifyOnlyWhenUnfocused && isWindowFocused()) return false
    return true
  }

  function show(key: string, title: string, body: string, onClick: () => void): boolean {
    if (!allowed()) return false
    const current = now()
    pruneRecent(current)
    const last = recent.get(key)
    if (last !== undefined && current - last < DEDUPE_WINDOW_MS) return false

    try {
      const options: NotificationOptions = iconPath === undefined ? { title, body } : { title, body, icon: iconPath }
      const notification = new NotificationCtor(options)
      notification.on('click', onClick)
      notification.on('close', () => {
        live.delete(notification)
      })
      live.add(notification)
      notification.show()
      recent.set(key, current)
      return true
    } catch (error) {
      report('desktop notification', error)
      return false
    }
  }

  return {
    notifySession(id: string, title: string, body: string): boolean {
      return show(`session:${id}:${title}`, title, body, () => onClickSession(id))
    },

    notifyApp(title: string, body: string): boolean {
      return show(`app:${title}`, title, body, () => onClickApp())
    },

    liveCount(): number {
      return live.size
    }
  }
}
