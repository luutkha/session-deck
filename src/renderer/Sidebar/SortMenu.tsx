// D61: the sidebar "Sort" menu (Ops and Code headers). Highlighted while a sort other than Manual is on.
import { ArrowDownUp } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { parseSessionSort, SESSION_SORT_OPTIONS, sessionSortLabel, type SessionSort } from '../state/sessionSort'

export interface SortMenuProps {
  readonly sort: SessionSort
  readonly onSortChange: (sort: SessionSort) => void
}

export function SortMenu({ sort, onSortChange }: SortMenuProps): ReactElement {
  const label = sort === 'manual' ? 'Sort sessions' : `Sorted by ${sessionSortLabel(sort)}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Sort sessions"
              data-sort-menu
              data-sort={sort}
              className={cn(sort === 'manual' ? 'text-muted-foreground' : 'text-foreground')}
            >
              <ArrowDownUp className="size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[12rem]">
        <DropdownMenuLabel>Sort sessions</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(value): void => onSortChange(parseSessionSort(value))}>
          {SESSION_SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} data-sort-option={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
