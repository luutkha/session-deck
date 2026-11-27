import { AlertTriangle, Moon, X } from 'lucide-react'
import { memo, useMemo, useRef, type HTMLAttributes, type ReactElement, type ReactNode, type MouseEvent, type Ref } from 'react'
import type { AttentionReason, Id, RuntimeState, Session, SessionActivity, StatusDef } from '../../shared/types'
import type { SelectClickModifiers } from '../state/multiSelect'
import { activityDetail, activityLabel, isSleeping } from '../state/formatTime'
import { progress } from '../notes/checklistLogic'
import { AgentBadge, sessionAgent } from '../components/AgentBadge'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { InlineEdit } from './InlineEdit'
import { lastPathSegment } from './uiLogic'
import { ChecklistChip } from '../notes/ChecklistChip'
import { AttentionBell } from '../attention/AttentionBell'
import { TagChips } from '../tags/TagChips'

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

/**
 * D88: the sidebar's "Move to Code mode…" menu entry is only for an Ops session: one with no worktree,
 * never Jarvis. Pure so the show/hide rule is unit-tested without rendering a card or a menu.
 */
export function canMoveToCode(session: Pick<Session, 'worktreeId' | 'role'>): boolean {
  return session.worktreeId === undefined && session.role !== 'jarvis'
}

/**
 * D89: the selected sessions a bulk move can take, in view order. Skips Jarvis, sessions already in Code and ids
 * that are no longer in the store; duplicates are ignored. The first id is the one the New worktree dialog moves in.
 */
export function eligibleMoveToCodeIds(sessions: readonly Session[], selectedIds: readonly Id[]): readonly Id[] {
  const byId = new Map(sessions.map((session): [Id, Session] => [session.id, session]))
  const seen = new Set<Id>()
  const eligible: Id[] = []
  for (const id of selectedIds) {
    if (seen.has(id)) continue
    const session = byId.get(id)
    if (session === undefined || !canMoveToCode(session)) continue
    seen.add(id)
    eligible.push(id)
  }
  return eligible
}

/** D89: the context-menu label: one session keeps the D88 wording, several get the count. */
export function moveToCodeLabel(count: number): string {
  return count > 1 ? `Move ${count} sessions to Code mode…` : 'Move to Code mode…'
}

