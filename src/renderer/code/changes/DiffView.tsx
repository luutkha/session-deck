import { useState, useMemo, Fragment, type ReactElement } from 'react'
import { MessageSquarePlus, Undo2, X } from 'lucide-react'
import { DIFF_MAX_BYTES, type FileDiff } from '../../../shared/types'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { diffLineClass, diffLineMarker, limitDiffLines, MAX_RENDERED_DIFF_LINES } from './changesFormat'
import { annotationForLine, annotationText, type DiffAnnotation } from './annotations'
import { parseUnifiedDiff, type DiffLine } from './parseUnifiedDiff'
import { pairLines, type SplitRow } from './sideBySide'

export interface DiffViewProps {
  readonly diff: FileDiff | null
  readonly loading: boolean
  readonly error: string | null
  /** Draft comments of this worktree; an annotated line gets the amber dot. Absent/empty = no markers. */
  readonly annotations?: readonly DiffAnnotation[]
  /** Provided = line annotation is on (Code mode only): the hover "+" opens the inline editor. */
  readonly onAddComment?: (input: { readonly side: 'new' | 'old'; readonly line: number | null; readonly text: string }) => void
  /** 'split' shows old and new text in two columns; annotation stays inline-only. */
  readonly layout?: 'inline' | 'split'
  /** D86: provided = every hunk header offers "Discard block" (index among the file's hunks + the @@ header text). */
  readonly onDiscardHunk?: (index: number, header: string) => void
}

const BINARY_MESSAGE = 'Binary file, no text diff.'
const EMPTY_MESSAGE = 'No text changes.'
const LOADING_MESSAGE = 'Loading diff...'
const BYTES_PER_KB = 1024
const TRUNCATED_MESSAGE = `Diff cut at ${String(DIFF_MAX_BYTES / BYTES_PER_KB)} KB.`
const LIMIT_MESSAGE = `Showing the first ${String(MAX_RENDERED_DIFF_LINES)} lines.`
const ADD_LABEL = 'Comment on this line'
const DISCARD_HUNK_LABEL = 'Discard this block of changes'

function Notice({ text }: { readonly text: string }): ReactElement {
  return <p className="px-3 py-2 font-sans text-xs text-muted-foreground">{text}</p>
}

interface EditorState {
  readonly line: DiffLine
  readonly draft: string
}

function CommentEditor({
  draft,
  busy,
  onDraft,
  onAdd,
  onCancel
}: {
  readonly draft: string
  readonly busy: boolean
  readonly onDraft: (text: string) => void
  readonly onAdd: () => void
  readonly onCancel: () => void
}): ReactElement {
  return (
    <div className="mx-3 my-1 rounded-md border border-border bg-sidebar/60 p-2">
      <textarea
        aria-label="New comment"
        autoFocus
        rows={2}
        maxLength={5000}
        placeholder="Comment for the agent (what to change here)..."
        className="w-full resize-y rounded-sm bg-transparent px-1.5 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:outline-none"
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            if (annotationText(draft) !== null && !busy) onAdd()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          <X aria-hidden="true" />
          Cancel
        </Button>
        <Button type="button" size="xs" disabled={annotationText(draft) === null || busy} onClick={onAdd}>
          Add comment
        </Button>
      </div>
    </div>
  )
}

