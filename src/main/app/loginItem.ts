import type { LoginItemState } from '../../shared/types'

/** The subset of Electron's `app` the login item helper uses (injectable for tests). */
export interface LoginItemApp {
  readonly isPackaged: boolean
  getLoginItemSettings(): { readonly openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

export interface LoginItem {
  get(): LoginItemState
  set(openAtLogin: boolean): LoginItemState
}

/**
 * Start-on-login for the packaged app only. Unpackaged (dev) runs report supported=false and ignore set(), because
 * registering the dev electron binary as a login item would be wrong.
 */
export function createLoginItem(app: LoginItemApp): LoginItem {
  const read = (): LoginItemState => {
    if (!app.isPackaged) {
      return { supported: false, openAtLogin: false }
    }
    return { supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin }
  }

  return {
    get: read,
    set(openAtLogin: boolean): LoginItemState {
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin })
      }
      return read()
    }
  }
}
