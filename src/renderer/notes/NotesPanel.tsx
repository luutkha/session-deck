import { Check, NotebookPen, Save, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'
import type { RuntimeState, Session } from '../../shared/types'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { ChangesPanel, type ChangesTarget } from '../code/changes'
import type { SessionActions } from '../state/useSessionStore'
import { ActivityList } from '../timeline/ActivityList'
import { QueuePanel } from '../queue/QueuePanel'
import {
  SIDE_PANEL_TAB_KEY,
  readSidePanelTab,
  resolveSidePanelTab,
  sidePanelTabsFor,
  storeSidePanelTab,
  type SidePanelTab
} from '../timeline/sidePanelTab'
import { SidePanelResizeHandle } from '../shell/SidePanelResizeHandle'
import { SIDE_PANEL_WIDTH_DEFAULT, visibleSidePanelWidth } from '../shell/sidePanelWidth'
import { cn } from '../lib/utils'
import { PreviewTab } from '../viewer/PreviewTab'
import type { PreviewRequest } from '../viewer/fileViewState'
import { requestFileView } from '../viewer/previewBus'
import { TagEditor } from '../tags/TagEditor'
import { ChecklistSection } from './ChecklistSection'
import { NotesSection } from './NotesSection'
import { useChecklistDraft } from './checklistDrafts'
import { parseSteps } from './parseSteps'
import { previewDropFor } from './previewDrop'
import { useSessionNotes } from './useSessionNotes'

export interface NotesPanelProps {
  readonly session: Session
  readonly actions: Pick<SessionActions, 'setSessionNotes' | 'setSessionChecklist' | 'setSessionQueue' | 'sendQueuedNow'>
  /** The session's runtime state: the Queue tab says whether the next prompt waits or goes out at once (D47). */
  readonly runtimeState?: RuntimeState
  readonly onClose: () => void
  /** Where the chosen tab is remembered (each mode has its own, D31). Default = the Ops key. */
  readonly storageKey?: string
  /** Where "Send comments" types the diff annotations (worktree sessions with a running agent; Code mode). */
  readonly changesTarget?: ChangesTarget
  /** D73: the file a terminal link asked for; null = no Preview tab is offered. */
  readonly previewRequest?: PreviewRequest | null
  /** D73: the Preview tab's X clears the request and goes back to Notes. */
  readonly onClosePreview?: () => void
  /** D73: the panel's width and its draggable left edge (the workspace owns the width hook). */
  readonly width?: number
  /** The widest the panel may be drawn right now (window minus sidebar minus the terminal's room); the workspace computes it. */
  readonly maxWidth?: number
  readonly resizing?: boolean
  readonly onResizeDrag?: (width: number) => void
  readonly onResizeCommit?: (width: number) => void
  readonly onResizeReset?: () => void
  readonly onResizingChange?: (dragging: boolean) => void
}

const TAB_LABELS: Readonly<Record<SidePanelTab, string>> = {
  notes: 'Notes',
  activity: 'Activity',
  queue: 'Queue',
  changes: 'Changes',
  preview: 'Preview'
}

/** D74: a dropped file that the viewer cannot show says so for a moment, then the panel is as before. */
const DROP_NOTICE_MS = 3000
const DROP_OVERLAY_LABEL = 'Drop to preview'
const UNSUPPORTED_DROP_NOTICE = 'This file type has no preview'

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes('Files')
}

