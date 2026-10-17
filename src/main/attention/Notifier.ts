import type { AttentionReason, SoundEvent } from '../../shared/types'

export interface NotifierDeps {
  /** Requests the sound for an attention event. Main does not play it; the renderer does, or a fallback beep does. */
  readonly beep: (id: string, event: SoundEvent) => void
  readonly flash: (on: boolean) => void
  readonly isWindowFocused: () => boolean
  readonly minGapMs?: number
  readonly now?: () => number
}

export interface Notifier {
  notify(id: string, reason: AttentionReason): void
  setSoundEnabled(enabled: boolean): void
  stopFlash(): void
}

export function createNotifier(deps: NotifierDeps): Notifier {
  const { beep, flash, isWindowFocused, minGapMs = 1500, now = () => Date.now() } = deps
  let soundEnabled = true
  let lastBeepTime = -minGapMs // Allow first beep immediately
  let flashActive = false

  return {
    notify(id: string, reason: AttentionReason): void {
      const currentTime = now()

      if (soundEnabled && currentTime - lastBeepTime >= minGapMs) {
        beep(id, reason)
        lastBeepTime = currentTime
      }

      if (!isWindowFocused()) {
        if (!flashActive) {
          flash(true)
          flashActive = true
        }
      }
    },

    setSoundEnabled(enabled: boolean): void {
      soundEnabled = enabled
    },

    stopFlash(): void {
      if (flashActive) {
        flash(false)
        flashActive = false
      }
    }
  }
}