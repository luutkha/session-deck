import { useCallback, useState } from 'react'

// Unsent "Add a step" text per session. The panel remounts when the active session changes,
// so the draft lives here instead of in component state and survives switching sessions.
const drafts = new Map<string, string>()

export function readChecklistDraft(sessionId: string): string {
  return drafts.get(sessionId) ?? ''
}

export function writeChecklistDraft(sessionId: string, text: string): void {
  if (text.length === 0) drafts.delete(sessionId)
  else drafts.set(sessionId, text)
}

export function useChecklistDraft(sessionId: string): readonly [string, (text: string) => void] {
  const [draft, setLocal] = useState(() => readChecklistDraft(sessionId))
  const setDraft = useCallback(
    (text: string): void => {
      writeChecklistDraft(sessionId, text)
      setLocal(text)
    },
    [sessionId]
  )
  return [draft, setDraft] as const
}