export function NotesPanel(props: NotesPanelProps): ReactElement {
  const { session, actions, onClose, storageKey = SIDE_PANEL_TAB_KEY, changesTarget, runtimeState } = props
  const previewRequest = props.previewRequest ?? null
  // The stored width can be wider than the window allows: draw (and drag from) the width the panel really has.
  const width = visibleSidePanelWidth(props.width ?? SIDE_PANEL_WIDTH_DEFAULT, props.maxWidth ?? Number.POSITIVE_INFINITY)
  const { onResizeDrag, onResizeCommit, onResizeReset, onResizingChange } = props
  const notes = useSessionNotes(session, actions)
  const [draft, setDraft] = useChecklistDraft(session.id)
  const [storedTab, setStoredTab] = useState<SidePanelTab>((): SidePanelTab => readSidePanelTab(storageKey))
  const worktreeId = session.worktreeId
  const hasChanges = worktreeId !== undefined
  const hasPreview = previewRequest !== null
  const tab = resolveSidePanelTab(storedTab, hasChanges, hasPreview)
  const unsaved = notes.notes !== (session.notes ?? '') || parseSteps(draft).length > 0

  // D74: dropping a file on the panel previews it. The overlay follows the pointer's depth so moving over a child
  // does not blink it; the unsupported notice clears itself. The terminal's own drop (typing paths to the agent) lives
  // on the terminal element, not here, so the two never fight.
  const [dropActive, setDropActive] = useState(false)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const dragDepth = useRef(0)
  const noticeTimer = useRef<number | null>(null)

  useEffect((): (() => void) => (): void => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
  }, [])

  function showDropNotice(text: string): void {
    setDropNotice(text)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout((): void => {
      noticeTimer.current = null
      setDropNotice(null)
    }, DROP_NOTICE_MS)
  }

  function dragEnter(event: DragEvent<HTMLElement>): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setDropActive(true)
  }

  function dragOver(event: DragEvent<HTMLElement>): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function dragLeave(event: DragEvent<HTMLElement>): void {
    if (!hasFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  function drop(event: DragEvent<HTMLElement>): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDropActive(false)
    const file = event.dataTransfer.files[0]
    if (file === undefined) return
    const decision = previewDropFor(window.api.pathForFile(file))
    if (decision.kind === 'view') {
      requestFileView({ sessionId: session.id, text: decision.text })
    } else if (decision.kind === 'unsupported') {
      showDropNotice(UNSUPPORTED_DROP_NOTICE)
    }
  }

  function selectTab(next: SidePanelTab): void {
    setStoredTab(next)
    storeSidePanelTab(next, storageKey)
  }

  function save(): void {
    parseSteps(draft).forEach(notes.addItem)
    setDraft('')
    void notes.flush()
  }

  /** The preview's X: the workspace drops the request; without one, the tab buttons are the way back. */
  function closePreview(): void {
    if (props.onClosePreview !== undefined) {
      props.onClosePreview()
      return
    }
    selectTab('notes')
  }

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-l border-sidebar-border bg-card',
        !props.resizing && 'transition-[width] duration-200'
      )}
      // The terminal always keeps SIDE_PANEL_KEEP_FOR_MAIN px, so a small window never loses it to a wide panel.
      style={{ width }}
      onDragEnter={dragEnter}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      {dropActive ? (
        <div
          data-drop-overlay="preview"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary/60 bg-background/80 text-xs font-medium text-foreground"
        >
          {DROP_OVERLAY_LABEL}
        </div>
      ) : null}
      {onResizeDrag !== undefined && onResizeCommit !== undefined && onResizeReset !== undefined && onResizingChange !== undefined ? (
        <SidePanelResizeHandle
          width={width}
          // A drag or key step can never go past what fits on screen: the saved width is the one the user SAW.
          onDrag={(next: number): void => onResizeDrag(visibleSidePanelWidth(next, props.maxWidth ?? Number.POSITIVE_INFINITY))}
          onCommit={(next: number): void => onResizeCommit(visibleSidePanelWidth(next, props.maxWidth ?? Number.POSITIVE_INFINITY))}
          onReset={onResizeReset}
          onDraggingChange={onResizingChange}
        />
      ) : null}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border pl-3 pr-1.5">
        <NotebookPen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div role="tablist" aria-label="Side panel" className="flex shrink-0 items-center gap-0.5">
          {sidePanelTabsFor(hasChanges, hasPreview).map((option: SidePanelTab) => (
            <Button
              key={option}
              type="button"
              variant={tab === option ? 'secondary' : 'ghost'}
              size="xs"
              role="tab"
              aria-selected={tab === option}
              data-side-tab={option}
              className="text-xs"
              onClick={(): void => selectTab(option)}
            >
              {TAB_LABELS[option]}
              {option === 'queue' && (session.queue?.length ?? 0) > 0 ? (
                <span className="tabular-nums text-muted-foreground">{session.queue?.length}</span>
              ) : null}
            </Button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {session.name}
        </span>
        {tab === 'notes' ? (
          <Button
            type="button"
            variant={unsaved ? 'default' : 'ghost'}
            size="xs"
            aria-label="Save notes and checklist"
            title={unsaved ? 'Save now' : 'Everything is saved'}
            className="shrink-0 text-xs"
            onClick={save}
          >
            {unsaved ? <Save className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
            {unsaved ? 'Save' : 'Saved'}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close notes"
          className="shrink-0 text-muted-foreground"
          onClick={onClose}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </header>

      {dropNotice !== null ? (
        <p
          role="status"
          data-drop-notice="unsupported"
          className="shrink-0 border-b border-sidebar-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          {dropNotice}
        </p>
      ) : null}

      {tab === 'changes' && worktreeId !== undefined ? (
        <ChangesPanel
          worktreeId={worktreeId}
          target={changesTarget}
          className="min-h-0 flex-1"
          // D74: the viewer wants the file's absolute path. A worktree session's cwd IS the worktree folder (main
          // creates it that way), so the changed file's relative path joins onto it.
          viewerSessionId={session.id}
          viewerRoot={session.cwd}
          // D83: the detached Changes window for this worktree; the side panel stays open.
          onDetach={(): void => {
            void window.api.detachChanges(worktreeId).catch(() => undefined)
          }}
        />
      ) : tab === 'preview' ? (
        <PreviewTab request={previewRequest} onClose={closePreview} />
      ) : tab === 'activity' ? (
        <ActivityList sessionId={session.id} />
      ) : tab === 'queue' ? (
        <QueuePanel session={session} state={runtimeState} onSetQueue={actions.setSessionQueue} onSendNow={actions.sendQueuedNow} />
      ) : (
        <>
          {notes.error !== null ? (
            <p
              role="alert"
              className="shrink-0 border-b border-sidebar-border px-3 py-1.5 text-xs text-destructive"
            >
              {notes.error}
            </p>
          ) : null}

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-3 py-3">
              <ChecklistSection
                draft={draft}
                onDraftChange={setDraft}
                checklist={notes.checklist}
                onAdd={notes.addItem}
                onToggle={notes.toggle}
                onEdit={notes.edit}
                onRemove={notes.remove}
                onMove={notes.move}
                onClearDone={notes.clearDone}
              />
              <TagEditor sessionId={session.id} tags={session.tags ?? []} />
              <NotesSection
                notes={notes.notes}
                onChange={notes.setNotes}
                onBlur={(): void => {
                  void notes.flush()
                }}
              />
            </div>
          </ScrollArea>
        </>
      )}
    </aside>
  )
}
