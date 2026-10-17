// The slim header shown above a pane when more than one pane is visible.
import type { MouseEvent, ReactElement } from 'react'
import { X } from 'lucide-react'
import type { AttentionReason, SessionRun } from '../../shared/types'
import { cn } from '@/lib/utils'
import { tabIndicatorFor } from '../shell/tabStatus'

export interface SplitPaneHeaderProps {
  readonly name: string
  readonly run: SessionRun | null
  readonly attention: AttentionReason | null
  readonly onClose: () => void
}

export function SplitPaneHeader(props: SplitPaneHeaderProps): ReactElement {
  const indicator = tabIndicatorFor(props.run, props.attention)
  return (
    <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 text-[11px] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          indicator.colorClass,
          indicator.pulse && 'animate-pulse motion-reduce:animate-none'
        )}
      />
      <span className="sr-only">{indicator.label}</span>
      <span className="min-w-0 flex-1 truncate">{props.name}</span>
      <button
        type="button"
        aria-label="Remove from split"
        className="app-no-drag flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
        onMouseDown={(event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation()
        }}
        onClick={(event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation()
          props.onClose()
        }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}
