import { Filter, FolderPlus, Plus } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { Id, StatusDef } from '../../shared/types'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import type { GroupBy } from './sidebarPrefs'

export type { GroupBy }

export interface SessionsHeaderProps {
  readonly groupBy: GroupBy
  readonly showWorkspaces: boolean
  readonly onShowWorkspacesChange: (show: boolean) => void
  readonly statuses: readonly StatusDef[]
  readonly selectedStatuses: ReadonlySet<Id | null>
  readonly counts: ReadonlyMap<Id | null, number>
  readonly onGroupByChange: (value: GroupBy) => void
  readonly onToggleStatus: (statusId: Id | null) => void
  readonly onNewGroup: () => void
  readonly onNewSession: () => void
}

export function SessionsHeader(props: SessionsHeaderProps): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80 select-none">
          Sessions
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Filter and group by"
                  className="text-muted-foreground"
                >
                  <Filter className="size-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Filter and group by
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-[14rem]">
            <DropdownMenuLabel>Group by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={props.groupBy}
              onValueChange={(value): void => {
                if (value === 'groups' || value === 'status') {
                  props.onGroupByChange(value)
                }
              }}
            >
              <DropdownMenuRadioItem value="groups">Groups</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {props.groupBy === 'groups' && (
              <DropdownMenuCheckboxItem
                checked={props.showWorkspaces}
                onCheckedChange={props.onShowWorkspacesChange}
                onSelect={(event): void => event.preventDefault()}
              >
                Show workspaces
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Filter by status</span>
              {props.selectedStatuses.size > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {props.selectedStatuses.size}
                </Badge>
              )}
            </DropdownMenuLabel>
            {props.statuses.length === 0 && (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                No statuses defined
              </div>
            )}
            {props.statuses.map((status) => {
              const checked = props.selectedStatuses.has(status.id)
              const count = props.counts.get(status.id) ?? 0
              return (
                <DropdownMenuCheckboxItem
                  key={status.id}
                  checked={checked}
                  onCheckedChange={(): void => props.onToggleStatus(status.id)}
                  onSelect={(event): void => event.preventDefault()}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  <span className="flex-1 truncate">{status.name}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground/70">{count}</span>
                </DropdownMenuCheckboxItem>
              )
            })}
            <DropdownMenuCheckboxItem
              checked={props.selectedStatuses.has(null)}
              onCheckedChange={(): void => props.onToggleStatus(null)}
              onSelect={(event): void => event.preventDefault()}
            >
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-full border border-muted-foreground/60 bg-transparent"
              />
              <span className="flex-1 truncate">None</span>
              <span className="ml-auto text-[11px] text-muted-foreground/70">
                {props.counts.get(null) ?? 0}
              </span>
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="New group"
              onClick={props.onNewGroup}
              className="text-muted-foreground"
            >
              <FolderPlus className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            New group
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="New session"
              onClick={props.onNewSession}
              className="text-muted-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            New session
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}