import { useState, type ReactElement, type ReactNode } from 'react'
import type { Id } from '../../shared/types'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { relativeTime } from '../state/formatTime'
import { lastPathSegment } from '../Sidebar/uiLogic'
import { FilledBellIcon } from './FilledBellIcon'
import { needsYouReasonText, type NeedsYouItem } from './needsYou'

export interface NeedsYouPopoverProps {
  readonly items: readonly NeedsYouItem[]
  readonly onOpenSession: (id: Id) => void
  /** The trigger element (rendered with asChild). */
  readonly children: ReactNode
  readonly side?: 'top' | 'bottom'
  readonly align?: 'start' | 'center' | 'end'
}

/** The list of sessions that need the user (D22), opened from the sidebar-header bell and the status bar. */
export function NeedsYouPopover(props: NeedsYouPopoverProps): ReactElement {
  const { items, onOpenSession, children, side = 'bottom', align = 'start' } = props
  const [open, setOpen] = useState(false)
  const now = Date.now()

  function openSession(id: Id): void {
    setOpen(false)
    onOpenSession(id)
  }

  function markAllRead(): void {
    for (const item of items) {
      window.api.clearAttention(item.id)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        className="w-72 p-0"
        aria-label="Sessions that need you"
        // Why: like Orca, opening the list must not draw a focus ring on its first button.
        onOpenAutoFocus={(event: Event): void => event.preventDefault()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="text-[12px] font-medium">Needs you</span>
          {items.length > 0 ? (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={markAllRead}
            >
              Mark all as read
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">Nothing needs you right now.</p>
        ) : (
          <ul role="list" className="max-h-80 overflow-y-auto py-1" data-needs-you-list="">
            {items.map((item: NeedsYouItem): ReactElement => (
              <li key={item.id}>
                <button
                  type="button"
                  data-needs-you-item={item.id}
                  onClick={(): void => openSession(item.id)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/70 focus-visible:bg-accent/70 focus-visible:outline-none"
                >
                  <FilledBellIcon className="mt-0.5 size-3 shrink-0 text-amber-500" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12px] text-foreground">{item.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {needsYouReasonText(item.reason)}
                      {` · ${lastPathSegment(item.cwd)}`}
                    </span>
                  </span>
                  {item.at !== null ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(now, item.at)}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
