import { Menu, Tray, type MenuItemConstructorOptions } from 'electron'
import { buildTrayModel, type TrayItem, type TrayModelInput } from './trayModel'

const DEFAULT_DEBOUNCE_MS = 100

export interface AppTrayDeps {
  readonly iconPath: string
  /** Shown instead of iconPath while something needs attention. null = keep the normal icon. */
  readonly attentionIconPath: string | null
  readonly snapshot: () => TrayModelInput
  readonly onShow: () => void
  readonly onToggle: () => void
  readonly onSession: (sessionId: string) => void
  readonly onQuit: () => void
  readonly onError: (where: string, error: unknown) => void
  readonly debounceMs?: number
}

export interface AppTray {
  /** Rebuilds the menu, icon and tooltip after a short quiet period (trailing debounce). */
  refresh(): void
  dispose(): void
}

function toTemplate(item: TrayItem, deps: AppTrayDeps): MenuItemConstructorOptions {
  switch (item.kind) {
    case 'action':
      return item.id === 'show'
        ? { label: item.label, click: () => deps.onShow() }
        : { label: item.label, click: () => deps.onQuit() }
    case 'session': {
      const sessionId = item.sessionId
      return { label: item.label, click: () => deps.onSession(sessionId) }
    }
    case 'separator':
      return { type: 'separator' }
    case 'header':
      return { label: item.label, enabled: false }
  }
}

/**
 * Creates the system tray. Returns null (after logging through onError) when the tray cannot be created, for
 * example without an icon or on an unsupported system. The app then runs without a tray.
 */
export function createAppTray(deps: AppTrayDeps): AppTray | null {
  let tray: Tray
  try {
    tray = new Tray(deps.iconPath)
  } catch (error) {
    deps.onError('tray create', error)
    return null
  }

  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const guarded = (where: string, action: () => void): void => {
    try {
      action()
    } catch (error) {
      deps.onError(where, error)
    }
  }

  const apply = (): void => {
    if (disposed) return
    guarded('tray update', () => {
      const model = buildTrayModel(deps.snapshot())
      tray.setToolTip(model.tooltip)
      const icon = model.hasAttention && deps.attentionIconPath !== null ? deps.attentionIconPath : deps.iconPath
      tray.setImage(icon)
      tray.setContextMenu(Menu.buildFromTemplate(model.items.map((item) => toTemplate(item, deps))))
    })
  }

  guarded('tray click handler', () => {
    tray.on('click', () => {
      guarded('tray click', () => deps.onToggle())
    })
  })

  apply()

  return {
    refresh(): void {
      if (disposed) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        apply()
      }, debounceMs)
    },

    dispose(): void {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      guarded('tray destroy', () => tray.destroy())
    }
  }
}
