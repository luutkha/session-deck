import { type ReactElement, type ReactNode } from 'react'
import { Bell, BellOff, Coffee, GitFork, Moon, Sun } from 'lucide-react'
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
import type { AttentionReason, Group, Id, StatusDef } from '../../shared/types'
import { readToggleLabel } from '../attention/needsYou'

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
  /** The session's current bell (null = none): drives the Mark as read / Mark as unread item. */
  readonly attention?: AttentionReason | null
  readonly onToggleRead?: () => void
  /** D52: shown for Claude sessions; starts a new session on a copy of the conversation. */
  readonly onFork?: () => void
}

export function SessionContextMenu(props: SessionContextMenuProps): ReactElement {
  const {
    children, statuses, groups,
    onRename, onSetStatus, onMoveToGroup, onNewGroupAndMove,
    onCloseSession, onRemoveSession,
    sleeping = false, canSleep = false, onSleep, onWake,
    keepAwake = false, onToggleKeepAwake,
    attention = null, onToggleRead, onFork
  } = props
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[12rem]">
        <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>
        {onToggleRead !== undefined ? (
          <ContextMenuItem onSelect={onToggleRead}>
            {attention === null ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
            {readToggleLabel(attention)}
          </ContextMenuItem>
        ) : null}
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
        {onFork !== undefined ? (
          <ContextMenuItem onSelect={onFork} data-fork-session="">
            <GitFork aria-hidden="true" />
            Fork session
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