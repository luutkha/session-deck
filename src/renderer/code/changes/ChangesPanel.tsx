import { useEffect, useRef, useState, type ReactElement } from 'react'
import { subscribeChangesFileRequest, takeChangesFileRequest } from './changesRequest'
import { ArrowLeft, LoaderCircle, MessageSquare, RefreshCw, SendHorizontal, X } from 'lucide-react'
import type { AgentKind, ChangedFile, Id, WorktreeChanges } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import { ChangeRow } from './ChangeRow'
import { DiffView } from './DiffView'
import { countsLabel } from './changesFormat'
import { isStillChanged } from './changesState'
import {
  addAnnotation,
  formatAnnotationMessage,
  readStoredAnnotations,
  removeAnnotation,
  storeAnnotations,
  type DiffAnnotation
} from './annotations'
import { useWorktreeChanges, type WorktreeChangesResult } from './useWorktreeChanges'
import { useWorktreeFileDiff } from './useWorktreeFileDiff'
import { useWorktreeFilePreview } from './useWorktreeFilePreview'
import { PreviewView } from './PreviewView'
import { GitSection } from './GitSection'
import { useGitActions } from './useGitActions'
import { isPreviewable } from './preview'

export interface ChangesPanelProps {
  readonly worktreeId: Id
  /**
   * The session whose side panel is open: comments are SENT into it. Absent (no target known) = annotation
   * UI off. Code mode only (NotesPanel renders ChangesPanel for worktree sessions only).
   */
  readonly target?: ChangesTarget
  readonly className?: string
}

export interface ChangesTarget {
  readonly sessionId: Id
  readonly agent: AgentKind
  /** True when the session's process is running and not sleeping: the comments can be typed right away. */
  readonly active: boolean
}

interface Selection {
  readonly worktreeId: Id
  readonly path: string
}

const TOOLTIP_DELAY_MS = 300
const HEADER_TITLE_IDLE = 'Changes'
const HEADER_TITLE_LOADING = 'Loading changes...'
const REFRESH_LABEL = 'Refresh changes'
const BACK_LABEL = 'All files'
const NO_CHANGES_YET = 'No changes yet.'
const SEND_LABEL = 'Send comments to the agent'
const SHELL_NOTICE = 'Comments only work for Claude and OpenCode sessions.'
const INACTIVE_NOTICE = 'Wake the session first.'
const STALE_NOTICE = 'Files changed since a comment was written — line numbers may have moved.'

