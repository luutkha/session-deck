import {
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type Ref
} from 'react'
import { Moon } from 'lucide-react'
import type { Id, RuntimeState, Session, SessionActivity, SessionUsage } from '../../shared/types'
import type { SelectClickModifiers } from '../state/multiSelect'
import { activityDetail, activityLabel, isSleeping, relativeTime } from '../state/formatTime'
import { AgentBadge, sessionAgent } from '../components/AgentBadge'
import { Badge } from '../components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { ChecklistChip } from '../notes/ChecklistChip'
import { AttentionBell } from '../attention/AttentionBell'
import { lastPathSegment } from '../Sidebar/uiLogic'
import { formatContext, formatCost, usageLevel, type UsageLevel } from '../usage/usageLogic'
import {
  describeCardUsage,
  runIndicatorClass,
  runIndicatorLabel
} from './hubLogic'

export interface HubCardOwnProps {
  readonly session: Session
  readonly active: boolean
  readonly runtime: RuntimeState | undefined
  readonly lastChange: number
  readonly now: number
  readonly groupName: string | null
  /** Per-session usage (cost/context/model). When absent, no usage chip renders. */
  readonly usage?: SessionUsage
  readonly draggable: boolean
  /** W4: part of the bulk selection (Ctrl/Shift+click); independent of the active session. */
  readonly selected?: boolean
  readonly onOpen: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onDragStart: (id: Id) => void
  readonly onDragEnd: () => void
  /** Receives the real DOM event: a Radix ContextMenuTrigger (asChild) injects its handler through this prop. */
  readonly onContextMenu?: (event: MouseEvent<HTMLElement>) => void
}

/**
 * Own props plus whatever a Radix `asChild` Slot injects (ref, onPointerDown, data-state, ...):
 * the card spreads the rest onto its root element so a ContextMenuTrigger wrapping it receives
 * everything it expects (notably the injected `onContextMenu`, ref and pointer handlers).
 */
export type HubCardProps = HubCardOwnProps &
  Omit<
    HTMLAttributes<HTMLDivElement>,
    keyof HubCardOwnProps | 'role' | 'tabIndex' | 'draggable' | 'children'
  > & {
    readonly ref?: Ref<HTMLDivElement>
  }

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

function contextColorClass(level: UsageLevel): string {
  if (level === 'high') return 'text-[var(--destructive)]'
  if (level === 'warn') return 'text-[var(--status-warning)]'
  return ''
}

function UsageChip({ usage }: { readonly usage: SessionUsage }): ReactElement | null {
  const cost = usage.costUsd !== null ? formatCost(usage.costUsd) : ''
  const context = usage.contextPercent !== null ? formatContext(usage.contextPercent) : ''
  if (cost === '' && context === '') return null
  const level = usage.contextPercent !== null ? usageLevel(usage.contextPercent) : 'ok'
  const summary = describeCardUsage(usage)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="group"
          aria-label={summary}
          className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70"
        >
          {cost !== '' ? <span className="tabular-nums">{cost}</span> : null}
          {context !== '' ? (
            <span className={cn('tabular-nums', contextColorClass(level))}>{context}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {summary}
      </TooltipContent>
    </Tooltip>
  )
}

export function HubCard(props: HubCardProps): ReactElement {
  const {
    session,
    active,
    runtime,
    lastChange,
    now,
    groupName,
    usage,
    draggable,
    selected = false,
    onOpen,
    onDragStart,
    onDragEnd,
    onContextMenu,
    ...rest
  } = props

  const attention = runtime?.attention ?? null
  const activity = runtime?.activity ?? null
  const sleeping = isSleeping(runtime)
  const showActivity = runtime !== undefined && runtime.run !== 'exited' && activity !== null
  const detail = activityDetail(runtime)
  const fullDetail = runtime?.activityMessage?.trim() ?? ''
  const changedAt = runtime?.activityAt ?? lastChange
  const folder = lastPathSegment(session.cwd)
  const showFolder = folder.length > 0

  const classes = cn(
    'group/session relative flex flex-col gap-1 rounded-lg border border-transparent px-2 py-1.5 text-left outline-none select-none cursor-pointer transition-colors',
    'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
    active
      ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground shadow-sm'
      : 'hover:bg-worktree-sidebar-accent/50',
    selected && 'ring-1 ring-inset ring-primary/60 bg-worktree-sidebar-accent/60',
    sleeping && 'opacity-60'
  )

  return (
    <div
      {...rest}
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      aria-label={`Open session ${session.name}`}
      draggable={draggable}
      onClick={(event): void => onOpen(session.id, {
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey
      })}
      onKeyDown={(event): void => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(session.id)
        }
      }}
      onContextMenu={onContextMenu}
      onDragStart={(event): void => {
        if (!draggable) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', session.id)
        onDragStart(session.id)
      }}
      onDragEnd={(): void => onDragEnd()}
      className={classes}
    >
      <div className="flex min-w-0 items-center gap-2">
        {attention !== null ? (
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
            className={cn(
              'inline-block size-2 shrink-0 rounded-full',
              activityDotClass(activity),
              activity === 'working' && 'motion-safe:animate-pulse'
            )}
          />
        ) : runtime !== undefined ? (
          <span
            aria-label={runIndicatorLabel(runtime.run, runtime.exitCode)}
            className={cn(
              'inline-block size-2 shrink-0 rounded-full',
              runIndicatorClass(runtime.run)
            )}
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-block size-2 shrink-0 rounded-full border border-muted-foreground/40 bg-transparent"
          />
        )}
        <span className="flex-1 truncate text-[13px] font-medium tracking-tight">
          {session.name}
        </span>
        <AgentBadge agent={sessionAgent(session)} remote={runtime?.remoteControl === true} keepAwake={session.keepAwake === true} />
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        {showFolder && (
          <span className="truncate text-[11px] text-muted-foreground/70" title={session.cwd}>
            {folder}
          </span>
        )}
        <ChecklistChip checklist={session.checklist} hasNotes={!!session.notes?.trim()} />
        {usage !== undefined ? <UsageChip usage={usage} /> : null}
        {groupName !== null && (
          <Badge variant="hostContext" className="h-4 px-1.5 text-[10px] leading-none">
            {groupName}
          </Badge>
        )}
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
