import { Moon, X } from 'lucide-react'
import { type HTMLAttributes, type ReactElement, type ReactNode, type MouseEvent, type Ref } from 'react'
import type { AttentionReason, Id, RuntimeState, Session, SessionActivity, StatusDef } from '../../shared/types'
import type { SelectClickModifiers } from '../state/multiSelect'
import { activityDetail, activityLabel, isSleeping, relativeTime } from '../state/formatTime'
import { AgentBadge, sessionAgent } from '../components/AgentBadge'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { InlineEdit } from './InlineEdit'
import { lastPathSegment } from './uiLogic'
import { ChecklistChip } from '../notes/ChecklistChip'
import { AttentionBell } from '../attention/AttentionBell'

function activityDotClass(activity: SessionActivity): string {
  switch (activity) {
    case 'working':
      return 'bg-[var(--attn-idle)]'
    case 'needs-input':
      return 'bg-[var(--attn-permission)]'
    case 'finished':
      return 'bg-status-success'
  }
}

function activityDotLabel(activity: SessionActivity): string {
  switch (activity) {
    case 'working':
      return 'Working'
    case 'needs-input':
      return 'Needs input'
    case 'finished':
      return 'Finished'
  }
}

export interface SessionCardOwnProps {
  readonly session: Session
  readonly status: StatusDef | null
  readonly active: boolean
  readonly runtime: RuntimeState | undefined
  readonly lastChange: number
  readonly now: number
  readonly renaming: boolean
  readonly groupBadge: string | null
  readonly showGroupBadge: boolean
  readonly attention: AttentionReason | null
  readonly showIndicator: boolean
  readonly indicatorAriaLabel: string
  readonly indicatorClass: string
  readonly draggable: boolean
  readonly dragOver: 'before' | 'after' | 'inside' | null
  /** W4: part of the bulk selection (Ctrl/Shift+click); independent of the active session. */
  readonly selected?: boolean
  /** The optional modifiers let the sidebar distinguish plain / Ctrl / Shift clicks (W4). */
  readonly onSelect: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onStartRename: (id: Id) => void
  readonly onCommitRename: (id: Id, name: string) => void
  readonly onCancelRename: () => void
  readonly onClose: (id: Id) => void
  /** Receives the real DOM event: a Radix ContextMenuTrigger (asChild) injects its handler through this prop. */
  readonly onContextMenu?: (event: MouseEvent<HTMLElement>) => void
  readonly onDragStart: (id: Id) => void
  readonly onDragOverItem: (id: Id, position: 'before' | 'after') => void
  readonly onDropItem: () => void
  readonly onDragEnd: () => void
  readonly contextMenuTrigger?: ReactNode
}

/**
 * Own props plus whatever a Radix `asChild` Slot injects (ref, onPointerDown, data-state, ...): the card spreads the
 * rest onto its root element so a ContextMenuTrigger wrapping it receives everything it expects.
 */
export type SessionCardProps = SessionCardOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, keyof SessionCardOwnProps | 'role' | 'tabIndex' | 'draggable' | 'children'> & {
    readonly ref?: Ref<HTMLDivElement>
  }

