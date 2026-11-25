import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  subscribeChangesFileRequest,
  subscribeChangesLayoutRequest,
  subscribeChangesStepRequest,
  takeChangesFileRequest,
  takeChangesLayoutRequest,
  takeChangesStepRequest
} from './changesRequest'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  ListTree,
  LoaderCircle,
  MessageSquare,
  PictureInPicture2,
  RefreshCw,
  SendHorizontal,
  X
} from 'lucide-react'
import type { AgentKind, ChangedFile, Id } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import { requestFileView } from '../../viewer/previewBus'
import { absoluteChangedPath, canOpenInViewer } from './absolutePath'
import { ChangeRow } from './ChangeRow'
import { DiffView } from './DiffView'
import { countsLabel } from './changesFormat'
import { splitEmptyText, splitSelection } from './changesWindowLogic'
import { isStillChanged } from './changesState'
import {
  addAnnotation,
  formatAnnotationMessage,
  readStoredAnnotations,
  removeAnnotation,
  storeAnnotations,
  type DiffAnnotation
} from './annotations'
import { changesContentKey, useWorktreeChanges, type WorktreeChangesResult } from './useWorktreeChanges'
import { useWorktreeFileDiff } from './useWorktreeFileDiff'
import { useWorktreeFilePreview } from './useWorktreeFilePreview'
import { PreviewView } from './PreviewView'
import { GitSection } from './GitSection'
import { useGitActions } from './useGitActions'
import { isPreviewable } from './preview'
import { DiscardConfirm, type DiscardRequest } from './DiscardConfirm'
import {
  isViewed,
  markViewed,
  pruneViewed,
  readViewed,
  subscribeViewed,
  unmarkViewed,
  writeViewed,
  type ViewedMap
} from './viewedMarks'
import { buildTree, flattenVisible, stepFile, toggleCollapsed, visibleFilePaths, type TreeRow } from './changesTree'

export interface ChangesPanelProps {
  readonly worktreeId: Id
  /**
   * The session whose side panel is open: comments are SENT into it. Absent (no target known) = annotation
   * UI off. Code mode only (NotesPanel renders ChangesPanel for worktree sessions only).
   */
  readonly target?: ChangesTarget
  readonly className?: string
  /** D74: the session the side-panel viewer shows the file for; with `viewerRoot`, rows offer "Open in viewer". */
  readonly viewerSessionId?: Id
  /** D74: the absolute worktree folder the changed paths are relative to (a worktree session's cwd). */
  readonly viewerRoot?: string
  /** D83: renders the detach button in the header; absent = no button (the detached window passes nothing). */
  readonly onDetach?: () => void
  /** D83: 'stack' (default, the side panel) shows the list OR the diff; 'split' (detached window) shows both. */
  readonly layout?: ChangesLayout
}

export type ChangesLayout = 'stack' | 'split'

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
const DETACH_LABEL = 'Open changes in a separate window'
const DETACH_TITLE = 'Open in separate window'
const BACK_LABEL = 'All files'
const PREV_FILE_LABEL = 'Previous file (Alt+Up)'
const NEXT_FILE_LABEL = 'Next file (Alt+Down)'
const SIDE_BY_SIDE_LABEL = 'Show the diff side by side'
const INLINE_LABEL = 'Show the diff inline'
const TREE_LABEL = 'Group the files by folder'
const FLAT_LABEL = 'Show a flat file list'
const TREE_PREF_KEY = 'sessiondeck.changes.tree'

