import { type ReactElement, type ReactNode } from 'react'
import { Coffee, Moon, Sun } from 'lucide-react'
import type { Id, StatusDef } from '../../shared/types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '../components/ui/context-menu'

export interface HubCardMenuProps {
  readonly children: ReactNode
  readonly statuses: readonly StatusDef[]
  /** The session's current effective status, so it can be shown disabled in the submenu. */
  readonly currentStatusId: Id | null
  readonly onOpen: () => void
  readonly onSetStatus: (statusId: Id | null) => void
  /** True while the session is asleep: shows "Wake up" instead of "Sleep". */
  readonly sleeping?: boolean
  /** True when the session is running and awake, so it can be put to sleep by hand. */
  readonly canSleep?: boolean
  readonly onSleep?: () => void
  readonly keepAwake?: boolean
  readonly onToggleKeepAwake?: () => void
}

export function HubCardMenu(props: HubCardMenuProps): ReactElement {
  const {
    children,
    statuses,
    currentStatusId,
    onOpen,
    onSetStatus,
    sleeping = false,
    canSleep = false,
    onSleep,
    keepAwake = false,
    onToggleKeepAwake
  } = props
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[12rem]">
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        {sleeping ? (
          <ContextMenuItem onSelect={onOpen}>
            <Sun aria-hidden="true" />
            Wake up
          </ContextMenuItem>
        ) : canSleep && onSleep !== undefined ? (
          <ContextMenuItem onSelect={onSleep}>
            <Moon aria-hidden="true" />
            Sleep
          </ContextMenuItem>
        ) : null}
        {onToggleKeepAwake !== undefined ? (
          <ContextMenuItem onSelect={onToggleKeepAwake}>
            <Coffee aria-hidden="true" />
            {keepAwake ? 'Allow auto-sleep' : 'Keep awake'}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to status</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {statuses.map((status) => (
              <ContextMenuItem
                key={status.id}
                disabled={status.id === currentStatusId}
                onSelect={(): void => onSetStatus(status.id)}
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                <span className="flex-1">{status.name}</span>
              </ContextMenuItem>
            ))}
            <ContextMenuItem
              disabled={currentStatusId === null}
              onSelect={(): void => onSetStatus(null)}
            >
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-full border border-muted-foreground/60 bg-transparent"
              />
              <span className="flex-1">No status</span>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
