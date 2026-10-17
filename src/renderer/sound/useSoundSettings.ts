// Settings hook for the Settings dialog: current settings, updates, previews and file picking.
import { useCallback, useState, useSyncExternalStore } from 'react'
import { getSharedSoundPlayer } from './soundPlayer'
import { soundStore } from './soundStore'
import type { SoundEvent } from '../../shared/types'
import type { SoundChoice, SoundSettings, SoundSettingsPatch } from './soundSettings'

export interface UseSoundSettingsResult {
  readonly settings: SoundSettings
  readonly update: (patch: SoundSettingsPatch) => void
  /** Plays the current choice for the event (preview, regardless of the enabled flag). */
  readonly test: (event: SoundEvent) => Promise<void>
  /** Opens the file picker; a chosen file becomes the event's sound and is previewed once. */
  readonly chooseFile: (event: SoundEvent) => Promise<void>
  readonly lastError: string | null
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') {
    return error.message
  }
  return typeof error === 'string' && error !== '' ? error : 'Unknown sound error'
}

function selectSettings(): SoundSettings {
  return soundStore.get()
}

/** Plays a choice with the current volume. Returns an error message, or null on success. */
async function previewChoice(choice: SoundChoice): Promise<string | null> {
  try {
    await getSharedSoundPlayer().play(choice, soundStore.get().volume)
    return null
  } catch (error: unknown) {
    return messageOf(error)
  }
}

export function useSoundSettings(): UseSoundSettingsResult {
  const settings = useSyncExternalStore(soundStore.subscribe, selectSettings, selectSettings)
  const [lastError, setLastError] = useState<string | null>(null)

  const update = useCallback((patch: SoundSettingsPatch): void => {
    soundStore.update(patch)
  }, [])

  const test = useCallback(async (event: SoundEvent): Promise<void> => {
    setLastError(await previewChoice(soundStore.get().perReason[event]))
  }, [])

  const chooseFile = useCallback(async (event: SoundEvent): Promise<void> => {
    setLastError(null)
    let path: string | null
    try {
      path = await window.api.pickSoundFile()
    } catch (error: unknown) {
      setLastError(messageOf(error))
      return
    }
    if (path === null || path.trim() === '') {
      return
    }
    const choice: SoundChoice = { kind: 'file', path }
    soundStore.update({ perReason: { [event]: choice } })
    setLastError(await previewChoice(choice))
  }, [])

  return { settings, update, test, chooseFile, lastError }
}
