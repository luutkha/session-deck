// D83: which file the detached Changes window's split layout shows by default, and what the right pane says when
// there is none. No DOM: the panel's rendering of the detach button is checked in ChangesPanel.test.tsx.
import { describe, expect, it } from 'vitest'
import type { ChangedFile, WorktreeChanges } from '../../../shared/types'
import {
  SPLIT_ERROR_TEXT,
  SPLIT_LOADING_TEXT,
  SPLIT_NO_CHANGES_TEXT,
  SPLIT_PICK_HINT,
  splitEmptyText,
  splitSelection
} from './changesWindowLogic'

function file(path: string): ChangedFile {
  return { path, kind: 'modified', additions: 1, deletions: 0 }
}

function changes(files: readonly ChangedFile[], error?: string): WorktreeChanges {
  return {
    worktreeId: 'w1',
    files,
    truncated: false,
    additions: 0,
    deletions: 0,
    computedAt: 1,
    ...(error !== undefined ? { error } : {})
  }
}

describe('splitSelection', () => {
  it('auto-selects the first changed file when nothing is selected', () => {
    expect(splitSelection(changes([file('b.ts'), file('a.ts')]), null)).toBe('b.ts')
  })

  it('keeps the selected file while it is still changed', () => {
    expect(splitSelection(changes([file('b.ts'), file('a.ts')]), 'a.ts')).toBe('a.ts')
  })

  it('re-selects the first file when the selected file disappeared', () => {
    expect(splitSelection(changes([file('c.ts'), file('d.ts')]), 'a.ts')).toBe('c.ts')
  })

  it('shows nothing without a list, on a git error, or with no changed files', () => {
    expect(splitSelection(null, 'a.ts')).toBeNull()
    expect(splitSelection(changes([file('a.ts')], 'git is missing'), 'a.ts')).toBeNull()
    expect(splitSelection(changes([]), 'a.ts')).toBeNull()
  })
})

describe('splitEmptyText', () => {
  it('explains why the right pane has no diff', () => {
    expect(splitEmptyText(null)).toBe(SPLIT_LOADING_TEXT)
    expect(splitEmptyText(changes([], undefined))).toBe(SPLIT_NO_CHANGES_TEXT)
    expect(splitEmptyText(changes([file('a.ts')], 'boom'))).toBe(SPLIT_ERROR_TEXT)
    expect(splitEmptyText(changes([file('a.ts')]))).toBe(SPLIT_PICK_HINT)
  })
})
