import type { SoundEvent } from '../../shared/types'
import { IPC } from '../../shared/ipc'

/** The subset of WebContents the relay needs. */
export interface SoundSender {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

/** The subset of BrowserWindow the relay needs. `webContents` may be missing once the window is torn down. */
export interface SoundTarget {
  isDestroyed(): boolean
  readonly webContents: SoundSender | null | undefined
}

export interface SoundRelayDeps {
  /** Returns the current main window, or null when none exists. */
  readonly getWindow: () => SoundTarget | null
  /** Plays the OS beep. Used only when the renderer cannot receive the sound event. */
  readonly fallbackBeep: () => void
  /** Records a failure. Used for failures that the relay recovers from, so they are not lost. */
  readonly onError: (where: string, error: unknown) => void
}

export type SoundRelay = (id: string, event: SoundEvent) => void

function liveSender(window: SoundTarget | null): SoundSender | null {
  if (window === null || window.isDestroyed()) return null
  const sender = window.webContents
  if (!sender || sender.isDestroyed()) return null
  return sender
}

/**
 * Decides how an attention sound reaches the user. The renderer plays the user's chosen sound when it receives
 * `IPC.evSound`. If the window or its webContents is gone, or the send fails, the OS beep is used instead.
 * Never throws.
 */
export function createSoundRelay(deps: SoundRelayDeps): SoundRelay {
  const { getWindow, fallbackBeep, onError } = deps

  const fallback = (): void => {
    try {
      fallbackBeep()
    } catch (error) {
      onError('sound fallback beep', error)
    }
  }

  return (id: string, event: SoundEvent): void => {
    const sender = liveSender(getWindow())
    if (sender === null) {
      fallback()
      return
    }
    try {
      sender.send(IPC.evSound, id, event)
    } catch (error) {
      onError('sound send', error)
      fallback()
    }
  }
}