export interface SessionCardOwnProps {
  readonly session: Session
  readonly status: StatusDef | null
  readonly active: boolean
  readonly runtime: RuntimeState | undefined
  /** Already-formatted "time since" label (parents own the clock), so a tick only re-renders rows whose label changed. */
  readonly relative: string
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

/** The callbacks a card needs, grouped so a section can pass one stable object to every row. */
export type SessionCardHandlers = Pick<
  SessionCardOwnProps,
  | 'onSelect'
  | 'onStartRename'
  | 'onCommitRename'
  | 'onCancelRename'
  | 'onClose'
  | 'onDragStart'
  | 'onDragOverItem'
  | 'onDropItem'
  | 'onDragEnd'
>

/**
 * Stable forwarding callbacks for the memoized card. A section re-renders on every store/runtime event and
 * builds fresh closures (they close over the current data, drag state, flat order); the card compares callback
 * identity, so it cannot receive those directly. This hook keeps the latest closures in a ref and returns one
 * object whose identity never changes: the card sees unchanged props yet always calls current code.
 */
export function useSessionCardHandlers(handlers: SessionCardHandlers): SessionCardHandlers {
  const latest = useRef(handlers)
  latest.current = handlers
  return useMemo(
    (): SessionCardHandlers => ({
      onSelect: (id, modifiers): void => latest.current.onSelect(id, modifiers),
      onStartRename: (id): void => latest.current.onStartRename(id),
      onCommitRename: (id, name): void => latest.current.onCommitRename(id, name),
      onCancelRename: (): void => latest.current.onCancelRename(),
      onClose: (id): void => latest.current.onClose(id),
      onDragStart: (id): void => latest.current.onDragStart(id),
      onDragOverItem: (id, position): void => latest.current.onDragOverItem(id, position),
      onDropItem: (): void => latest.current.onDropItem(),
      onDragEnd: (): void => latest.current.onDragEnd()
    }),
    []
  )
}

/**
 * Own props plus whatever a Radix `asChild` Slot injects (ref, onPointerDown, data-state, ...): the card spreads the
 * rest onto its root element so a ContextMenuTrigger wrapping it receives everything it expects.
 */
export type SessionCardProps = SessionCardOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, keyof SessionCardOwnProps | 'role' | 'tabIndex' | 'draggable' | 'children'> & {
    readonly ref?: Ref<HTMLDivElement>
  }

export function SessionCardView(props: SessionCardProps): ReactElement {
  const {
    session, status, active, runtime, relative, renaming,
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

  return (
    <div
      {...rest}
      role="treeitem"
      aria-selected={active || selected}
      data-session-card={session.id}
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
        <TagChips tags={session.tags ?? []} />
        <AgentBadge agent={sessionAgent(session)} cliAgent={session.cliAgent} remote={runtime?.remoteControl === true} keepAwake={session.keepAwake === true} />
        {runtime?.opencodePlugin === 'missing' ? (
          // D79: advisory only. The session still runs; its busy/idle status is simply not reported.
          <span
            role="img"
            aria-label="Status unavailable: the OpenCode plugin did not load"
            title="Status unavailable: the OpenCode plugin did not load"
            data-opencode-plugin-missing=""
            className="flex shrink-0 items-center text-muted-foreground/70"
          >
            <AlertTriangle className="size-3" aria-hidden="true" />
          </span>
        ) : null}
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
              <TooltipContent side="top" sideOffset={4}>
                {fullDetail}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        <span className="ml-2 shrink-0 tabular-nums">{relative}</span>
      </div>
    </div>
  )
}

/** Notes only ever show as a present/absent chip on the card. */
function hasNotes(session: Session): boolean {
  return (session.notes ?? '').trim().length > 0
}

/** Tags are shown as chips on the card (D86), compared by value and order. */
function sameTags(prev: readonly string[] | undefined, next: readonly string[] | undefined): boolean {
  const a = prev ?? []
  const b = next ?? []
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}

function sameSession(prev: Session, next: Session): boolean {
  if (prev === next) return true
  if (prev.id !== next.id || prev.name !== next.name || prev.cwd !== next.cwd) return false
  if (sessionAgent(prev) !== sessionAgent(next)) return false
  if ((prev.keepAwake === true) !== (next.keepAwake === true)) return false
  if (hasNotes(prev) !== hasNotes(next)) return false
  if (!sameTags(prev.tags, next.tags)) return false
  if ((prev.queue?.length ?? 0) !== (next.queue?.length ?? 0)) return false
  const before = progress(prev.checklist ?? [])
  const after = progress(next.checklist ?? [])
  return before.done === after.done && before.total === after.total
}

function sameStatus(prev: StatusDef | null, next: StatusDef | null): boolean {
  if (prev === next) return true
  if (prev === null || next === null) return false
  return prev.name === next.name && prev.color === next.color
}

function sameRuntime(prev: RuntimeState | undefined, next: RuntimeState | undefined): boolean {
  if (prev === next) return true
  if (prev === undefined || next === undefined) return false
  return (
    prev.run === next.run &&
    prev.exitCode === next.exitCode &&
    prev.attention === next.attention &&
    (prev.activity ?? null) === (next.activity ?? null) &&
    (prev.activityMessage ?? null) === (next.activityMessage ?? null) &&
    (prev.activityAt ?? null) === (next.activityAt ?? null) &&
    (prev.sleeping === true) === (next.sleeping === true) &&
    (prev.remoteControl === true) === (next.remoteControl === true) &&
    (prev.opencodePlugin ?? null) === (next.opencodePlugin ?? null)
  )
}

/**
 * Memo comparison for one session row. Every field SessionCardView renders is covered:
 * - session: id, name, cwd (folder segment + title), agent and keepAwake (AgentBadge), notes presence
 *   (notes chip), queue length (queue chip), checklist done/total (progress chip and its complete colour);
 * - status: name + colour (the dot uses the colour);
 * - runtime: run, exitCode, attention, activity, activityMessage, activityAt (activity label, detail, indicator),
 *   sleeping (moon icon + dimmed row), remoteControl (AgentBadge);
 * - the pre-formatted `relative` label (a 30 s clock tick only re-renders rows whose label changed), active,
 *   selected, renaming, groupBadge, showGroupBadge, attention, showIndicator, indicatorAriaLabel,
 *   indicatorClass, draggable, dragOver, contextMenuTrigger;
 * - the nine callbacks, kept stable by useSessionCardHandlers.
 * Deliberately not compared: what a Radix ContextMenuTrigger Slot injects (onContextMenu, pointer handlers,
 * ref, style). Those get a fresh identity on every parent render and only forward to stable Radix callbacks;
 * comparing them would defeat the memo. `data-state` is compared because it flips when the menu opens.
 */
export function sessionCardPropsEqual(prev: SessionCardProps, next: SessionCardProps): boolean {
  return (
    sameSession(prev.session, next.session) &&
    sameStatus(prev.status, next.status) &&
    sameRuntime(prev.runtime, next.runtime) &&
    prev.relative === next.relative &&
    prev.active === next.active &&
    (prev.selected ?? false) === (next.selected ?? false) &&
    prev.renaming === next.renaming &&
    prev.groupBadge === next.groupBadge &&
    prev.showGroupBadge === next.showGroupBadge &&
    prev.attention === next.attention &&
    prev.showIndicator === next.showIndicator &&
    prev.indicatorAriaLabel === next.indicatorAriaLabel &&
    prev.indicatorClass === next.indicatorClass &&
    prev.draggable === next.draggable &&
    (prev.dragOver ?? null) === (next.dragOver ?? null) &&
    prev.contextMenuTrigger === next.contextMenuTrigger &&
    prev.onSelect === next.onSelect &&
    prev.onStartRename === next.onStartRename &&
    prev.onCommitRename === next.onCommitRename &&
    prev.onCancelRename === next.onCancelRename &&
    prev.onClose === next.onClose &&
    prev.onDragStart === next.onDragStart &&
    prev.onDragOverItem === next.onDragOverItem &&
    prev.onDropItem === next.onDropItem &&
    prev.onDragEnd === next.onDragEnd &&
    (prev as { readonly 'data-state'?: unknown })['data-state'] ===
      (next as { readonly 'data-state'?: unknown })['data-state']
  )
}

/** Memoized row: a store/runtime event now re-renders only the sessions it actually changed. */
export const SessionCard = memo(SessionCardView, sessionCardPropsEqual)