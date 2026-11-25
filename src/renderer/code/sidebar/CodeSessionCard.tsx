// Local equivalent of Sidebar/SessionCard for Code mode. Same markup and behaviour, plus a terminal icon for Shell
// sessions: SessionCard renders AgentBadge, which shows nothing for a shell, so it cannot be reused as-is.
import { Moon, SquareTerminal, X } from 'lucide-react'
import { memo, type HTMLAttributes, type MouseEvent, type ReactElement, type Ref } from 'react'
import type { Id, RuntimeState, Session, SessionActivity, StatusDef } from '../../../shared/types'
import { activityDetail, activityLabel, isSleeping, relativeTime } from '../../state/formatTime'
import { AgentBadge, sessionAgent } from '../../components/AgentBadge'
import { progress } from '../../notes/checklistLogic'
import { AttentionBell } from '../../attention/AttentionBell'
import { ChecklistChip } from '../../notes/ChecklistChip'
import { TagChips } from '../../tags/TagChips'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { InlineEdit } from '../../Sidebar/InlineEdit'
import { lastPathSegment } from '../../Sidebar/uiLogic'

const CARD_CLASSES = 'group/session relative flex flex-col gap-1 rounded-lg px-2 py-1.5 text-left outline-none select-none cursor-pointer transition-colors'
const NAME_CLASS = 'flex-1 truncate text-[13px] font-medium tracking-tight'

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

export interface CodeSessionCardOwnProps {
  readonly session: Session
  readonly status: StatusDef | null
  readonly active: boolean
  readonly runtime: RuntimeState | undefined
  readonly lastChange: number
  readonly now: number
  readonly renaming: boolean
  readonly onSelect: (id: Id) => void
  readonly onStartRename: (id: Id) => void
  readonly onCommitRename: (id: Id, name: string) => void
  readonly onCancelRename: () => void
  readonly onClose: (id: Id) => void
  /** Receives the real DOM event: a Radix ContextMenuTrigger (asChild) injects its handler through this prop. */
  readonly onContextMenu?: (event: MouseEvent<HTMLElement>) => void
}

/** Own props plus whatever a Radix `asChild` Slot injects (ref, handlers, data-state). */
export type CodeSessionCardProps = CodeSessionCardOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, keyof CodeSessionCardOwnProps | 'role' | 'tabIndex' | 'children'> & {
    readonly ref?: Ref<HTMLDivElement>
  }

function StateIndicator({ session, runtime }: { readonly session: Session; readonly runtime: RuntimeState | undefined }): ReactElement {
  const attention = runtime?.attention ?? null
  if (attention !== null) {
    // The bell wins over sleep and status; clicking it marks the session read.
    return <AttentionBell reason={attention} onMarkRead={(): void => window.api.clearAttention(session.id)} />
  }
  if (isSleeping(runtime)) {
    return (
      <span role="img" aria-label="Sleeping" className="flex size-3.5 shrink-0 items-center text-muted-foreground">
        <Moon className="size-3" aria-hidden="true" />
      </span>
    )
  }
  const activity = runtime?.activity ?? null
  if (runtime !== undefined && runtime.run !== 'exited' && activity !== null) {
    return (
      <span
        aria-label={activityDotLabel(activity)}
        className={`inline-block size-2 shrink-0 rounded-full ${activityDotClass(activity)} ${activity === 'working' ? 'motion-safe:animate-pulse' : ''}`}
      />
    )
  }
  if (runtime !== undefined) {
    const running = runtime.run === 'running'
    return (
      <span
        aria-label={running ? 'Running' : 'Exited'}
        className={`inline-block size-2 shrink-0 rounded-full ${running ? 'bg-status-success' : 'bg-destructive'}`}
      />
    )
  }
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full border border-muted-foreground/40 bg-transparent" />
}

function AgentSlot({ session, runtime }: { readonly session: Session; readonly runtime: RuntimeState | undefined }): ReactElement {
  const agent = sessionAgent(session)
  return (
    <>
      {agent === 'shell' ? (
        <span role="img" aria-label="Shell" className="flex size-3.5 shrink-0 items-center text-muted-foreground">
          <SquareTerminal className="size-3.5" aria-hidden="true" />
        </span>
      ) : null}
      <AgentBadge
        agent={agent === 'opencode' || agent === 'cursor' ? agent : 'claude'}
        remote={runtime?.remoteControl === true}
        keepAwake={session.keepAwake === true}
      />
    </>
  )
}

