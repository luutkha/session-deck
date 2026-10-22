// Pure helpers for the "While you were away" dialog. No React, no DOM.
import type { AwaySummary, Id } from '../../shared/types'

/** Fetches the last summary. Never rejects: a failure is logged and read as "no summary". */
export async function fetchLastAwaySummary(
  getLast: () => Promise<AwaySummary | null>
): Promise<AwaySummary | null> {
  try {
    return await getLast()
  } catch (error: unknown) {
    console.error('Could not load the last "While you were away" summary', error)
    return null
  }
}

/** Clicking a row opens that session first, then closes the dialog. */
export function openAwayRow(sessionId: Id, onOpenSession: (id: Id) => void, onClose: () => void): void {
  onOpenSession(sessionId)
  onClose()
}
