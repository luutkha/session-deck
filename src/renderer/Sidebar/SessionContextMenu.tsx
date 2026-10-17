import { type ReactElement, type ReactNode } from 'react'
import { Coffee, Moon, Sun } from 'lucide-react'
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
import type { Group, Id, StatusDef } from '../../shared/types'

export interface SessionContextMenuProps {
  readonly children: ReactNode
  readonly statuses: readonly StatusDef[]
  readonly groups: readonly Group[]
  readonly onRename: () => void
  readonly onSetStatus: (statusId: Id | null) => void
  readonly onMoveToGroup: (groupId: Id | null) => void
  readonly onNewGroupAndMove: () => void
  readonly onCloseSession: () => void
  readonly onRemoveSession: () => void
  /** True while the session is asleep: shows "Wake up" instead of "Sleep". */
  readonly sleeping?: boolean
  /** True when the session is running and awake, so it can be put to sleep by hand. */
  readonly canSleep?: boolean
  readonly onSleep?: () => void
  readonly onWake?: () => void
  /** True = automatic sleep is off for this session. */
  readonly keepAwake?: boolean
  readonly onToggleKeepAwake?: () => void
}

export function SessionContextMenu(props: SessionContextMenuProps): ReactElement {
  const {
    children, statuses, groups,
    onRename, onSetStatus, onMoveToGroup, onNewGroupAndMove,
    onCloseSession, onRemoveSession,
    sleeping = false, canSleep = false, onSleep, onWake,
    keepAwake = false, onToggleKeepAwake
  } = props
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[12rem]">
        <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Set status</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {statuses.length === 0 && (
              <ContextMenuItem disabled>No statuses</ContextMenuItem>
            )}
            {statuses.map((status) => (
              <ContextMenuItem
                key={status.id}
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
            <ContextMenuItem onSelect={(): void => onSetStatus(null)}>
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-full border border-muted-foreground/60 bg-transparent"
              />
              <span className="flex-1">None</span>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to group</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {groups.length === 0 && (
              <ContextMenuItem disabled>No groups</ContextMenuItem>
            )}
            {groups.map((group) => (
              <ContextMenuItem
                key={group.id}
                onSelect={(): void => onMoveToGroup(group.id)}
              >
                <span className="flex-1">{group.name}</span>
              </ContextMenuItem>
            ))}
            <ContextMenuItem onSelect={(): void => onMoveToGroup(null)}>
              <span className="flex-1">No group</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onNewGroupAndMove}>New group…</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {sleeping && onWake !== undefined ? (
          <ContextMenuItem onSelect={onWake}>
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
        <ContextMenuItem onSelect={onCloseSession}>Close session</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={onRemoveSession}>
          Remove session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}