function readTreePref(): boolean {
  try {
    return localStorage.getItem(TREE_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writeTreePref(on: boolean): void {
  try {
    localStorage.setItem(TREE_PREF_KEY, on ? '1' : '0')
  } catch {
    // Storage can be blocked; the choice then lasts for this window only.
  }
}
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

/** D83: opens (or focuses) this worktree's detached Changes window. Only rendered when the caller can detach. */
function DetachButton({ onDetach }: { readonly onDetach: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={DETACH_LABEL}
          data-changes-detach=""
          onClick={onDetach}
        >
          <PictureInPicture2 aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {DETACH_TITLE}
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
  readonly layout: ChangesLayout
  readonly loading: boolean
  readonly commentCount: number
  /** Previewable file selected: the header shows the Diff | Preview segmented toggle (rich previews). */
  readonly previewable: boolean
  readonly viewMode: 'diff' | 'preview'
  readonly onViewMode: (mode: 'diff' | 'preview') => void
  readonly onBack: () => void
  readonly onRefresh: () => void
  readonly onDetach?: (() => void) | undefined
  /** Prev/next file buttons (shown while a file is selected); absent = none. */
  readonly onStep?: ((delta: 1 | -1) => void) | undefined
  /** Flat list <-> folder tree. */
  readonly treeView: boolean
  readonly onTreeView: (on: boolean) => void
  /** Side-by-side diff toggle; only the wide (split) layout offers it. */
  readonly sideBySide?: { readonly on: boolean; readonly set: (on: boolean) => void } | undefined
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

function HeaderIconButton({
  label,
  dataAttr,
  onClick,
  icon,
  pressed
}: {
  readonly label: string
  readonly dataAttr: string
  readonly onClick: () => void
  readonly icon: ReactElement
  readonly pressed?: boolean
}): ReactElement {
  const marker = { [dataAttr]: '' }
  return (
    <Button
      type="button"
      variant={pressed === true ? 'secondary' : 'ghost'}
      size="icon-xs"
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      {...marker}
      onClick={onClick}
    >
      {icon}
    </Button>
  )
}

function PanelHeader({
  title,
  selectedPath,
  layout,
  loading,
  commentCount,
  previewable,
  viewMode,
  onViewMode,
  onBack,
  onRefresh,
  onDetach,
  onStep,
  treeView,
  onTreeView,
  sideBySide
}: PanelHeaderProps): ReactElement {
  // The split layout shows list and diff together: there is no "back to the list" step, only the title.
  const showBack = layout === 'stack' && selectedPath !== null
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      {showBack ? (
        <div className="flex min-w-0 items-center gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {BACK_LABEL}
          </Button>
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{selectedPath}</span>
        </div>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 truncate px-1 text-xs text-muted-foreground">
          {title}
          {commentCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-400/15 px-1 text-[10px] font-medium text-amber-500">
              <MessageSquare className="size-3" aria-hidden="true" />
              {String(commentCount)}
            </span>
          ) : null}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {selectedPath !== null && previewable ? <ViewModeToggle viewMode={viewMode} onViewMode={onViewMode} /> : null}
        {selectedPath !== null && onStep !== undefined ? (
          <>
            <HeaderIconButton label={PREV_FILE_LABEL} dataAttr="data-changes-prev" onClick={(): void => onStep(-1)} icon={<ChevronUp aria-hidden="true" />} />
            <HeaderIconButton label={NEXT_FILE_LABEL} dataAttr="data-changes-next" onClick={(): void => onStep(1)} icon={<ChevronDown aria-hidden="true" />} />
          </>
        ) : null}
        {sideBySide !== undefined && selectedPath !== null ? (
          <HeaderIconButton
            label={sideBySide.on ? INLINE_LABEL : SIDE_BY_SIDE_LABEL}
            dataAttr="data-changes-sidebyside"
            pressed={sideBySide.on}
            onClick={(): void => sideBySide.set(!sideBySide.on)}
            icon={<Columns2 aria-hidden="true" />}
          />
        ) : null}
        {showBack ? null : (
          <HeaderIconButton
            label={treeView ? FLAT_LABEL : TREE_LABEL}
            dataAttr="data-changes-tree"
            pressed={treeView}
            onClick={(): void => onTreeView(!treeView)}
            icon={<ListTree aria-hidden="true" />}
          />
        )}
        {onDetach !== undefined ? <DetachButton onDetach={onDetach} /> : null}
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

interface FileRowsView {
  readonly rows: readonly TreeRow[]
  readonly anyUncommitted: boolean
}

interface ChangesBodyProps {
  readonly list: WorktreeChangesResult
  readonly filesView: FileRowsView
  readonly onSelect: (path: string) => void
  readonly ticks: Ticks
  /** D74: shows a changed file in the side-panel viewer; null = no viewer target known. */
  readonly openInViewer: ((path: string) => void) | null
  /** D83: the file highlighted in the split layout's list; null in the stacked layout (the diff replaces it). */
  readonly selectedPath: string | null
  /** Folder tree instead of the flat list; collapsed folders and their toggle. */
  readonly tree: { readonly on: boolean; readonly collapsed: ReadonlySet<string>; readonly toggle: (dir: string) => void }
  /** D86: viewed marks of the files + the toggle. */
  readonly viewed: { readonly map: ViewedMap; readonly toggle: (file: ChangedFile) => void }
  /** D86: asks to discard a file's uncommitted changes (rows of committed files get no button). */
  readonly onDiscard: (file: ChangedFile) => void
}

/** Flat (non-tree) rows in the order main sent the files: the order keyboard navigation follows. */
export function flatFileRows(files: readonly ChangedFile[]): readonly TreeRow[] {
  return files.map((file) => ({
    node: { kind: 'file' as const, path: file.path, name: file.path, file },
    depth: 0
  }))
}

function fileRows(
  filesView: FileRowsView,
  onSelect: (path: string) => void,
  ticks: Ticks,
  openInViewer: ((path: string) => void) | null,
  selectedPath: string | null,
  tree: ChangesBodyProps['tree'],
  viewed: ChangesBodyProps['viewed'],
  onDiscard: ChangesBodyProps['onDiscard']
): ReactElement {
  const { rows, anyUncommitted } = filesView
  return (
    <ul role="listbox" aria-label="Changed files" className="flex flex-col gap-0.5 p-1">
      {rows.map((row): ReactElement => {
        if (row.node.kind === 'dir') {
          const dir = row.node
          const open = !tree.collapsed.has(dir.path)
          return (
            <li key={'dir:' + dir.path} role="presentation">
              <button
                type="button"
                data-changes-dir={dir.path}
                aria-expanded={open}
                className="flex w-full items-center gap-1 rounded-md py-1 text-left text-xs text-muted-foreground hover:bg-accent/40"
                style={{ paddingLeft: String(4 + row.depth * 14) + 'px' }}
                onClick={(): void => tree.toggle(dir.path)}
              >
                {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 truncate font-medium">{dir.name}</span>
                <span className="shrink-0 tabular-nums">{String(dir.fileCount)}</span>
              </button>
            </li>
          )
        }
        const file = row.node.file
        return (
          <ChangeRow
            key={file.path}
            file={file}
            selected={file.path === selectedPath}
            onSelect={onSelect}
            {...(tree.on ? { depth: row.depth } : {})}
            viewed={isViewed(viewed.map, file)}
            onToggleViewed={viewed.toggle}
            {...(file.uncommitted === true ? { onDiscard } : {})}
            {...(anyUncommitted ? { ticked: !ticks.unticked.has(file.path), onToggleTick: ticks.toggle } : {})}
            {...(openInViewer !== null && canOpenInViewer(file) ? { onOpenViewer: openInViewer } : {})}
          />
        )
      })}
    </ul>
  )
}

function headerTitle(list: WorktreeChangesResult): string {
  if (list.changes !== null) return countsLabel(list.changes)
  return list.loading ? HEADER_TITLE_LOADING : HEADER_TITLE_IDLE
}

/** The file list, or the message that replaces it (IPC failure, git problem, no files). */
function ChangesBody({ list, filesView, onSelect, ticks, openInViewer, selectedPath, tree, viewed, onDiscard }: ChangesBodyProps): ReactElement {
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
      {fileRows(filesView, onSelect, ticks, openInViewer, selectedPath, tree, viewed, onDiscard)}
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
export function ChangesPanel({
  worktreeId,
  target,
  className,
  viewerSessionId,
  viewerRoot,
  onDetach,
  layout = 'stack'
}: ChangesPanelProps): ReactElement {
  const list = useWorktreeChanges(worktreeId)
  const git = useGitActions(worktreeId, list.changes, list.refresh)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [annotations, setAnnotations] = useState<readonly DiffAnnotation[]>((): readonly DiffAnnotation[] =>
    readStoredAnnotations(worktreeId)
  )
  // Rich previews: the render toggle exists only for previewable files; review (Diff) stays the default.
  const [viewMode, setViewMode] = useState<'diff' | 'preview'>('diff')
  const storedPath = selection !== null && selection.worktreeId === worktreeId ? selection.path : null
  const split = layout === 'split'
  const [treeView, setTreeView] = useState<boolean>(readTreePref)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set<string>())
  const [sideBySide, setSideBySide] = useState(false)
  // The tree and the flattened rows are shared by the list and by next/previous navigation. Build them only when
  // the file list, the tree toggle or a collapsed folder changes — not on every commit-message keystroke.
  const files = list.changes?.files
  const treeNodes = useMemo(() => (treeView && files !== undefined ? buildTree(files) : null), [files, treeView])
  const filesView = useMemo<FileRowsView>(() => ({
    rows: treeNodes !== null ? flattenVisible(treeNodes, collapsed) : flatFileRows(files ?? []),
    anyUncommitted: (files ?? []).some((file): boolean => file.uncommitted === true)
  }), [files, treeNodes, collapsed])
  // D86: "viewed" marks (per worktree, kept in localStorage; a mark vanishes when the file changes again).
  const [viewed, setViewed] = useState<ViewedMap>((): ViewedMap => readViewed(worktreeId))
  useEffect((): (() => void) => {
    setViewed(readViewed(worktreeId))
    return subscribeViewed((changedId: string): void => {
      if (changedId === worktreeId) setViewed(readViewed(worktreeId))
    })
  }, [worktreeId])
  useEffect((): void => {
    if (list.changes === null || list.changes.error !== undefined) return
    const kept = pruneViewed(viewed, list.changes.files)
    if (Object.keys(kept).length !== Object.keys(viewed).length) writeViewed(worktreeId, kept)
  }, [list.changes, viewed, worktreeId])
  const toggleViewed = useCallback((file: ChangedFile): void => {
    writeViewed(worktreeId, isViewed(viewed, file) ? unmarkViewed(viewed, file.path) : markViewed(viewed, file))
  }, [viewed, worktreeId])
  // D86: discard (asks first; main re-checks everything and answers with a readable error).
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest | null>(null)
  const [discardBusy, setDiscardBusy] = useState(false)
  const [discardError, setDiscardError] = useState<string | null>(null)
  const askDiscardFile = useCallback((file: ChangedFile): void => {
    setDiscardError(null)
    setDiscardRequest({ kind: 'file', path: file.path, untracked: file.kind === 'untracked' })
  }, [])
  async function confirmDiscard(): Promise<void> {
    if (discardRequest === null) return
    setDiscardBusy(true)
    try {
      const result =
        discardRequest.kind === 'file'
          ? await window.api.discardWorktreeFile(worktreeId, discardRequest.path)
          : await window.api.discardWorktreeHunk(worktreeId, discardRequest.path, discardRequest.index, discardRequest.header)
      if (result.ok) {
        setDiscardRequest(null)
        list.refresh()
      } else {
        setDiscardError(result.error ?? 'Could not discard these changes.')
      }
    } catch (error) {
      setDiscardError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '') : 'Could not discard these changes.')
    } finally {
      setDiscardBusy(false)
    }
  }
  // The split layout always shows a diff: the selected file while it is changed, otherwise the first one.
  const selectedPath = split
    ? splitSelection(list.changes, storedPath)
    : isStillChanged(list.changes, storedPath)
      ? storedPath
      : null
  const contentKey = useMemo((): string => changesContentKey(list.changes), [list.changes])
  const [diffRefresh, setDiffRefresh] = useState(0)
  const refresh = useCallback((): void => {
    list.refresh()
    // A same-size edit leaves the content key unchanged: force the open file's diff to be re-read as well.
    setDiffRefresh((count: number): number => count + 1)
  }, [list.refresh])
  const diff = useWorktreeFileDiff(worktreeId, selectedPath, contentKey, diffRefresh)
  const previewable = selectedPath !== null && isPreviewable(selectedPath)
  const selectedFile = selectedPath === null ? undefined : list.changes?.files.find((file) => file.path === selectedPath)
  const preview = useWorktreeFilePreview(worktreeId, previewable ? selectedPath : null, viewMode === 'preview', contentKey)
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

  // Next/previous file follows the order the list is drawn in (tree order hides collapsed folders).
  const orderedPaths = useMemo(
    () => (treeNodes !== null ? visibleFilePaths(treeNodes, collapsed) : (files ?? []).map((file) => file.path)),
    [treeNodes, collapsed, files]
  )
  function step(delta: 1 | -1): void {
    const next = stepFile(orderedPaths, selectedPath, delta)
    if (next !== null) setSelection({ worktreeId, path: next })
  }
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect((): (() => void) => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      event.preventDefault()
      stepRef.current(event.key === 'ArrowDown' ? 1 : -1)
    }
    document.addEventListener('keydown', onKey)
    return (): void => document.removeEventListener('keydown', onKey)
  }, [])

  // Jarvis: step to the next/previous file, or switch the tree / side-by-side layout (side-by-side exists in the wide window only).
  useEffect((): (() => void) => {
    const apply = (): void => {
      const delta = takeChangesStepRequest(worktreeId)
      if (delta !== null) stepRef.current(delta)
    }
    apply()
    return subscribeChangesStepRequest(apply)
  }, [worktreeId])
  useEffect((): (() => void) => {
    const apply = (): void => {
      const layoutRequest = takeChangesLayoutRequest(worktreeId)
      if (layoutRequest === null) return
      if (layoutRequest.tree !== undefined) {
        setTreeView(layoutRequest.tree)
        writeTreePref(layoutRequest.tree)
      }
      if (layoutRequest.sideBySide !== undefined && split) setSideBySide(layoutRequest.sideBySide)
    }
    apply()
    return subscribeChangesLayoutRequest(apply)
  }, [worktreeId, split])

  function update(next: readonly DiffAnnotation[]): void {
    setAnnotations(next)
    storeAnnotations(worktreeId, next)
  }

  const commentCount = annotations.length
  const annotateOn = target !== undefined
  // D83: without a target (the detached window) the annotation UI stays off, drafts included.
  const showStrip = commentCount > 0 && annotateOn
  // D74: rows open a file in the side-panel viewer when both the session and the worktree folder are known.
  const openInViewer = useMemo<((path: string) => void) | null>(() => (
    viewerSessionId !== undefined && viewerRoot !== undefined && viewerRoot.trim() !== ''
      ? (path: string): void => {
          requestFileView({ sessionId: viewerSessionId, text: absoluteChangedPath(viewerRoot, path) })
        }
      : null
  ), [viewerSessionId, viewerRoot])

  const gitSection = (
    <GitSection
      git={git}
      changes={list.changes}
      {...(target !== undefined ? { onOpenUrl: (url: string): void => { void window.api.openLink(target.sessionId, url, false) } } : {})}
    />
  )
  // Stable row callbacks: memo(ChangeRow) only helps when the props it compares do not change on every render.
  const selectFile = useCallback((path: string): void => setSelection({ worktreeId, path }), [worktreeId])
  const changedFiles = (
    <ChangesBody
      list={list}
      filesView={filesView}
      onSelect={selectFile}
      ticks={{ unticked: git.unticked, toggle: git.toggleFile }}
      openInViewer={openInViewer}
      selectedPath={split ? selectedPath : null}
      viewed={{ map: viewed, toggle: toggleViewed }}
      onDiscard={askDiscardFile}
      tree={{ on: treeView, collapsed, toggle: (dir: string): void => setCollapsed((current) => toggleCollapsed(current, dir)) }}
    />
  )
  const fileView = selectedPath === null ? null : viewMode === 'preview' && previewable ? (
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
      layout={split && sideBySide ? 'split' : 'inline'}
      {...(selectedFile !== undefined && selectedFile.kind !== 'untracked' && !(split && sideBySide)
        ? {
            onDiscardHunk: (index: number, header: string): void => {
              setDiscardError(null)
              setDiscardRequest({ kind: 'hunk', path: selectedFile.path, index, header })
            }
          }
        : {})}
      annotations={annotateOn ? annotations : []}
      onAddComment={annotateOn
        ? (input): void => {
            if (selectedPath === null) return
            update(addAnnotation(annotations, { id: crypto.randomUUID(), path: selectedPath, ...input }, Date.now()))
          }
        : undefined}
    />
  )
  const splitHint = split && selectedPath === null ? splitEmptyText(list.changes) : null
  const viewedCount = list.changes === null ? 0 : list.changes.files.filter((file) => isViewed(viewed, file)).length

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <section aria-label="Changes" className={cn('flex min-h-0 flex-col', className)}>
        <PanelHeader
          title={viewedCount > 0 ? `${headerTitle(list)} · ${String(viewedCount)} viewed` : headerTitle(list)}
          selectedPath={selectedPath}
          layout={layout}
          loading={list.loading}
          commentCount={commentCount}
          previewable={previewable}
          viewMode={viewMode}
          onViewMode={setViewMode}
          onBack={(): void => setSelection(null)}
          onRefresh={refresh}
          onStep={step}
          treeView={treeView}
          onTreeView={(on: boolean): void => {
            setTreeView(on)
            writeTreePref(on)
          }}
          {...(split ? { sideBySide: { on: sideBySide, set: setSideBySide } } : {})}
          {...(onDetach !== undefined ? { onDetach } : {})}
        />
        {split ? (
          <div className="flex min-h-0 flex-1">
            <div data-changes-list="" className="flex w-[300px] shrink-0 flex-col border-r border-border">
              {gitSection}
              {changedFiles}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {fileView ?? (splitHint !== null ? <PanelMessage text={splitHint} failed={false} /> : null)}
            </div>
          </div>
        ) : selectedPath === null ? (
          <>
            {gitSection}
            {changedFiles}
          </>
        ) : (
          fileView
        )}
        <DiscardConfirm
          request={discardRequest}
          busy={discardBusy}
          error={discardError}
          onConfirm={(): void => {
            void confirmDiscard()
          }}
          onCancel={(): void => setDiscardRequest(null)}
        />
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
