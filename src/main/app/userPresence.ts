/** Records a failure without throwing (the caller decides how to show it). */
export type UserPresenceErrorHandler = (where: string, error: unknown) => void

export interface UserPresenceDeps {
  readonly now: () => number
  /** Milliseconds without input before the user counts as away; null = the feature is off. Read on every input. */
  readonly getAwayAfterMs: () => number | null
  /** Called when input arrives after an away gap of at least getAwayAfterMs(). */
  readonly onReturn: (since: number, until: number) => void
  readonly onError: UserPresenceErrorHandler
}

export interface UserPresence {
  /** Keyboard, mouse or wheel input inside SessionDeck. */
  noteInput(): void
  /** Epoch ms of the last recorded input (the creation time until the first one). */
  lastInputAt(): number
}

/**
 * Tracks the last input inside SessionDeck. An input that follows a gap of at least the away threshold means the user
 * came back: `onReturn(since, until)` gets the previous input time and this one. Never throws; failures go to onError.
 */
export function createUserPresence(deps: UserPresenceDeps): UserPresence {
  let lastInput = deps.now()

  return {
    noteInput(): void {
      const previous = lastInput
      const current = deps.now()
      lastInput = current
      try {
        const awayAfterMs = deps.getAwayAfterMs()
        if (awayAfterMs !== null && current - previous >= awayAfterMs) {
          deps.onReturn(previous, current)
        }
      } catch (error) {
        deps.onError('user presence', error)
      }
    },

    lastInputAt(): number {
      return lastInput
    }
  }
}
