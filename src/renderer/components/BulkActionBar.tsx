// Floating bar for bulk session actions (W4). Shared by the sidebar and the Hub board: it only
// renders the count and the existing per-session actions, so both views apply them in view order.
import { MessageSquarePlus, Moon, Sun, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { Group, Id, StatusDef } from '../../shared/types'
import { BroadcastDialog } from '../queue/BroadcastDialog'
import type { BroadcastPlan } from '../queue/queueLogic'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

export interface BulkActionBarProps {
  readonly count: number
  /** Selected sessions that are running and awake (Sleep applies to these). */
  readonly sleepCount: number
  /** Selected sessions that are asleep (Wake applies to these). */
  readonly wakeCount: number
  readonly statuses: readonly StatusDef[]
  readonly groups: readonly Group[]
  readonly busy: boolean
  readonly onSleep: () => void
  readonly onWake: () => void
  readonly onSetStatus: (statusId: Id | null) => void
  readonly onMoveToGroup: (groupId: Id | null) => void
  readonly onClear: () => void
  /** D48: where a prompt for the selection would go; absent = no Send prompt button. */
  readonly promptPlan?: BroadcastPlan
  readonly onSendPrompt?: (text: string) => void
}

function CountLabel(props: { readonly count: number }): ReactElement {
  return (
    <span
      className="shrink-0 px-1 text-[11px] font-medium tabular-nums text-worktree-sidebar-foreground/80"
      aria-live="polite"
      data-testid="bulk-selection-count"
    >
      {props.count} selected
    </span>
  )
}

/** Status and group menus mirror the per-session context menu so bulk and single actions agree. */
function StatusMenu(props: BulkActionBarProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" disabled={props.busy} className="h-6 px-2 text-[11px]">
          Set status
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {props.statuses.length === 0 && <DropdownMenuItem disabled>No statuses</DropdownMenuItem>}
        {props.statuses.map((status) => (
          <DropdownMenuItem key={status.id} onSelect={(): void => props.onSetStatus(status.id)}>
            <span
              aria-hidden="true"
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: status.color }}
            />
            <span className="flex-1">{status.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(): void => props.onSetStatus(null)}>None</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GroupMenu(props: BulkActionBarProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" disabled={props.busy} className="h-6 px-2 text-[11px]">
          Move to group
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {props.groups.length === 0 && <DropdownMenuItem disabled>No groups</DropdownMenuItem>}
        {props.groups.map((group) => (
          <DropdownMenuItem key={group.id} onSelect={(): void => props.onMoveToGroup(group.id)}>
            <span className="flex-1">{group.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(): void => props.onMoveToGroup(null)}>No group</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function BulkActionBar(props: BulkActionBarProps): ReactElement {
  const [promptOpen, setPromptOpen] = useState(false)
  const plan = props.promptPlan
  const reach = plan === undefined ? 0 : plan.now.length + plan.later.length + plan.stopped.length
  return (
    <div
      data-testid="bulk-action-bar"
      className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-sidebar-border bg-worktree-sidebar-accent px-1.5 py-1 shadow-sm"
    >
      <CountLabel count={props.count} />
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={props.busy || props.sleepCount === 0}
          onClick={props.onSleep}
          className="h-6 gap-1 px-2 text-[11px]"
        >
          <Moon className="size-3" aria-hidden="true" />
          Sleep
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={props.busy || props.wakeCount === 0}
          onClick={props.onWake}
          className="h-6 gap-1 px-2 text-[11px]"
        >
          <Sun className="size-3" aria-hidden="true" />
          Wake
        </Button>
        {plan !== undefined && props.onSendPrompt !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={props.busy || reach === 0}
            onClick={(): void => setPromptOpen(true)}
            title="Send one prompt to every selected Claude / OpenCode session"
            className="h-6 gap-1 px-2 text-[11px]"
          >
            <MessageSquarePlus className="size-3" aria-hidden="true" />
            Prompt
          </Button>
        ) : null}
        <StatusMenu {...props} />
        <GroupMenu {...props} />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          onClick={props.onClear}
          className="size-6 text-muted-foreground"
        >
          <X className="size-3" aria-hidden="true" />
        </Button>
      </div>
      {plan !== undefined && props.onSendPrompt !== undefined ? (
        <BroadcastDialog open={promptOpen} plan={plan} onOpenChange={setPromptOpen} onSend={props.onSendPrompt} />
      ) : null}
    </div>
  )
}
