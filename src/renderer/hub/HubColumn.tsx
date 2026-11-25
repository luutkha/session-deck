import { useMemo, useRef, type DragEvent as ReactDragEvent, type ReactElement } from 'react'
import { Plus } from 'lucide-react'
import type { Id, RuntimeState, Session, SessionUsage, StatusDef, StoreData } from '../../shared/types'
import type { SelectClickModifiers } from '../state/multiSelect'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { HubCard } from './HubCard'
import { HubCardMenu } from './HubCardMenu'
import { computeStatusDrop, effectiveStatusIdOf } from './hubLogic'

export interface HubColumnProps {
  readonly status: StatusDef | null
  readonly sessions: readonly Session[]
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastChange: ReadonlyMap<Id, number>
  readonly sessionUsage: ReadonlyMap<Id, SessionUsage>
  readonly now: number
  readonly activeId: Id | null
  readonly draggedSessionId: Id | null
  readonly isDropTarget: boolean
  readonly selectedIds: ReadonlySet<Id>
  readonly onOpen: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onSetStatus: (id: Id, statusId: Id | null) => void
  readonly onNewSession: (statusId: Id | null) => void
  readonly onDragStartSession: (id: Id) => void
  readonly onDragEndSession: () => void
  readonly onDragOverColumn: (statusId: Id | null) => void
  readonly onDragLeaveColumn: (statusId: Id | null) => void
  readonly onDropOnColumn: (statusId: Id | null) => void
}

export function HubColumn(props: HubColumnProps): ReactElement {
  const {
    status,
    sessions,
    data,
    runtime,
    lastChange,
    sessionUsage,
    now,
    activeId,
    draggedSessionId,
    isDropTarget,
    selectedIds,
    onOpen,
    onSetStatus,
    onNewSession,
    onDragStartSession,
    onDragEndSession,
    onDragOverColumn,
    onDragLeaveColumn,
    onDropOnColumn
  } = props

  const statusId = status?.id ?? null
  const label = status?.name ?? 'No status'
  const canDrop =
    draggedSessionId !== null && computeStatusDrop(draggedSessionId, statusId, data) !== null
  const highlight = isDropTarget && canDrop

  function handleDragOver(event: ReactDragEvent<HTMLElement>): void {
    if (!canDrop) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    onDragOverColumn(statusId)
  }

  function handleDragLeave(event: ReactDragEvent<HTMLElement>): void {
    const next = event.relatedTarget as Node | null
    if (next !== null && event.currentTarget.contains(next)) return
    onDragLeaveColumn(statusId)
  }

  function handleDrop(event: ReactDragEvent<HTMLElement>): void {
    if (!canDrop) return
    event.preventDefault()
    event.stopPropagation()
    onDropOnColumn(statusId)
  }

  return (
    <section
      role="group"
      aria-label={`${label}, ${sessions.length} sessions`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex h-full min-h-0 w-[280px] min-w-[260px] max-w-[320px] shrink-0 flex-col rounded-xl border border-border bg-card/40 transition-colors',
        highlight && 'bg-accent/20 ring-1 ring-primary/40'
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-2 shrink-0 rounded-full',
            status === null && 'border border-muted-foreground/60 bg-transparent'
          )}
          style={status !== null ? { backgroundColor: status.color } : undefined}
        />
        <span className="flex-1 truncate text-[12px] font-semibold tracking-tight text-muted-foreground">
          {label}
        </span>
        <Badge
          variant="secondary"
          className="h-4 min-w-[1rem] rounded-full px-1 text-[10px] font-medium leading-none text-muted-foreground/70"
        >
          {sessions.length}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`New session in ${label}`}
              onClick={(): void => onNewSession(statusId)}
              className="size-5 text-muted-foreground hover:bg-worktree-sidebar-accent/80 hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            New session in {label}
          </TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col gap-1 p-2">
          {sessions.map((session) => (
            <HubCardRow
              key={session.id}
              session={session}
              statuses={data.statuses}
              currentStatusId={effectiveStatusIdOf(session, data)}
              state={runtime.get(session.id)}
              lastChangeValue={lastChange.get(session.id) ?? session.createdAt}
              usage={sessionUsage.get(session.id)}
              now={now}
              groupName={groupNameFor(session.groupId, data)}
              active={activeId === session.id}
              selected={selectedIds.has(session.id)}
              onOpen={onOpen}
              onSetStatus={onSetStatus}
              onDragStartSession={onDragStartSession}
              onDragEndSession={onDragEndSession}
            />
          ))}
          {sessions.length === 0 && (
            <div className="flex min-h-16 flex-1 items-center justify-center rounded-lg border border-dashed border-border px-2 py-4 text-[11px] italic text-muted-foreground/60">
              Drop sessions here
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  )
}

