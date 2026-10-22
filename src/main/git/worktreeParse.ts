// Pure parsers for git's NUL-separated (-z) output. Malformed output throws; it is never guessed at.
import type { ChangeKind } from '../../shared/types'

const NUL = '\0'
const NUMSTAT_LINE = /^(-|\d+)\t(-|\d+)\t(.*)$/

export interface LineCounts {
  /** null for binary files. */
  readonly additions: number | null
  readonly deletions: number | null
}

export interface NameStatusEntry {
  readonly path: string
  readonly oldPath?: string
  readonly kind: ChangeKind
}

const KIND_BY_LETTER: Readonly<Record<string, ChangeKind>> = {
  A: 'added',
  C: 'added',
  D: 'deleted',
  R: 'renamed',
  M: 'modified',
  T: 'modified'
}

/** Splits NUL-terminated output into records; the empty piece after the last NUL is dropped. */
function recordsOf(output: string): string[] {
  const parts = output.split(NUL)
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

function requireField(value: string | undefined, format: string): string {
  if (value === undefined) throw new Error(`Unexpected git output: ${format}`)
  return value
}

function countOf(value: string): number | null {
  return value === '-' ? null : Number(value)
}

/**
 * `git diff --numstat -z`: "adds\tdels\tpath\0", or for a rename "adds\tdels\t\0old\0new\0".
 * Returns counts keyed by the (new) path.
 */
export function parseNumstatZ(output: string): ReadonlyMap<string, LineCounts> {
  const records = recordsOf(output)
  const counts = new Map<string, LineCounts>()
  let index = 0
  while (index < records.length) {
    const match = NUMSTAT_LINE.exec(requireField(records[index], 'numstat'))
    if (match === null) throw new Error('Unexpected git output: numstat')
    const [, adds, dels, pathField] = match
    const isRename = pathField === ''
    const filePath = requireField(isRename ? records[index + 2] : pathField, 'numstat')
    counts.set(filePath, { additions: countOf(adds), deletions: countOf(dels) })
    index += isRename ? 3 : 1
  }
  return counts
}

/**
 * `git diff --name-status -z`: "S\0path\0", or for R/C "S\0old\0new\0" (S may carry a score, e.g. R100).
 */
export function parseNameStatusZ(output: string): NameStatusEntry[] {
  const records = recordsOf(output)
  const entries: NameStatusEntry[] = []
  let index = 0
  while (index < records.length) {
    const status = requireField(records[index], 'name-status')
    const letter = status.charAt(0)
    const hasOldPath = letter === 'R' || letter === 'C'
    const kind = KIND_BY_LETTER[letter] ?? 'modified'
    if (hasOldPath) {
      const oldPath = requireField(records[index + 1], 'name-status')
      const newPath = requireField(records[index + 2], 'name-status')
      entries.push({ kind, path: newPath, oldPath })
      index += 3
    } else {
      entries.push({ kind, path: requireField(records[index + 1], 'name-status') })
      index += 2
    }
  }
  return entries
}

/** `git ls-files --others -z`: one NUL-terminated path per record. */
export function parseUntrackedZ(output: string): string[] {
  return recordsOf(output)
}
