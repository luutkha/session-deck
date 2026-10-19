import type { MouseEvent, ReactElement } from 'react'
import type { AttentionReason } from '../../shared/types'
import { cn } from '@/lib/utils'
import { FilledBellIcon } from './FilledBellIcon'
import { needsYouReasonText } from './needsYou'

export interface AttentionBellProps {
  readonly reason: AttentionReason
  /** Present = the bell is a button that marks the session read (sidebar card, Hub card). Absent = a plain icon (tab). */
  readonly onMarkRead?: () => void
  readonly className?: string
}

/** The amber bell shown in place of the status dot while a session needs the user (D22). */
export function AttentionBell({ reason, onMarkRead, className }: AttentionBellProps): ReactElement {
  const text = needsYouReasonText(reason)
  if (onMarkRead === undefined) {
    return (
      <span
        role="img"
        aria-label={`Needs you: ${text}`}
        title={text}
        data-attention-bell={reason}
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
      >
        <FilledBellIcon className="size-3 text-amber-500 drop-shadow-sm" />
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-label={`Needs you: ${text}. Mark as read`}
      title={`${text} · click to mark as read`}
      data-attention-bell={reason}
      onClick={(event: MouseEvent<HTMLButtonElement>): void => {
        // Marking read must not also open the session.
        event.stopPropagation()
        onMarkRead()
      }}
      onDoubleClick={(event: MouseEvent<HTMLButtonElement>): void => event.stopPropagation()}
      className={cn(
        'inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded transition-transform',
        'hover:bg-accent/80 active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
    >
      <FilledBellIcon className="size-3 text-amber-500 drop-shadow-sm" />
    </button>
  )
}