function groupNameFor(groupId: Id | null, data: StoreData): string | null {
  if (groupId === null) return null
  return data.groups.find((group) => group.id === groupId)?.name ?? null
}

interface HubCardRowProps {
  readonly session: Session
  readonly statuses: readonly StatusDef[]
  readonly currentStatusId: Id | null
  readonly state: RuntimeState | undefined
  readonly lastChangeValue: number
  readonly usage: SessionUsage | undefined
  readonly now: number
  readonly groupName: string | null
  readonly active: boolean
  readonly selected: boolean
  readonly onOpen: (id: Id, modifiers?: SelectClickModifiers) => void
  readonly onSetStatus: (id: Id, statusId: Id | null) => void
  readonly onDragStartSession: (id: Id) => void
  readonly onDragEndSession: () => void
}

/**
 * One row of the board. This component is deliberately NOT memoized: it re-renders on every store publish and
 * refreshes the ref below, while the memoized card and menu keep their callback identities. Without the ref a
 * bailed-out card would call the closure from its first render (stale session id / keep-awake flag).
 */
function HubCardRow(props: HubCardRowProps): ReactElement {
  const {
    session, statuses, currentStatusId, state, lastChangeValue, usage, now, groupName,
    active, selected, onOpen, onSetStatus, onDragStartSession, onDragEndSession
  } = props

  const latest = useRef({ session, onOpen, onSetStatus, onDragStartSession, onDragEndSession })
  latest.current = { session, onOpen, onSetStatus, onDragStartSession, onDragEndSession }
  const handlers = useMemo(() => ({
    onSelect: (id: Id, modifiers?: SelectClickModifiers): void => latest.current.onOpen(id, modifiers),
    onDragStart: (id: Id): void => latest.current.onDragStartSession(id),
    onDragEnd: (): void => latest.current.onDragEndSession(),
    menuOpen: (): void => {
      const current = latest.current
      current.onOpen(current.session.id)
    },
    menuSetStatus: (statusId: Id | null): void => {
      const current = latest.current
      current.onSetStatus(current.session.id, statusId)
    },
    menuSleep: (): void => {
      void window.api.sleepSession(latest.current.session.id).catch((): void => undefined)
    },
    menuToggleKeepAwake: (): void => {
      const current = latest.current.session
      void window.api.setKeepAwake(current.id, current.keepAwake !== true).catch((): void => undefined)
    }
  }), [])

  return (
    <HubCardMenu
      statuses={statuses}
      currentStatusId={currentStatusId}
      sleeping={state?.sleeping === true}
      canSleep={state?.run === 'running' && state?.sleeping !== true}
      keepAwake={session.keepAwake === true}
      onOpen={handlers.menuOpen}
      onSetStatus={handlers.menuSetStatus}
      onSleep={handlers.menuSleep}
      onToggleKeepAwake={handlers.menuToggleKeepAwake}
    >
      <HubCard
        session={session}
        active={active}
        runtime={state}
        lastChange={lastChangeValue}
        usage={usage}
        now={now}
        groupName={groupName}
        draggable={true}
        selected={selected}
        onOpen={handlers.onSelect}
        onDragStart={handlers.onDragStart}
        onDragEnd={handlers.onDragEnd}
      />
    </HubCardMenu>
  )
}
