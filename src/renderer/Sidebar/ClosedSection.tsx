import { ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { type ReactElement } from 'react'
import type { Id, Session } from '../../shared/types'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/ui/context-menu'
import { lastPathSegment } from './uiLogic'

export interface ClosedSectionProps {
  readonly sessions: readonly Session[]
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly onResume: (id: Id) => void
  readonly onRequestDelete: (id: Id) => void
}

export function ClosedSection(props: ClosedSectionProps): ReactElement {
  return (
    <div className="mt-2 flex flex-col gap-1 px-2 pt-1">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={!props.collapsed}
        className="group flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] font-semibold tracking-tight text-muted-foreground hover:bg-worktree-sidebar-accent/40"
      >
        {props.collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        )}
        <span className="flex-1 truncate">Closed</span>
        <Badge
          variant="secondary"
          className="ml-auto h-4 min-w-[1rem] rounded-full px-1 text-[10px] font-medium leading-none text-muted-foreground/70"
        >
          {props.sessions.length}
        </Badge>
      </button>
      {!props.collapsed && (
        <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto pl-2">
          {props.sessions.map((session) => (
            <ClosedCard
              key={session.id}
              session={session}
              onResume={props.onResume}
              onRequestDelete={props.onRequestDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ClosedCardProps {
  readonly session: Session
  readonly onResume: (id: Id) => void
  readonly onRequestDelete: (id: Id) => void
}

function ClosedCard(props: ClosedCardProps): ReactElement {
  const { session } = props
  const folder = lastPathSegment(session.cwd)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group/closed flex flex-col gap-1 rounded-lg border border-transparent px-2 py-1.5 opacity-70 hover:opacity-100"
          onDoubleClick={(): void => props.onResume(session.id)}
        >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block size-2 shrink-0 rounded-full border border-muted-foreground/40 bg-transparent"
        />
        <span className="flex-1 truncate text-[13px] font-medium tracking-tight text-muted-foreground">
          {session.name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Resume ${session.name}`}
                onClick={(): void => props.onResume(session.id)}
                className="size-5 text-muted-foreground hover:bg-worktree-sidebar-accent/80 hover:text-foreground"
              >
                <RotateCcw className="size-3" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Resume session
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete ${session.name}`}
                onClick={(): void => props.onRequestDelete(session.id)}
                className="size-5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              >
                <Trash2 className="size-3" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Delete
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {folder.length > 0 && (
        <div className="flex min-w-0 items-center gap-1 text-[11px]">
          <span className="truncate text-muted-foreground/70" title={session.cwd}>
            {folder}
          </span>
        </div>
      )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[8rem]">
        <ContextMenuItem onSelect={(): void => props.onResume(session.id)}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          <span>Resume</span>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={(): void => props.onRequestDelete(session.id)}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          <span>Delete</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}