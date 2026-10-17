import { Check, NotebookPen, Save, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Session } from '../../shared/types'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import type { SessionActions } from '../state/useSessionStore'
import { ChecklistSection } from './ChecklistSection'
import { NotesSection } from './NotesSection'
import { useChecklistDraft } from './checklistDrafts'
import { parseSteps } from './parseSteps'
import { useSessionNotes } from './useSessionNotes'

export interface NotesPanelProps {
  readonly session: Session
  readonly actions: Pick<SessionActions, 'setSessionNotes' | 'setSessionChecklist'>
  readonly onClose: () => void
}

export function NotesPanel({ session, actions, onClose }: NotesPanelProps): ReactElement {
  const notes = useSessionNotes(session, actions)
  const [draft, setDraft] = useChecklistDraft(session.id)
  const unsaved = notes.notes !== (session.notes ?? '') || parseSteps(draft).length > 0

  function save(): void {
    parseSteps(draft).forEach(notes.addItem)
    setDraft('')
    void notes.flush()
  }

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-sidebar-border bg-card">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border pl-3 pr-1.5">
        <NotebookPen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-[13px] font-medium tracking-tight">Notes</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {session.name}
        </span>
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
    </aside>
  )
}