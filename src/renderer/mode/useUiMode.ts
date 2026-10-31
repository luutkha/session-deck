// Which mode the window shows. The rules are in modeLogic.ts; this hook keeps the stored mode, follows the
// Code window state from main, and runs the pop-out / dock calls with their errors shown to the user.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UiMode, WindowRole, WindowState } from '../../shared/types'
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'
import { effectiveMode, modeAfterDock, MODE_STORAGE_KEY, parseStoredMode } from './modeLogic'
import { errorMessage } from '../../shared/guards'

export interface UiModeApi {
  readonly role: WindowRole
  /** The mode on screen. */
  readonly mode: UiMode
  readonly codePoppedOut: boolean
  /** Switches the stored mode. Ignored in the Code window. */
  readonly setMode: (mode: UiMode) => void
  /** Opens the Code window, or focuses it when it is open. */
  readonly popOutCode: () => void
  /** Closes the Code window; Code returns to the main window. */
  readonly dockCode: () => void
  /** The last pop-out or dock failure, shown inline; null when none. */
  readonly windowError: string | null
}

export function readWindowRole(): WindowRole {
  return window.api?.windowRole === 'code' ? 'code' : 'main'
}

/** Runs a window call. A failure (even a synchronous throw) is logged and reported through onError. */
function runWindowCall(
  label: string,
  call: () => Promise<void>,
  onError: (message: string | null) => void
): void {
  onError(null)
  Promise.resolve()
    .then(call)
    .catch((error: unknown): void => {
      console.error(`SessionDeck: ${label} failed`, error)
      onError(errorMessage(error))
    })
}

export function useUiMode(): UiModeApi {
  const [role] = useState<WindowRole>(readWindowRole)
  const [stored, setStored] = useState<UiMode>((): UiMode =>
    role === 'code' ? 'code' : parseStoredMode(readStorageItem(MODE_STORAGE_KEY))
  )
  const [codePoppedOut, setCodePoppedOut] = useState(false)
  const [windowError, setWindowError] = useState<string | null>(null)
  const previousPopped = useRef(false)

  // Only the main window owns the stored mode; the Code window never writes it.
  useEffect((): void => {
    if (role === 'main') {
      writeStorageItem(MODE_STORAGE_KEY, stored)
    }
  }, [role, stored])

  // Code closed (popped out to docked): the main window switches to Code.
  useEffect((): void => {
    const back = modeAfterDock(previousPopped.current, codePoppedOut)
    previousPopped.current = codePoppedOut
    if (back !== null && role === 'main') {
      setStored(back)
    }
  }, [codePoppedOut, role])

  useEffect((): (() => void) | undefined => {
    const api = window.api
    if (api === undefined) {
      return undefined
    }
    let live = true
    const apply = (state: WindowState): void => {
      if (live) {
        setCodePoppedOut(state.codePoppedOut)
      }
    }
    api.getWindowState().then(apply).catch((error: unknown): void => {
      console.error('SessionDeck: could not read the window state', error)
    })
    const off = api.onWindowState(apply)
    return (): void => {
      live = false
      off()
    }
  }, [])

  const setMode = useCallback((next: UiMode): void => {
    if (role === 'main') {
      setStored(next)
    }
  }, [role])

  const popOutCode = useCallback((): void => {
    runWindowCall('opening the Code window', (): Promise<void> => window.api.popOutCode(), setWindowError)
  }, [])

  const dockCode = useCallback((): void => {
    runWindowCall('moving Code back', (): Promise<void> => window.api.dockCode(), setWindowError)
  }, [])

  return {
    role,
    mode: effectiveMode(role, stored, codePoppedOut),
    codePoppedOut,
    setMode,
    popOutCode,
    dockCode,
    windowError
  }
}
