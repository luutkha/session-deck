import type { StatusDef } from '../../shared/types'
import { validateStatusDraft } from './dialogLogic'

export interface StatusDraftEvaluation {
  /** The trimmed draft to commit, or null when the draft is invalid or unchanged. */
  readonly next: StatusDef | null
  /** Inline error for an invalid draft, or null when the draft is valid. */
  readonly error: string | null
}

/**
 * Pure commit decision for a status row draft. Mirrors the editor's original
 * behavior: an invalid draft becomes an inline error, an unchanged draft clears
 * any pending error without committing, and a valid change yields the trimmed
 * draft to commit.
 */
export function evaluateStatusDraft(
  current: StatusDef,
  nextName: string,
  nextColor: string
): StatusDraftEvaluation {
  const result = validateStatusDraft({ name: nextName, color: nextColor })
  if (!result.ok) {
    return { next: null, error: result.error }
  }
  const trimmed = nextName.trim()
  if (trimmed === current.name && nextColor === current.color) {
    return { next: null, error: null }
  }
  return { next: { id: current.id, name: trimmed, color: nextColor }, error: null }
}