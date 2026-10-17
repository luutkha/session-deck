import { CheckSquare, NotebookPen } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ChecklistItem } from '../../shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { isComplete, progress } from './checklistLogic'

export interface ChecklistChipProps {
  readonly checklist?: readonly ChecklistItem[]
  readonly hasNotes: boolean
}

/**
 * The "2/5" progress chip and notes indicator shown in a card's row 2. Renders nothing when the
 * session has neither a checklist nor notes.
 */
export function ChecklistChip({ checklist, hasNotes }: ChecklistChipProps): ReactElement | null {
  const items = checklist ?? []
  const stats = progress(items)
  const complete = isComplete(items)

  if (stats.total === 0 && !hasNotes) return null

  return (
    <>
      {stats.total > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 text-[11px] leading-none tabular-nums',
                complete ? 'text-status-success' : 'text-muted-foreground/80'
              )}
            >
              <CheckSquare className="size-3" aria-hidden="true" />
              {stats.done}/{stats.total}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {stats.done} of {stats.total} steps done
          </TooltipContent>
        </Tooltip>
      ) : null}
      {hasNotes ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0 items-center text-muted-foreground/80">
              <NotebookPen className="size-3" aria-hidden="true" />
              <span className="sr-only">Has notes</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            Has notes
          </TooltipContent>
        </Tooltip>
      ) : null}
    </>
  )
}