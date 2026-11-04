// Carries out Jarvis's screen commands in this window (D55): switches the mode first when the targets live in the
// other one, then lets the mounted workspace run the action, and answers main with what happened.
import { useEffect, useRef } from 'react'
import type { JarvisUiCommand, UiMode, WindowRole } from '../../shared/types'
import { errorMessage } from '../../shared/guards'
import { workspaceUiFor } from './jarvisUiBridge'
import { describeSound, runWindowAction, type WindowUiDeps } from './windowUi'
import { soundStore } from '../sound/soundStore'
import { getSharedSoundPlayer } from '../sound/soundPlayer'

const WINDOW_DEPS: WindowUiDeps = {
  sound: {
    get: () => soundStore.get(),
    update: (patch) => soundStore.update(patch),
    play: (choice, volume) => getSharedSoundPlayer().play(choice, volume)
  }
}

/** How long a mode switch may take to mount the other workspace. */
const MOUNT_WAIT_MS = 4000

export interface JarvisUiWindow {
  readonly role: WindowRole
  readonly mode: UiMode
  readonly codePoppedOut: boolean
  readonly setMode: (mode: UiMode) => void
}

/** Decides the mode the command needs, or throws why this window cannot show it. */
export function modeForCommand(command: JarvisUiCommand, window: JarvisUiWindow): UiMode | null {
  const want = command.action.kind === 'mode' ? command.action.mode : command.mode ?? null
  if (want === null || want === window.mode) return want
  if (window.role === 'code') throw new Error('The Code window shows Code mode only.')
  if (want === 'code' && window.codePoppedOut) throw new Error('Code mode is in its own window right now.')
  return want
}

export function useJarvisUi(window: JarvisUiWindow): void {
  const latest = useRef(window)
  latest.current = window

  useEffect(() => {
    const api = globalThis.window.api
    if (api?.onJarvisUi === undefined) return undefined
    return api.onJarvisUi((command: JarvisUiCommand): void => {
      void (async (): Promise<void> => {
        try {
          // D58: window actions (sounds) need no workspace and no mode switch.
          const own = runWindowAction(command.action, WINDOW_DEPS)
          if (own !== null) {
            await api.jarvisUiReply(command.id, true, own)
            return
          }
          const target = modeForCommand(command, latest.current)
          if (target !== null && target !== latest.current.mode) latest.current.setMode(target)
          const handler = await workspaceUiFor(target, MOUNT_WAIT_MS)
          const result = handler(command.action)
          await api.jarvisUiReply(command.id, true, command.action.kind === 'state' ? `${result}
${describeSound(soundStore.get())}` : result)
        } catch (error) {
          await api.jarvisUiReply(command.id, false, errorMessage(error)).catch(() => undefined)
        }
      })()
    })
  }, [])
}