export function SessionCard(props: SessionCardProps): ReactElement {
  const {
    session, status, active, runtime, lastChange, now, renaming,
    groupBadge, showGroupBadge, attention,
    showIndicator, indicatorAriaLabel, indicatorClass,
    draggable, dragOver, selected = false,
    onSelect, onStartRename, onCommitRename, onCancelRename, onClose, onContextMenu,
    onDragStart, onDragOverItem, onDropItem, onDragEnd, contextMenuTrigger,
    ...rest
  } = props

  const classes: string[] = [
    'group/session relative flex flex-col gap-1 rounded-lg px-2 py-1.5 text-left outline-none select-none cursor-pointer',
    'transition-colors'
  ]
  const sleeping = isSleeping(runtime)
  if (active) {
    classes.push('border border-transparent bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground shadow-sm')
  } else {
    classes.push('border border-transparent hover:bg-worktree-sidebar-accent/50')
  }
  if (selected) {
    classes.push('ring-1 ring-inset ring-primary/60 bg-worktree-sidebar-accent/60')
  }
  if (sleeping) {
    classes.push('opacity-60')
  }
  if (dragOver === 'before') {
    classes.push('border-t-2 border-t-primary')
  } else if (dragOver === 'after') {
    classes.push('border-b-2 border-b-primary')
  }

  const folder = lastPathSegment(session.cwd)
  const showFolder = folder.length > 0

  const activity = runtime?.activity ?? null
  const showActivity = runtime !== undefined && runtime.run !== 'exited' && activity !== null
  const detail = activityDetail(runtime)
  const fullDetail = runtime?.activityMessage?.trim() ?? ''
  const changedAt = runtime?.activityAt ?? lastChange

  return (
    <div
      {...rest}
      role="treeitem"
      aria-selected={active || selected}
      data-selected={selected ? 'true' : undefined}
      tabIndex={-1}
      draggable={draggable && !renaming}
      onClick={(event): void => onSelect(session.id, {
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey
      })}
      onDoubleClick={(): void => onStartRename(session.id)}
      onKeyDown={(event): void => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onSelect(session.id)
        } else if (event.key === 'F2') {
          event.preventDefault()
          onStartRename(session.id)
        }
      }}
      onContextMenu={onContextMenu}
      onDragStart={(event): void => {
        if (!draggable) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', session.id)
        onDragStart(session.id)
      }}
      onDragOver={(event): void => {
        if (!draggable) return
        const rect = event.currentTarget.getBoundingClientRect()
        const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        onDragOverItem(session.id, position)
        event.preventDefault()
      }}
      onDrop={(event): void => {
        if (!draggable) return
        event.preventDefault()
        event.stopPropagation()
        onDropItem()
      }}
      onDragEnd={(): void => onDragEnd()}
      className={classes.join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2">
        {showIndicator ? (
          attention !== null ? (
            // D22: the bell wins over sleep and status; clicking it marks the session read.
            <AttentionBell reason={attention} onMarkRead={(): void => window.api.clearAttention(session.id)} />
          ) : sleeping ? (
            <span
              role="img"
              aria-label="Sleeping"
              className="flex size-3.5 shrink-0 items-center text-muted-foreground"
            >
              <Moon className="size-3" aria-hidden="true" />
            </span>
          ) : showActivity && activity !== null ? (
            <span
              aria-label={activityDotLabel(activity)}
              className={`inline-block size-2 shrink-0 rounded-full ${activityDotClass(activity)} ${activity === 'working' ? 'motion-safe:animate-pulse' : ''}`}
            />
          ) : runtime !== undefined ? (
            <span
              aria-label={indicatorAriaLabel}
              className={`inline-block size-2 shrink-0 rounded-full ${indicatorClass}`}
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 rounded-full border border-muted-foreground/40 bg-transparent"
            />
          )
        ) : null}
        {renaming ? (
          <InlineEdit
            value={session.name}
            ariaLabel="Session name"
            onCommit={(value): void => onCommitRename(session.id, value)}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            className={
              active
                ? 'flex-1 truncate text-[13px] font-medium tracking-tight'
                : 'flex-1 truncate text-[13px] font-medium tracking-tight'
            }
          >
            {session.name}
          </span>
        )}
        <AgentBadge agent={sessionAgent(session)} remote={runtime?.remoteControl === true} keepAwake={session.keepAwake === true} />
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100">
          {contextMenuTrigger}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close session"
                onClick={(event): void => {
                  event.stopPropagation()
                  onClose(session.id)
                }}
                className="size-5 text-muted-foreground hover:bg-worktree-sidebar-accent/80 hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Close session
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        {status !== null && (
          <Badge variant="dot" className="h-4 px-1.5 text-[10px] font-medium leading-none text-muted-foreground">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: status.color }}
            />
            {status.name}
          </Badge>
        )}
        {showGroupBadge && groupBadge !== null && (
          <Badge variant="hostContext" className="h-4 px-1.5 text-[10px] leading-none">
            {groupBadge}
          </Badge>
        )}
        {showFolder && (
          <span className="truncate text-[11px] text-muted-foreground/70" title={session.cwd}>
            {folder}
          </span>
        )}
        <ChecklistChip checklist={session.checklist} hasNotes={!!session.notes?.trim()} />
      </div>
      <div className="flex min-w-0 items-start justify-between text-[11px] text-muted-foreground/80">
        <span className="min-w-0 flex-1">
          <span className="block truncate">{activityLabel(runtime)}</span>
          {detail !== null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block truncate text-[10px] text-muted-foreground/60">{detail}</span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {fullDetail}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        <span className="ml-2 shrink-0 tabular-nums">{relativeTime(now, changedAt)}</span>
      </div>
    </div>
  )
}