function PanelMessage({ text, failed }: { readonly text: string; readonly failed: boolean }): ReactElement {
  return (
    <p
      role={failed ? 'alert' : undefined}
      className={cn('px-3 py-3 text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}
    >
      {text}
    </p>
  )
}

function RefreshButton({ loading, onRefresh }: { readonly loading: boolean; readonly onRefresh: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={REFRESH_LABEL} onClick={onRefresh}>
          {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {REFRESH_LABEL}
      </TooltipContent>
    </Tooltip>
  )
}

function sendDisabledReason(target: ChangesTarget | undefined, count: number): string | null {
  if (count === 0) return 'No comments yet.'
  if (target === undefined) return null
  if (target.agent === 'shell') return SHELL_NOTICE
  if (!target.active) return INACTIVE_NOTICE
  return null
}

interface PanelHeaderProps {
  readonly title: string
  readonly selectedPath: string | null
  readonly loading: boolean
  readonly commentCount: number
  /** Previewable file selected: the header shows the Diff | Preview segmented toggle (rich previews). */
  readonly previewable: boolean
  readonly viewMode: 'diff' | 'preview'
  readonly onViewMode: (mode: 'diff' | 'preview') => void
  readonly onBack: () => void
  readonly onRefresh: () => void
}

const DIFF_TOGGLE_LABEL = 'Show the diff'
const PREVIEW_TOGGLE_LABEL = 'Show the rendered preview'

/** The segmented Diff | Preview toggle of a previewable file (default Diff, like the Orca look). */
function ViewModeToggle({
  viewMode,
  onViewMode
}: Pick<PanelHeaderProps, 'viewMode' | 'onViewMode'>): ReactElement {
  return (
    <div
      role="group"
      aria-label="Diff or preview"
      className="flex shrink-0 items-center rounded-md border border-border p-0.5"
    >
      {([['diff', DIFF_TOGGLE_LABEL, 'Diff'], ['preview', PREVIEW_TOGGLE_LABEL, 'Preview']] as const).map(
        ([mode, label, text]) => (
          <Button
            key={mode}
            type="button"
            variant={viewMode === mode ? 'secondary' : 'ghost'}
            size="xs"
            aria-pressed={viewMode === mode}
            aria-label={label}
            data-preview-mode={mode}
            className="text-[11px]"
            onClick={(): void => onViewMode(mode)}
          >
            {text}
          </Button>
        )
      )}
    </div>
  )
}

function PanelHeader({
  title,
  selectedPath,
  loading,
  commentCount,
  previewable,
  viewMode,
  onViewMode,
  onBack,
  onRefresh
}: PanelHeaderProps): ReactElement {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      {selectedPath === null ? (
        <span className="flex min-w-0 items-center gap-1.5 truncate px-1 text-xs text-muted-foreground">
          {title}
          {commentCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-400/15 px-1 text-[10px] font-medium text-amber-500">
              <MessageSquare className="size-3" aria-hidden="true" />
              {String(commentCount)}
            </span>
          ) : null}
        </span>
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {BACK_LABEL}
          </Button>
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{selectedPath}</span>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {selectedPath !== null && previewable ? <ViewModeToggle viewMode={viewMode} onViewMode={onViewMode} /> : null}
        <RefreshButton loading={loading} onRefresh={onRefresh} />
      </div>
    </div>
  )
}

/** D60: the commit ticks of the file list. */
interface Ticks {
  readonly unticked: ReadonlySet<string>
  readonly toggle: (path: string) => void
}

interface ChangesBodyProps {
  readonly list: WorktreeChangesResult
  readonly onSelect: (path: string) => void
  readonly ticks: Ticks
}

function fileRows(
  changes: WorktreeChanges,
  onSelect: (path: string) => void,
  ticks: Ticks
): ReactElement {
  const anyUncommitted = changes.files.some((file): boolean => file.uncommitted === true)
  return (
    <ul role="listbox" aria-label="Changed files" className="flex flex-col gap-0.5 p-1">
      {changes.files.map((file: ChangedFile): ReactElement => (
        <ChangeRow
          key={file.path}
          file={file}
          selected={false}
          onSelect={onSelect}
          {...(anyUncommitted ? { ticked: !ticks.unticked.has(file.path), onToggleTick: ticks.toggle } : {})}
        />
      ))}
    </ul>
  )
}

function headerTitle(list: WorktreeChangesResult): string {
  if (list.changes !== null) return countsLabel(list.changes)
  return list.loading ? HEADER_TITLE_LOADING : HEADER_TITLE_IDLE
}

/** The file list, or the message that replaces it (IPC failure, git problem, no files). */
function ChangesBody({ list, onSelect, ticks }: ChangesBodyProps): ReactElement {
  const { changes } = list
  if (changes === null) {
    return list.error !== null ? (
      <PanelMessage text={list.error} failed />
    ) : (
      <PanelMessage text={HEADER_TITLE_LOADING} failed={false} />
    )
  }
  if (changes.error !== undefined) {
    return <PanelMessage text={changes.error} failed />
  }
  if (changes.files.length === 0) {
    return <PanelMessage text={NO_CHANGES_YET} failed={false} />
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      {list.error !== null ? <PanelMessage text={list.error} failed /> : null}
      {fileRows(changes, onSelect, ticks)}
    </ScrollArea>
  )
}

interface CommentsStripProps {
  readonly annotations: readonly DiffAnnotation[]
  readonly target: ChangesTarget | undefined
  readonly stale: boolean
  readonly onRemove: (id: string) => void
  readonly onSend: () => void
}

function CommentsStrip({ annotations, target, stale, onRemove, onSend }: CommentsStripProps): ReactElement {
  const reason = sendDisabledReason(target, annotations.length)
  return (
    <div data-testid="comments-strip" className="shrink-0 border-t border-border px-3 py-2">
      {stale ? <p className="pb-1 text-[11px] text-muted-foreground">{STALE_NOTICE}</p> : null}
      <div className="flex items-center gap-1.5">
        <MessageSquare className="size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
        <span className="text-xs font-medium">
          Comments ({String(annotations.length)})
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {annotations.map((a) => (
            <span
              key={a.id}
              data-comment-id={a.id}
              className="inline-flex max-w-full items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-foreground/80"
            >
              <span className="min-w-0 truncate">{`${a.path}:${a.line === null ? '?' : String(a.line)}`}</span>
              <button
                type="button"
                aria-label="Remove comment"
                className="text-muted-foreground hover:text-foreground"
                onClick={(): void => onRemove(a.id)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              aria-label={SEND_LABEL}
              disabled={reason !== null}
              onClick={onSend}
            >
              <SendHorizontal aria-hidden="true" />
              Send
            </Button>
          </TooltipTrigger>
          {reason !== null ? <TooltipContent side="top" sideOffset={4}>{reason}</TooltipContent> : null}
        </Tooltip>
      </div>
    </div>
  )
}

/** Changed files of one worktree; a click opens that file's read-only diff in place of the list.
 *  With a target session, diff lines can carry comments that are sent to the session as one prompt. */
export function ChangesPanel({ worktreeId, target, className }: ChangesPanelProps): ReactElement {
  const list = useWorktreeChanges(worktreeId)
  const git = useGitActions(worktreeId, list.changes, list.refresh)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [annotations, setAnnotations] = useState<readonly DiffAnnotation[]>((): readonly DiffAnnotation[] =>
    readStoredAnnotations(worktreeId)
  )
  // Rich previews: the render toggle exists only for previewable files; review (Diff) stays the default.
  const [viewMode, setViewMode] = useState<'diff' | 'preview'>('diff')
  const storedPath = selection !== null && selection.worktreeId === worktreeId ? selection.path : null
  const selectedPath = isStillChanged(list.changes, storedPath) ? storedPath : null
  const diff = useWorktreeFileDiff(worktreeId, selectedPath, list.changes?.computedAt ?? null)
  const previewable = selectedPath !== null && isPreviewable(selectedPath)
  const preview = useWorktreeFilePreview(worktreeId, previewable ? selectedPath : null, viewMode === 'preview', list.changes?.computedAt ?? null)
  const stale =
    annotations.length > 0 &&
    list.changes !== null &&
    annotations.some((a) => list.changes !== null && list.changes.computedAt > a.createdAt)

  useEffect((): void => {
    if (storedPath !== null && list.changes !== null && !isStillChanged(list.changes, storedPath)) {
      setSelection(null)
    }
  }, [storedPath, list.changes])

  // The preview choice is per file: a different file reviews as a diff first again (unless Jarvis asked for the
  // preview of the file it opened, D58).
  const nextViewMode = useRef<'diff' | 'preview'>('diff')
  useEffect((): void => {
    setViewMode(nextViewMode.current)
    nextViewMode.current = 'diff'
  }, [selectedPath])

  // D58: Jarvis opens a file of this worktree (or goes back to the list).
  useEffect((): (() => void) => {
    const apply = (): void => {
      const request = takeChangesFileRequest(worktreeId)
      if (request === null) return
      if (request.path === null) {
        setSelection(null)
        return
      }
      const preview = request.view === 'preview' && isPreviewable(request.path)
      if (request.path === storedPath) setViewMode(preview ? 'preview' : 'diff')
      else nextViewMode.current = preview ? 'preview' : 'diff'
      setSelection({ worktreeId, path: request.path })
    }
    apply()
    return subscribeChangesFileRequest(apply)
  }, [worktreeId, storedPath])

  function update(next: readonly DiffAnnotation[]): void {
    setAnnotations(next)
    storeAnnotations(worktreeId, next)
  }

  const commentCount = annotations.length
  const showStrip = commentCount > 0
  const annotateOn = target !== undefined

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <section aria-label="Changes" className={cn('flex min-h-0 flex-col', className)}>
        <PanelHeader
          title={headerTitle(list)}
          selectedPath={selectedPath}
          loading={list.loading}
          commentCount={commentCount}
          previewable={previewable}
          viewMode={viewMode}
          onViewMode={setViewMode}
          onBack={(): void => setSelection(null)}
          onRefresh={list.refresh}
        />
        {selectedPath === null ? (
          <>
            <GitSection
              git={git}
              changes={list.changes}
              {...(target !== undefined ? { onOpenUrl: (url: string): void => { void window.api.openLink(target.sessionId, url, false) } } : {})}
            />
            <ChangesBody
              list={list}
              onSelect={(path: string): void => setSelection({ worktreeId, path })}
              ticks={{ unticked: git.unticked, toggle: git.toggleFile }}
            />
          </>
        ) : viewMode === 'preview' && previewable ? (
          <PreviewView
            preview={preview.preview}
            loading={preview.loading}
            error={preview.error}
            sessionId={target?.sessionId ?? ''}
          />
        ) : (
          <DiffView
            diff={diff.diff}
            loading={diff.loading}
            error={diff.error}
            annotations={annotateOn ? annotations : []}
            onAddComment={annotateOn
              ? (input): void => {
                  if (selectedPath === null) return
                  update(addAnnotation(annotations, { id: crypto.randomUUID(), path: selectedPath, ...input }, Date.now()))
                }
              : undefined}
          />
        )}
        {showStrip ? (
          <CommentsStrip
            annotations={annotations}
            target={target}
            stale={stale}
            onRemove={(id: string): void => update(removeAnnotation(annotations, id))}
            onSend={(): void => {
              const message = formatAnnotationMessage(annotations)
              if (message === null || target === undefined || sendDisabledReason(target, annotations.length) !== null) return
              window.api.ptyWrite(target.sessionId, message + '\r')
              update([])
            }}
          />
        ) : null}
      </section>
    </TooltipProvider>
  )
}