function DiffRow({
  line,
  annotation,
  canAnnotate,
  onOpenEditor,
  onDiscard
}: {
  readonly line: DiffLine
  readonly annotation: DiffAnnotation | null
  readonly canAnnotate: boolean
  readonly onOpenEditor: () => void
  /** D86: set on a hunk header row only. */
  readonly onDiscard?: () => void
}): ReactElement {
  const annotated = annotation !== null
  return (
    <div className={cn('group/dl relative flex', diffLineClass(line.kind))}>
      <span className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-muted-foreground/60">
        {line.oldNo ?? ''}
      </span>
      <span className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-muted-foreground/60">
        {line.newNo ?? ''}
      </span>
      <span className="w-4 shrink-0 select-none text-center">{diffLineMarker(line)}</span>
      {annotated ? (
        <span
          aria-label={`Commented: ${annotation?.text}`}
          title={`Commented: ${annotation?.text}`}
          className="absolute left-[7.1rem] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-amber-400"
        />
      ) : null}
      <span className="whitespace-pre pr-12">{line.text}</span>
      {onDiscard !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={DISCARD_HUNK_LABEL}
          title={DISCARD_HUNK_LABEL}
          data-discard-hunk=""
          className="absolute right-1 top-1/2 h-5 -translate-y-1/2 px-1.5 font-sans text-[11px] opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-focus-within/dl:opacity-100 group-hover/dl:opacity-100"
          onClick={onDiscard}
        >
          <Undo2 className="size-3" aria-hidden="true" />
          Discard block
        </Button>
      ) : null}
      {canAnnotate ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={ADD_LABEL}
          title={ADD_LABEL}
          className="absolute right-1 top-1/2 size-5 -translate-y-1/2 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-focus-within/dl:opacity-100 group-hover/dl:opacity-100"
          onClick={onOpenEditor}
        >
          <MessageSquarePlus className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

/** One column of a split row: line number, marker and text with the line's own style. */
function SplitCell({ line, side }: { readonly line: DiffLine | null; readonly side: 'old' | 'new' }): ReactElement {
  if (line === null) {
    return <div aria-hidden="true" className="min-h-[18px] bg-muted/20" />
  }
  const number = side === 'old' ? line.oldNo : line.newNo
  return (
    <div className={cn('flex', diffLineClass(line.kind))}>
      <span className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-muted-foreground/60">{number ?? ''}</span>
      <span className="w-4 shrink-0 select-none text-center">{diffLineMarker(line)}</span>
      <span className="whitespace-pre pr-3">{line.text}</span>
    </div>
  )
}

/** A split row is either two grid cells or one cell spanning both columns. */
function SplitRowView({ row }: { readonly row: SplitRow }): ReactElement {
  if (row.kind === 'full') {
    return <div className={cn('col-span-2 whitespace-pre px-3', diffLineClass(row.line.kind))}>{row.line.text}</div>
  }
  return (
    <>
      <SplitCell line={row.left} side="old" />
      <SplitCell line={row.right} side="new" />
    </>
  )
}

/** Text lines only: git's meta lines are replaced by the file path header. */
function isBodyLine(line: DiffLine): boolean {
  return line.kind !== 'meta'
}

function annotationEnabled(line: DiffLine): boolean {
  return line.kind === 'context' || line.kind === 'add' || line.kind === 'del'
}

function DiffText({
  diff,
  annotations,
  onAddComment,
  onDiscardHunk,
  layout
}: {
  readonly diff: FileDiff
  readonly annotations: readonly DiffAnnotation[]
  readonly onAddComment?: DiffViewProps['onAddComment']
  readonly onDiscardHunk?: DiffViewProps['onDiscardHunk']
  readonly layout: 'inline' | 'split'
}): ReactElement {
  const parsed = useMemo((): readonly DiffLine[] => parseUnifiedDiff(diff.diff).filter(isBodyLine), [diff.diff])
  const limited = useMemo(() => limitDiffLines(parsed), [parsed])
  const splitRows = useMemo((): readonly SplitRow[] => (layout === 'split' ? pairLines(limited.rows) : []), [layout, limited])
  const [editor, setEditor] = useState<EditorState | null>(null)
  // Hunk headers in file order: the index main needs to find the same hunk again.
  const hunkIndexes = useMemo((): ReadonlyMap<DiffLine, number> => {
    const indexes = new Map<DiffLine, number>()
    for (const line of parsed) if (line.kind === 'hunk') indexes.set(line, indexes.size)
    return indexes
  }, [parsed])

  function add(): void {
    if (editor === null || onAddComment === undefined) return
    const side = editor.line.kind === 'del' ? 'old' : 'new'
    onAddComment({ side, line: side === 'old' ? editor.line.oldNo : editor.line.newNo, text: editor.draft })
    setEditor(null)
  }

  return (
    <div
      data-diff-layout={layout}
      className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px] leading-[18px] text-foreground"
    >
      <div className="w-max min-w-full">
        <div className="px-3 py-1 font-semibold">{diff.path}</div>
        {layout === 'split' ? (
          // Split layout is annotation-free (no comment button, no dots): annotations are inline-only.
          <div className="grid grid-cols-2">
            {splitRows.map((row: SplitRow, index: number): ReactElement => (
              <SplitRowView key={index} row={row} />
            ))}
          </div>
        ) : (
          limited.rows.map((line: DiffLine, index: number): ReactElement => (
            <Fragment key={index}>
              <DiffRow
                line={line}
                annotation={annotationForLine(annotations, diff.path, line)}
                canAnnotate={onAddComment !== undefined && annotationEnabled(line)}
                onOpenEditor={(): void => setEditor({ line, draft: '' })}
                {...(onDiscardHunk !== undefined && line.kind === 'hunk' && hunkIndexes.has(line)
                  ? { onDiscard: (): void => onDiscardHunk(hunkIndexes.get(line) ?? 0, line.text) }
                  : {})}
              />
              {editor !== null && editor.line === line ? (
                <CommentEditor
                  draft={editor.draft}
                  busy={false}
                  onDraft={(text) => setEditor((current) => (current === null ? current : { ...current, draft: text }))}
                  onAdd={add}
                  onCancel={(): void => setEditor(null)}
                />
              ) : null}
            </Fragment>
          ))
        )}
        {parsed.length === 0 ? <Notice text={EMPTY_MESSAGE} /> : null}
        {limited.limited ? <Notice text={LIMIT_MESSAGE} /> : null}
        {diff.truncated ? <Notice text={TRUNCATED_MESSAGE} /> : null}
      </div>
    </div>
  )
}

/** Read-only unified diff of one file, with per-line comments when annotation is on (Code mode). Long lines scroll sideways inside the view. */
export function DiffView({
  diff,
  loading,
  error,
  annotations = [],
  onAddComment,
  onDiscardHunk,
  layout = 'inline'
}: DiffViewProps): ReactElement {
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
  return <DiffText diff={diff} annotations={annotations} onAddComment={onAddComment} onDiscardHunk={onDiscardHunk} layout={layout} />
}
