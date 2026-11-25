import { isValidElement, memo, type ReactElement, type ReactNode } from 'react'
import { Coffee, Moon, Sun } from 'lucide-react'
import type { Id, StatusDef } from '../../shared/types'
import { HubCard, hubCardPropsEqual, type HubCardProps } from './HubCard'
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

export function HubCardMenuView(props: HubCardMenuProps): ReactElement {
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

function sameStatuses(prev: readonly StatusDef[], next: readonly StatusDef[]): boolean {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  return prev.every((status: StatusDef, index: number): boolean => {
    const other = next[index]
    return status.id === other.id && status.name === other.name && status.color === other.color
  })
}

/** The card is the menu's child, so its displayed values must be compared here too: a bailed-out menu never
 * passes fresh children to the memoized card, which would freeze the card at its last render. */
function sameCardChild(prev: ReactNode, next: ReactNode): boolean {
  if (prev === next) return true
  if (
    isValidElement<HubCardProps>(prev) &&
    isValidElement<HubCardProps>(next) &&
    prev.type === HubCard &&
    next.type === HubCard
  ) {
    return hubCardPropsEqual(prev.props, next.props)
  }
  return false
}

/**
 * Value comparison for a card's context menu: statuses by value (a store broadcast copies the array), the flags
 * the menu renders, and the child card's displayed props. Callbacks are ignored — HubColumn passes stable
 * wrappers that read the latest closures through a ref — so a publish with unchanged data does not re-render
 * either the menu or the card.
 */
export function hubCardMenuPropsEqual(prev: HubCardMenuProps, next: HubCardMenuProps): boolean {
  return (
    sameStatuses(prev.statuses, next.statuses) &&
    prev.currentStatusId === next.currentStatusId &&
    (prev.sleeping ?? false) === (next.sleeping ?? false) &&
    (prev.canSleep ?? false) === (next.canSleep ?? false) &&
    (prev.keepAwake ?? false) === (next.keepAwake ?? false) &&
    sameCardChild(prev.children, next.children)
  )
}

export const HubCardMenu = memo(HubCardMenuView, hubCardMenuPropsEqual)
