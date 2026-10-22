import { describe, expect, it } from 'vitest'
import type { ChangedFile, ChangeKind, WorktreeChanges } from '../../../shared/types'
import {
  MAX_RENDERED_DIFF_LINES,
  changeTooltip,
  countsLabel,
  diffLineMarker,
  fileCountsLabel,
  kindLabel,
  kindLetter,
  limitDiffLines,
  splitPath
} from './changesFormat'
import type { DiffLine } from './parseUnifiedDiff'

function file(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path, kind: 'modified', additions: 1, deletions: 0, ...overrides }
}

function changes(files: readonly ChangedFile[], overrides: Partial<WorktreeChanges> = {}): WorktreeChanges {
  const additions = files.reduce((sum: number, f: ChangedFile): number => sum + (f.additions ?? 0), 0)
  const deletions = files.reduce((sum: number, f: ChangedFile): number => sum + (f.deletions ?? 0), 0)
  return {
    worktreeId: 'w1',
    files,
    truncated: false,
    additions,
    deletions,
    computedAt: 1,
    ...overrides
  }
}

describe('kindLetter and kindLabel', () => {
  it('maps every change kind to its one-letter badge', () => {
    const kinds: readonly ChangeKind[] = ['added', 'modified', 'deleted', 'renamed', 'untracked']
    expect(kinds.map(kindLetter)).toEqual(['A', 'M', 'D', 'R', 'U'])
  })

  it('maps every change kind to its label, untracked as "New file (untracked)"', () => {
    expect(kindLabel('added')).toBe('Added')
    expect(kindLabel('modified')).toBe('Modified')
    expect(kindLabel('deleted')).toBe('Deleted')
    expect(kindLabel('renamed')).toBe('Renamed')
    expect(kindLabel('untracked')).toBe('New file (untracked)')
  })
})

describe('countsLabel', () => {
  it('reads "No changes" when there are no files', () => {
    expect(countsLabel(changes([]))).toBe('No changes')
  })

  it('uses the singular for one file', () => {
    expect(countsLabel(changes([file('a.ts', { additions: 2, deletions: 1 })]))).toBe('+2 −1 · 1 file')
  })

  it('uses the plural for several files and sums the counts', () => {
    const files = [file('a.ts', { additions: 12, deletions: 3 }), file('b.ts', { additions: 4, deletions: 0 })]
    expect(countsLabel(changes(files))).toBe('+16 −3 · 2 files')
  })

  it('adds a plus to the file count when the list is truncated', () => {
    const files = Array.from({ length: 500 }, (_, i: number): ChangedFile => file(`f${String(i)}.ts`))
    expect(countsLabel(changes(files, { truncated: true }))).toBe('+500 −0 · 500+ files')
  })
})

describe('fileCountsLabel', () => {
  it('shows added and deleted line counts', () => {
    expect(fileCountsLabel(file('a.ts', { additions: 12, deletions: 3 }))).toBe('+12 −3')
  })

  it('shows "binary" when git gave no line counts', () => {
    expect(fileCountsLabel(file('a.png', { additions: null, deletions: null }))).toBe('binary')
  })
})

describe('changeTooltip', () => {
  it('shows the path for a plain change', () => {
    expect(changeTooltip(file('src/a.ts'))).toBe('src/a.ts')
  })

  it('shows "old → new" for a rename', () => {
    expect(changeTooltip(file('src/new.ts', { kind: 'renamed', oldPath: 'src/old.ts' }))).toBe('src/old.ts → src/new.ts')
  })
})

describe('splitPath', () => {
  it('splits a nested path into a folder with a trailing slash and a file name', () => {
    expect(splitPath('src/main/index.ts')).toEqual({ dir: 'src/main/', name: 'index.ts' })
  })

  it('gives an empty folder for a file at the root', () => {
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })
})

describe('diffLineMarker', () => {
  const line = (kind: DiffLine['kind']): DiffLine => ({ kind, text: 'x', oldNo: null, newNo: null })

  it('gives the sign for context, added and deleted lines only', () => {
    expect([line('context'), line('add'), line('del'), line('hunk'), line('meta'), line('note')].map(diffLineMarker)).toEqual([
      ' ',
      '+',
      '-',
      '',
      '',
      ''
    ])
  })
})

describe('limitDiffLines', () => {
  const many = (count: number): DiffLine[] =>
    Array.from({ length: count }, (_, i: number): DiffLine => ({ kind: 'context', text: String(i), oldNo: i, newNo: i }))

  it('keeps every line when there are at most the render limit', () => {
    expect(limitDiffLines(many(MAX_RENDERED_DIFF_LINES))).toEqual({ rows: many(MAX_RENDERED_DIFF_LINES), limited: false })
  })

  it('keeps only the first lines and reports the limit when there are more', () => {
    const result = limitDiffLines(many(MAX_RENDERED_DIFF_LINES + 3))
    expect(result.rows).toHaveLength(MAX_RENDERED_DIFF_LINES)
    expect(result.rows[0].text).toBe('0')
    expect(result.limited).toBe(true)
  })
})
