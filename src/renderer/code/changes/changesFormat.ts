// Pure display text and style lookups for the Changes panel. No React, no IPC.
import type { ChangedFile, ChangeKind, WorktreeChanges } from '../../../shared/types'
import type { DiffLine, DiffLineKind } from './parseUnifiedDiff'

const MINUS_SIGN = '−'
const COUNT_SEPARATOR = ' · '
const RENAME_ARROW = ' → '
const BINARY_COUNT_LABEL = 'binary'
const TRUNCATED_SUFFIX = '+'

const KIND_LETTER: Readonly<Record<ChangeKind, string>> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U'
}

const KIND_LABEL: Readonly<Record<ChangeKind, string>> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New file (untracked)'
}

const KIND_BADGE_CLASS: Readonly<Record<ChangeKind, string>> = {
  added: 'bg-status-success-background text-status-success',
  modified: 'bg-status-warning-background text-status-warning',
  deleted: 'bg-destructive/15 text-destructive',
  renamed: 'bg-primary/15 text-primary',
  untracked: 'bg-muted text-muted-foreground'
}

const DIFF_LINE_CLASS: Readonly<Record<DiffLineKind, string>> = {
  context: 'text-foreground/80',
  add: 'bg-status-success-background text-foreground',
  del: 'bg-destructive/10 text-foreground',
  hunk: 'mt-1 border-t border-border bg-muted/40 text-muted-foreground',
  meta: 'text-muted-foreground',
  note: 'italic text-muted-foreground'
}

const DIFF_MARKER: Readonly<Record<DiffLineKind, string>> = {
  context: ' ',
  add: '+',
  del: '-',
  hunk: '',
  meta: '',
  note: ''
}

export function kindLetter(kind: ChangeKind): string {
  return KIND_LETTER[kind]
}

export function kindLabel(kind: ChangeKind): string {
  return KIND_LABEL[kind]
}

export function kindBadgeClass(kind: ChangeKind): string {
  return KIND_BADGE_CLASS[kind]
}

export function diffLineClass(kind: DiffLineKind): string {
  return DIFF_LINE_CLASS[kind]
}

/** The one-character sign shown in front of a diff line ('' when the kind has none). */
export function diffLineMarker(line: DiffLine): string {
  return DIFF_MARKER[line.kind]
}

/** "+12 −3" for a file, or "binary" when git gave no line counts. */
export function fileCountsLabel(file: ChangedFile): string {
  if (file.additions === null || file.deletions === null) {
    return BINARY_COUNT_LABEL
  }
  return `+${String(file.additions)} ${MINUS_SIGN}${String(file.deletions)}`
}

/** Header text for the whole change set, e.g. "+12 −3 · 4 files" or "No changes". */
export function countsLabel(changes: WorktreeChanges): string {
  const count = changes.files.length
  if (count === 0) {
    return 'No changes'
  }
  const plural = count === 1 && !changes.truncated ? 'file' : 'files'
  const suffix = changes.truncated ? TRUNCATED_SUFFIX : ''
  const totals = `+${String(changes.additions)} ${MINUS_SIGN}${String(changes.deletions)}`
  return `${totals}${COUNT_SEPARATOR}${String(count)}${suffix} ${plural}`
}

/** Full path for a tooltip; a rename reads "old → new". */
export function changeTooltip(file: ChangedFile): string {
  if (file.kind === 'renamed' && file.oldPath !== undefined) {
    return `${file.oldPath}${RENAME_ARROW}${file.path}`
  }
  return file.path
}

export const MAX_RENDERED_DIFF_LINES = 5000

export interface LimitedDiffLines {
  readonly rows: readonly DiffLine[]
  /** True when lines past MAX_RENDERED_DIFF_LINES were left out. */
  readonly limited: boolean
}

export function limitDiffLines(lines: readonly DiffLine[]): LimitedDiffLines {
  return {
    rows: lines.slice(0, MAX_RENDERED_DIFF_LINES),
    limited: lines.length > MAX_RENDERED_DIFF_LINES
  }
}

export interface SplitPath {
  /** Folders with a trailing slash, '' for a file at the root. */
  readonly dir: string
  readonly name: string
}

export function splitPath(path: string): SplitPath {
  const slash = path.lastIndexOf('/')
  if (slash < 0) {
    return { dir: '', name: path }
  }
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}
