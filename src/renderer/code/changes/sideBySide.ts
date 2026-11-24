// Pure layout for side-by-side (split) diff rendering. No React, no IPC.
// Changed lines: a run of deletions followed by a run of additions is paired index by index.
import type { DiffLine } from './parseUnifiedDiff'

export type SplitRow =
  | { readonly kind: 'full'; readonly line: DiffLine }
  | { readonly kind: 'pair'; readonly left: DiffLine | null; readonly right: DiffLine | null }

function pairRun(rows: SplitRow[], dels: readonly DiffLine[], adds: readonly DiffLine[]): void {
  const count = Math.max(dels.length, adds.length)
  for (let index = 0; index < count; index += 1) {
    rows.push({ kind: 'pair', left: dels[index] ?? null, right: adds[index] ?? null })
  }
}

/** Places change runs side by side; a lone run leaves the other column empty. */
export function pairLines(lines: readonly DiffLine[]): readonly SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === 'del') {
      const dels: DiffLine[] = []
      while (index < lines.length && lines[index].kind === 'del') {
        dels.push(lines[index])
        index += 1
      }
      const adds: DiffLine[] = []
      while (index < lines.length && lines[index].kind === 'add') {
        adds.push(lines[index])
        index += 1
      }
      pairRun(rows, dels, adds)
      continue
    }
    if (line.kind === 'add') {
      const adds: DiffLine[] = []
      while (index < lines.length && lines[index].kind === 'add') {
        adds.push(lines[index])
        index += 1
      }
      pairRun(rows, [], adds)
      continue
    }
    rows.push(
      line.kind === 'context'
        ? { kind: 'pair', left: line, right: line }
        : { kind: 'full', line }
    )
    index += 1
  }
  return rows
}
