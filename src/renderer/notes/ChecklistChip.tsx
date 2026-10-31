import { CheckSquare, ListOrdered, NotebookPen } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ChecklistItem } from '../../shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { isComplete, progress } from './checklistLogic'

export interface ChecklistChipProps {
  readonly checklist?: readonly ChecklistItem[]
  readonly hasNotes: boolean
  /** Prompts waiting in the session's queue (D47). 0 or absent = no chip. */
  readonly queued?: number
}

/**
 * The "2/5" progress chip, the queued-prompts count and the notes indicator shown in a card's row 2. Renders nothing
 * when the session has none of them.
 */
export function ChecklistChip({ checklist, hasNotes, queued = 0 }: ChecklistChipProps): ReactElement | null {
  const items = checklist ?? []
  const stats = progress(items)
  const complete = isComplete(items)

  if (stats.total === 0 && !hasNotes && queued === 0) return null

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
      {queued > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span data-queue-chip={queued} className="inline-flex shrink-0 items-center gap-1 text-[11px] leading-none tabular-nums text-muted-foreground/80">
              <ListOrdered className="size-3" aria-hidden="true" />
              {queued}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {queued === 1 ? '1 prompt queued' : `${queued} prompts queued`}
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