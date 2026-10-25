import { useState, useMemo, Fragment, type ReactElement } from 'react'
import { MessageSquarePlus, X } from 'lucide-react'
import { DIFF_MAX_BYTES, type FileDiff } from '../../../shared/types'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { diffLineClass, diffLineMarker, limitDiffLines, MAX_RENDERED_DIFF_LINES } from './changesFormat'
import { annotationForLine, annotationText, type DiffAnnotation } from './annotations'
import { parseUnifiedDiff, type DiffLine } from './parseUnifiedDiff'

export interface DiffViewProps {
  readonly diff: FileDiff | null
  readonly loading: boolean
  readonly error: string | null
  /** Draft comments of this worktree; an annotated line gets the amber dot. Absent/empty = no markers. */
  readonly annotations?: readonly DiffAnnotation[]
  /** Provided = line annotation is on (Code mode only): the hover "+" opens the inline editor. */
  readonly onAddComment?: (input: { readonly side: 'new' | 'old'; readonly line: number | null; readonly text: string }) => void
}

const BINARY_MESSAGE = 'Binary file, no text diff.'
const EMPTY_MESSAGE = 'No text changes.'
const LOADING_MESSAGE = 'Loading diff...'
const BYTES_PER_KB = 1024
const TRUNCATED_MESSAGE = `Diff cut at ${String(DIFF_MAX_BYTES / BYTES_PER_KB)} KB.`
const LIMIT_MESSAGE = `Showing the first ${String(MAX_RENDERED_DIFF_LINES)} lines.`
const ADD_LABEL = 'Comment on this line'

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
  onOpenEditor
}: {
  readonly line: DiffLine
  readonly annotation: DiffAnnotation | null
  readonly canAnnotate: boolean
  readonly onOpenEditor: () => void
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
  onAddComment
}: {
  readonly diff: FileDiff
  readonly annotations: readonly DiffAnnotation[]
  readonly onAddComment?: DiffViewProps['onAddComment']
}): ReactElement {
  const parsed = useMemo((): readonly DiffLine[] => parseUnifiedDiff(diff.diff).filter(isBodyLine), [diff.diff])
  const limited = useMemo(() => limitDiffLines(parsed), [parsed])
  const [editor, setEditor] = useState<EditorState | null>(null)

  function add(): void {
    if (editor === null || onAddComment === undefined) return
    const side = editor.line.kind === 'del' ? 'old' : 'new'
    onAddComment({ side, line: side === 'old' ? editor.line.oldNo : editor.line.newNo, text: editor.draft })
    setEditor(null)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px] leading-[18px] text-foreground">
      <div className="w-max min-w-full">
        <div className="px-3 py-1 font-semibold">{diff.path}</div>
        {limited.rows.map((line: DiffLine, index: number): ReactElement => (
          <Fragment key={index}>
            <DiffRow
              line={line}
              annotation={annotationForLine(annotations, diff.path, line)}
              canAnnotate={onAddComment !== undefined && annotationEnabled(line)}
              onOpenEditor={(): void => setEditor({ line, draft: '' })}
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
        ))}
        {parsed.length === 0 ? <Notice text={EMPTY_MESSAGE} /> : null}
        {limited.limited ? <Notice text={LIMIT_MESSAGE} /> : null}
        {diff.truncated ? <Notice text={TRUNCATED_MESSAGE} /> : null}
      </div>
    </div>
  )
}

/** Read-only unified diff of one file, with per-line comments when annotation is on (Code mode). Long lines scroll sideways inside the view. */
export function DiffView({ diff, loading, error, annotations = [], onAddComment }: DiffViewProps): ReactElement {
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
  return <DiffText diff={diff} annotations={annotations} onAddComment={onAddComment} />
}
