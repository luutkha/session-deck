// Mount once (App). Plays the configured sound for each attention event and keeps main's enabled flag in sync.
import { useEffect, useSyncExternalStore } from 'react'
import { getSharedSoundPlayer } from './soundPlayer'
import { soundStore } from './soundStore'
import type { SoundEvent } from '../../shared/types'

function selectEnabled(): boolean {
  return soundStore.get().enabled
}

export function useAttentionSound(): void {
  const enabled = useSyncExternalStore(soundStore.subscribe, selectEnabled, selectEnabled)

  useEffect((): (() => void) => {
    return window.api.onAttentionSound((_sessionId: string, event: SoundEvent): void => {
      const settings = soundStore.get()
      if (!settings.enabled) {
        return
      }
      getSharedSoundPlayer()
        .play(settings.perReason[event], settings.volume)
        .catch((error: unknown): void => {
          console.warn('SessionDeck: attention sound failed', error)
        })
    })
  }, [])

  useEffect((): void => {
    window.api.setSoundEnabled(enabled).catch((error: unknown): void => {
      console.error('SessionDeck: failed to set the attention sound state', error)
    })
  }, [enabled])
}
