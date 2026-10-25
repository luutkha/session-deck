/**
 * The message when hands-off quota automation could not continue a held session — either the typed "continue" was
 * given up (no quiet output in time) or waking the session failed. The user hears it; nothing else happens.
 */
export const CONTINUE_FAILED_TITLE = 'SessionDeck needs you'

export function continueFailedBody(sessionName: string): string {
  return `SessionDeck could not continue ${sessionName} after the reset — it needs you.`
}
