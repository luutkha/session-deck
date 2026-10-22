import { useMemo, type ReactElement } from 'react'
import { DIFF_MAX_BYTES, type FileDiff } from '../../../shared/types'
import { cn } from '../../lib/utils'
import { diffLineClass, diffLineMarker, limitDiffLines, MAX_RENDERED_DIFF_LINES } from './changesFormat'
import { parseUnifiedDiff, type DiffLine } from './parseUnifiedDiff'

export interface DiffViewProps {
  readonly diff: FileDiff | null
  readonly loading: boolean
  readonly error: string | null
}

const BINARY_MESSAGE = 'Binary file, no text diff.'
const EMPTY_MESSAGE = 'No text changes.'
const LOADING_MESSAGE = 'Loading diff...'
const BYTES_PER_KB = 1024
const TRUNCATED_MESSAGE = `Diff cut at ${String(DIFF_MAX_BYTES / BYTES_PER_KB)} KB.`
const LIMIT_MESSAGE = `Showing the first ${String(MAX_RENDERED_DIFF_LINES)} lines.`

function Notice({ text }: { readonly text: string }): ReactElement {
  return <p className="px-3 py-2 font-sans text-xs text-muted-foreground">{text}</p>
}

function DiffRow({ line }: { readonly line: DiffLine }): ReactElement {
  return (
    <div className={cn('flex', diffLineClass(line.kind))}>
      <span className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-muted-foreground/60">
        {line.oldNo ?? ''}
      </span>
      <span className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-muted-foreground/60">
        {line.newNo ?? ''}
      </span>
      <span className="w-4 shrink-0 select-none text-center">{diffLineMarker(line)}</span>
      <span className="whitespace-pre pr-4">{line.text}</span>
    </div>
  )
}

/** Text lines only: git's meta lines are replaced by the file path header. */
function isBodyLine(line: DiffLine): boolean {
  return line.kind !== 'meta'
}

function DiffText({ diff }: { readonly diff: FileDiff }): ReactElement {
  const parsed = useMemo((): readonly DiffLine[] => parseUnifiedDiff(diff.diff).filter(isBodyLine), [diff.diff])
  const limited = useMemo(() => limitDiffLines(parsed), [parsed])
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px] leading-[18px] text-foreground">
      <div className="w-max min-w-full">
        <div className="px-3 py-1 font-semibold">{diff.path}</div>
        {limited.rows.map((line: DiffLine, index: number): ReactElement => (
          <DiffRow key={index} line={line} />
        ))}
        {parsed.length === 0 ? <Notice text={EMPTY_MESSAGE} /> : null}
        {limited.limited ? <Notice text={LIMIT_MESSAGE} /> : null}
        {diff.truncated ? <Notice text={TRUNCATED_MESSAGE} /> : null}
      </div>
    </div>
  )
}

/** Read-only unified diff of one file. Long lines scroll sideways inside the view. */
export function DiffView({ diff, loading, error }: DiffViewProps): ReactElement {
  if (error !== null) {
    return (
      <p role="alert" className="px-3 py-3 text-xs text-destructive">
        {error}
      </p>
    )
  }
  if (diff === null) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">{loading ? LOADING_MESSAGE : ''}</p>
  }
  if (diff.binary) {
    return <Notice text={BINARY_MESSAGE} />
  }
  return <DiffText diff={diff} />
}