export function CodeSessionCardView(props: CodeSessionCardProps): ReactElement {
  const {
    session, status, active, runtime, lastChange, now, renaming,
    onSelect, onStartRename, onCommitRename, onCancelRename, onClose, onContextMenu,
    ...rest
  } = props

  const sleeping = isSleeping(runtime)
  const stateClasses = [
    active
      ? 'border border-transparent bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground shadow-sm'
      : 'border border-transparent hover:bg-worktree-sidebar-accent/50',
    sleeping ? 'opacity-60' : ''
  ]
  const folder = lastPathSegment(session.cwd)
  const detail = activityDetail(runtime)
  const fullDetail = runtime?.activityMessage?.trim() ?? ''
  const changedAt = runtime?.activityAt ?? lastChange

  return (
    <div
      {...rest}
      role="treeitem"
      aria-selected={active}
      data-session-card={session.id}
      tabIndex={-1}
      onClick={(): void => onSelect(session.id)}
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
      className={[CARD_CLASSES, ...stateClasses].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StateIndicator session={session} runtime={runtime} />
        {renaming ? (
          <InlineEdit
            value={session.name}
            ariaLabel="Session name"
            onCommit={(value): void => onCommitRename(session.id, value)}
            onCancel={onCancelRename}
          />
        ) : (
          <span className={NAME_CLASS}>{session.name}</span>
        )}
        <TagChips tags={session.tags ?? []} />
        <AgentSlot session={session} runtime={runtime} />
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100">
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
            <TooltipContent side="top" sideOffset={4}>Close session</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        {status !== null && (
          <Badge variant="dot" className="h-4 px-1.5 text-[10px] font-medium leading-none text-muted-foreground">
            <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            {status.name}
          </Badge>
        )}
        {folder.length > 0 && (
          <span className="truncate text-[11px] text-muted-foreground/70" title={session.cwd}>{folder}</span>
        )}
        <ChecklistChip checklist={session.checklist} hasNotes={!!session.notes?.trim()} queued={session.queue?.length ?? 0} />
      </div>
      <div className="flex min-w-0 items-start justify-between text-[11px] text-muted-foreground/80">
        <span className="min-w-0 flex-1">
          <span className="block truncate">{activityLabel(runtime)}</span>
          {detail !== null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block truncate text-[10px] text-muted-foreground/60">{detail}</span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>{fullDetail}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        <span className="ml-2 shrink-0 tabular-nums">{relativeTime(now, changedAt)}</span>
      </div>
    </div>
  )
}

/** Value helpers shared by the memo comparators of all three Code sidebar rows. */
export function sameCodeSession(a: Session, b: Session): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.name !== b.name || a.cwd !== b.cwd) return false
  if (sessionAgent(a) !== sessionAgent(b)) return false
  if ((a.keepAwake === true) !== (b.keepAwake === true)) return false
  if ((a.notes ?? '').trim() !== (b.notes ?? '').trim()) return false
  if ((a.queue?.length ?? 0) !== (b.queue?.length ?? 0)) return false
  const tagsA = a.tags ?? []
  const tagsB = b.tags ?? []
  if (tagsA.length !== tagsB.length || tagsA.some((tag, index): boolean => tag !== tagsB[index])) return false
  const doneA = progress(a.checklist ?? [])
  const doneB = progress(b.checklist ?? [])
  return doneA.done === doneB.done && doneA.total === doneB.total
}

export function sameCodeRuntime(a: RuntimeState | undefined, b: RuntimeState | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return (
    a.run === b.run &&
    a.exitCode === b.exitCode &&
    a.attention === b.attention &&
    (a.activity ?? null) === (b.activity ?? null) &&
    (a.activityMessage ?? null) === (b.activityMessage ?? null) &&
    (a.activityAt ?? null) === (b.activityAt ?? null) &&
    (a.sleeping === true) === (b.sleeping === true) &&
    (a.remoteControl === true) === (b.remoteControl === true) &&
    (a.opencodePlugin ?? null) === (b.opencodePlugin ?? null)
  )
}

export function sameCodeStatus(a: StatusDef | null, b: StatusDef | null): boolean {
  if (a === b) return true
  return a !== null && b !== null && a.id === b.id && a.name === b.name && a.color === b.color
}

export function sameCodeList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index): boolean => item === b[index]))
}

/**
 * Every rendered field is covered. Callbacks are compared by identity here because CodeSessionRow wraps them once
 * and forwards the latest ones through a ref; slot-injected handlers are ignored, but `data-state` is compared
 * so the card follows its context menu opening.
 */
export function codeSessionCardPropsEqual(prev: CodeSessionCardProps, next: CodeSessionCardProps): boolean {
  return (
    sameCodeSession(prev.session, next.session) &&
    sameCodeStatus(prev.status, next.status) &&
    sameCodeRuntime(prev.runtime, next.runtime) &&
    prev.lastChange === next.lastChange &&
    prev.now === next.now &&
    prev.active === next.active &&
    prev.renaming === next.renaming &&
    prev.onSelect === next.onSelect &&
    prev.onStartRename === next.onStartRename &&
    prev.onCommitRename === next.onCommitRename &&
    prev.onCancelRename === next.onCancelRename &&
    prev.onClose === next.onClose &&
    (prev as { readonly 'data-state'?: unknown })['data-state'] ===
      (next as { readonly 'data-state'?: unknown })['data-state']
  )
}

/** Memoized Code session card: a runtime batch no longer reconciles every session in every worktree. */
export const CodeSessionCard = memo(CodeSessionCardView, codeSessionCardPropsEqual)
