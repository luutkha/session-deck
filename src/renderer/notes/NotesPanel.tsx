import { Check, NotebookPen, Save, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
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
import { SIDE_PANEL_KEEP_FOR_MAIN, SIDE_PANEL_WIDTH_DEFAULT } from '../shell/sidePanelWidth'
import { cn } from '../lib/utils'
import { PreviewTab } from '../viewer/PreviewTab'
import type { PreviewRequest } from '../viewer/fileViewState'
import { ChecklistSection } from './ChecklistSection'
import { NotesSection } from './NotesSection'
import { useChecklistDraft } from './checklistDrafts'
import { parseSteps } from './parseSteps'
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

export function NotesPanel(props: NotesPanelProps): ReactElement {
  const { session, actions, onClose, storageKey = SIDE_PANEL_TAB_KEY, changesTarget, runtimeState } = props
  const previewRequest = props.previewRequest ?? null
  const width = props.width ?? SIDE_PANEL_WIDTH_DEFAULT
  const { onResizeDrag, onResizeCommit, onResizeReset, onResizingChange } = props
  const notes = useSessionNotes(session, actions)
  const [draft, setDraft] = useChecklistDraft(session.id)
  const [storedTab, setStoredTab] = useState<SidePanelTab>((): SidePanelTab => readSidePanelTab(storageKey))
  const worktreeId = session.worktreeId
  const hasChanges = worktreeId !== undefined
  const hasPreview = previewRequest !== null
  const tab = resolveSidePanelTab(storedTab, hasChanges, hasPreview)
  const unsaved = notes.notes !== (session.notes ?? '') || parseSteps(draft).length > 0

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
      style={{ width, maxWidth: `calc(100vw - ${String(SIDE_PANEL_KEEP_FOR_MAIN)}px)` }}
    >
      {onResizeDrag !== undefined && onResizeCommit !== undefined && onResizeReset !== undefined && onResizingChange !== undefined ? (
        <SidePanelResizeHandle
          width={width}
          onDrag={onResizeDrag}
          onCommit={onResizeCommit}
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

      {tab === 'changes' && worktreeId !== undefined ? (
        <ChangesPanel worktreeId={worktreeId} target={changesTarget} className="min-h-0 flex-1" />
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
