import type { ReactElement } from 'react'
import { Bell } from 'lucide-react'
import type { Id } from '../../shared/types'
import { Button } from '../components/ui/button'
import { cn } from '@/lib/utils'
import { NeedsYouPopover } from './NeedsYouPopover'
import type { NeedsYouItem } from './needsYou'

export interface NeedsYouButtonProps {
  readonly items: readonly NeedsYouItem[]
  readonly onOpenSession: (id: Id) => void
  readonly className?: string
}

/** Sidebar-header bell with the number of sessions that need the user; opens the Needs you list. */
export function NeedsYouButton({ items, onOpenSession, className }: NeedsYouButtonProps): ReactElement {
  const count = items.length
  const label = count === 0 ? 'Needs you: nothing' : `Needs you: ${String(count)}`
  return (
    <NeedsYouPopover items={items} onOpenSession={onOpenSession}>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn('relative text-muted-foreground', count > 0 && 'text-amber-500', className)}
        aria-label={label}
        title={label}
        data-needs-you-button=""
        data-count={count}
      >
        <Bell size={14} strokeWidth={2.25} />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-semibold leading-none text-black"
          >
            {count > 9 ? '9+' : String(count)}
          </span>
        ) : null}
      </Button>
    </NeedsYouPopover>
  )
}
