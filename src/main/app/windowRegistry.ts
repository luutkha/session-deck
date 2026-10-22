import type { WindowRole, WindowState } from '../../shared/types'

/** The part of a BrowserWindow the registry uses. Electron windows satisfy it; tests pass fakes. */
export interface WindowLike {
  isDestroyed(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  close(): void
  on(event: 'closed', cb: () => void): unknown
  readonly webContents: { readonly id: number; send(channel: string, ...args: unknown[]): void }
}

export interface WindowRegistryDeps<W extends WindowLike> {
  createWindow(role: WindowRole): W
  onStateChange(state: WindowState): void
  onError(where: string, error: unknown): void
}

export interface WindowRegistry<W extends WindowLike> {
  setMain(win: W): void
  /** Null when no main window was set or it is destroyed. */
  main(): W | null
  /** Null when the Code window is closed or destroyed. */
  code(): W | null
  state(): WindowState
  /** Sends to every live window. A send that throws is reported and the other windows still get it. */
  broadcast(channel: string, ...args: unknown[]): void
  roleOf(webContentsId: number): WindowRole | null
  /** Opens the Code window once; otherwise restores, shows and focuses the existing one. */
  popOutCode(): W
  /** Closes the Code window if it is open. Its 'closed' event reports the state change. */
  dockCode(): void
  focusedRole(): WindowRole | null
  /** Same as dockCode; used on quit. */
  closeCode(): void
}

export function createWindowRegistry<W extends WindowLike>(deps: WindowRegistryDeps<W>): WindowRegistry<W> {
  let mainWin: W | null = null
  let codeWin: W | null = null

  const live = (win: W | null): W | null => (win === null || win.isDestroyed() ? null : win)

  /** Forgets the Code window if it is still the registered one. Returns true when it was. */
  const forgetCode = (win: W): boolean => {
    if (codeWin !== win) return false
    codeWin = null
    return true
  }

  /** A destroyed Code window that never reported 'closed' is dropped here, so state stays honest. */
  const reapCode = (): void => {
    if (codeWin === null || !codeWin.isDestroyed()) return
    if (forgetCode(codeWin)) deps.onStateChange({ codePoppedOut: false })
  }

  const watchCodeClosed = (win: W): void => {
    win.on('closed', () => {
      if (forgetCode(win)) deps.onStateChange({ codePoppedOut: false })
    })
  }

  const code = (): W | null => live(codeWin)

  const state = (): WindowState => ({ codePoppedOut: code() !== null })

  const broadcast = (channel: string, ...args: unknown[]): void => {
    const targets = [live(mainWin), code()].filter((win): win is W => win !== null)
    for (const win of new Set(targets)) {
      try {
        win.webContents.send(channel, ...args)
      } catch (error) {
        deps.onError(`broadcast ${channel}`, error)
      }
    }
  }

  const roleOf = (webContentsId: number): WindowRole | null => {
    if (live(mainWin)?.webContents.id === webContentsId) return 'main'
    if (code()?.webContents.id === webContentsId) return 'code'
    return null
  }

  const focusedRole = (): WindowRole | null => {
    if (live(mainWin)?.isFocused()) return 'main'
    if (code()?.isFocused()) return 'code'
    return null
  }

  const showAndFocus = (win: W): void => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const popOutCode = (): W => {
    reapCode()
    const existing = code()
    if (existing !== null) {
      showAndFocus(existing)
      return existing
    }
    const created = deps.createWindow('code')
    codeWin = created
    watchCodeClosed(created)
    deps.onStateChange({ codePoppedOut: true })
    return created
  }

  const dockCode = (): void => {
    reapCode()
    code()?.close()
  }

  return {
    setMain: (win) => {
      mainWin = win
    },
    main: () => live(mainWin),
    code,
    state,
    broadcast,
    roleOf,
    popOutCode,
    dockCode,
    focusedRole,
    closeCode: dockCode
  }
}
