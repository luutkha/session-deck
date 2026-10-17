import { Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ChecklistItem } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'
import { isComplete, progress, type MoveDirection } from './checklistLogic'
import { ChecklistRow } from './ChecklistRow'
import { parseSteps } from './parseSteps'

export interface ChecklistSectionProps {
  readonly draft: string
  readonly onDraftChange: (text: string) => void
  readonly checklist: readonly ChecklistItem[]
  readonly onAdd: (text: string) => void
  readonly onToggle: (id: string) => void
  readonly onEdit: (id: string, text: string) => void
  readonly onRemove: (id: string) => void
  readonly onMove: (id: string, direction: MoveDirection) => void
  readonly onClearDone: () => void
}

export function ChecklistSection({
  draft,
  onDraftChange: setDraft,
  checklist,
  onAdd,
  onToggle,
  onEdit,
  onRemove,
  onMove,
  onClearDone
}: ChecklistSectionProps): ReactElement {
  const stats = progress(checklist)
  const complete = isComplete(checklist)

  function submit(): void {
    const steps = parseSteps(draft)
    if (steps.length === 0) return
    steps.forEach(onAdd)
    setDraft('')
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium tracking-tight">Checklist</h2>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {stats.done} of {stats.total}
        </span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            complete ? 'bg-status-success' : 'bg-primary'
          )}
          style={{ width: `${stats.percent}%` }}
        />
      </div>

      {checklist.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {checklist.map((item, index) => (
            <ChecklistRow
              key={item.id}
              item={item}
              first={index === 0}
              last={index === checklist.length - 1}
              onToggle={onToggle}
              onEdit={onEdit}
              onRemove={onRemove}
              onMove={onMove}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No steps yet.</p>
      )}

      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          value={draft}
          aria-label="Add a checklist step"
          placeholder="Add a step and press Enter"
          className="h-8 min-w-0 flex-1 text-xs"
          onChange={(event): void => setDraft(event.target.value)}
          onPaste={(event): void => {
            const text = event.clipboardData.getData('text')
            if (!text.includes(String.fromCharCode(10))) return
            event.preventDefault()
            parseSteps(text).forEach(onAdd)
          }}
          onKeyDown={(event): void => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label="Add step"
          disabled={parseSteps(draft).length === 0}
          onClick={submit}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {stats.done > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="w-fit text-xs text-muted-foreground"
          onClick={onClearDone}
        >
          Clear completed
        </Button>
      ) : null}
    </section>
  )
}
