import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { soundStore } from '../sound/soundStore'

function selectEnabled(): boolean {
  return soundStore.get().enabled
}

/** Attention sound on/off. Backed by the shared sound store, so the status bar and the Settings dialog agree. */
export function useSoundEnabled(): readonly [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(soundStore.subscribe, selectEnabled, selectEnabled)

  const setEnabled = useCallback((next: boolean): void => {
    soundStore.update({ enabled: next })
  }, [])

  useEffect((): void => {
    window.api.setSoundEnabled(enabled).catch((error: unknown): void => {
      console.error('SessionDeck: failed to set the attention sound state', error)
    })
  }, [enabled])

  return [enabled, setEnabled]
}
