// D83: the pure decisions of the detached Changes window's wide layout (list left, diff right). Kept out of
// ChangesPanel so the "which file is shown by default" rule can be tested without a DOM.
import type { ChangedFile, WorktreeChanges } from '../../../shared/types'

export const SPLIT_PICK_HINT = 'Select a file to see its diff.'
export const SPLIT_LOADING_TEXT = 'Loading changes...'
export const SPLIT_NO_CHANGES_TEXT = 'No changes yet.'
export const SPLIT_ERROR_TEXT = 'Changes are unavailable.'

/**
 * The file the split layout shows: the selected path while it is still a changed file, otherwise the first
 * changed file (the window always shows a diff when there is one). No list, a git error or no files = nothing.
 */
export function splitSelection(changes: WorktreeChanges | null, selected: string | null): string | null {
  if (changes === null || changes.error !== undefined || changes.files.length === 0) return null
  if (selected !== null && changes.files.some((file: ChangedFile): boolean => file.path === selected)) {
    return selected
  }
  return changes.files[0]?.path ?? null
}

/** Text of the right pane when no file is selected; null = say nothing (the left column already explains). */
export function splitEmptyText(changes: WorktreeChanges | null): string | null {
  if (changes === null) return SPLIT_LOADING_TEXT
  if (changes.error !== undefined) return SPLIT_ERROR_TEXT
  if (changes.files.length === 0) return SPLIT_NO_CHANGES_TEXT
  return SPLIT_PICK_HINT
}
