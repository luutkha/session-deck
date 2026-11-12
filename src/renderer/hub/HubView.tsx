import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Plus, Search, Tag } from 'lucide-react'
import type { Id, QueuedPrompt, RuntimeState, SessionUsage, StoreData } from '../../shared/types'
import { useSharedNow } from '../state/useClock'
import { BulkActionBar } from '../components/BulkActionBar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { TooltipProvider } from '../components/ui/tooltip'
import { useMultiSelect } from '../state/useMultiSelect'
import { useBulkActions } from '../state/useBulkActions'
import { orderSectionSessions } from '../state/selectors'
import { sortSessions, type SessionSort } from '../state/sessionSort'
import { useSortFreeze } from '../state/useSessionSort'
import { formatCost } from '../usage/usageLogic'
import { HubColumn } from './HubColumn'
import {
  buildColumns,
  busiestColumnIndex,
  closedSessions,
  computeStatusDrop,
  hubColumnKey,
  hubTotals,
  totalCost
} from './hubLogic'

export interface HubViewProps {
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastChange: ReadonlyMap<Id, number>
  readonly activeId: Id | null
  /** D61: the sidebar sort; Manual keeps the Hub's own order (most recent activity first). */
  readonly sort?: SessionSort
  /** Per-session usage (cost/context/model). When absent, cards show no usage chip. */
  readonly sessionUsage?: ReadonlyMap<Id, SessionUsage>
  readonly onOpenSession: (id: Id) => void
  readonly onSetStatus: (id: Id, statusId: Id | null) => void
  /** W4 bulk actions: the board needs the same per-session operations as the sidebar. */
  readonly onSleepSession: (id: Id) => Promise<void>
  readonly onMoveSession: (id: Id, groupId: Id | null, index: number) => Promise<void>
  /** D48: the bulk Prompt action adds to each selected session's queue. */
  readonly onSetQueue: (id: Id, items: readonly QueuedPrompt[]) => Promise<void>
  readonly onNewSession: (statusId: Id | null) => void
  readonly onEditStatuses: () => void
  readonly onReopen: (id: Id) => void
  /** Settings > Hub: when the Hub opens, scroll the board to the status column with the most sessions. */
  readonly scrollToBusiest?: boolean
  /** D51: the header total opens the cost report. */
  readonly onShowCosts?: () => void
}

interface DropTarget {
  readonly statusId: Id | null
}

const NOW_REFRESH_MS = 30_000
const EMPTY_USAGE: ReadonlyMap<Id, SessionUsage> = new Map()

/** Scrolls the board so `column` is in view, left-aligned; a column that is already fully visible stays put. */
function scrollColumnIntoView(board: HTMLElement, column: HTMLElement): void {
  const boardRect = board.getBoundingClientRect()
  const columnRect = column.getBoundingClientRect()
  if (columnRect.left >= boardRect.left && columnRect.right <= boardRect.right) return
  const padding = Number.parseFloat(getComputedStyle(board).paddingLeft) || 0
  board.scrollLeft += columnRect.left - boardRect.left - padding
}

export function HubView(props: HubViewProps): ReactElement {
  const {
    data,
    runtime,
    lastChange,
    activeId,
    sessionUsage,
    onOpenSession,
    onSetStatus,
    onSleepSession,
    onMoveSession,
    onSetQueue,
    onNewSession,
    onEditStatuses,
    onReopen,
    scrollToBusiest = false,
    onShowCosts,
    sort = 'manual'
  } = props

  const [query, setQuery] = useState('')
  const now = useSharedNow(NOW_REFRESH_MS)
  const [draggedSessionId, setDraggedSessionId] = useState<Id | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const sortFreeze = useSortFreeze(data.sessions, sort, runtime)
  const columns = useMemo(
    (): ReturnType<typeof buildColumns> => {
      const built = buildColumns(data, query, lastChange)
      return sort === 'manual' ? built : orderSectionSessions(built, (sessions) => sortSessions(sessions, sort, runtime, sortFreeze.frozen))
    },
    [data, query, lastChange, sort, runtime, sortFreeze.frozen]
  )
  const boardRef = useRef<HTMLDivElement | null>(null)
  // Only when the Hub opens (this view mounts each time), never while the user works in it.
  const openColumnsRef = useRef(columns)
  const scrollOnOpenRef = useRef(scrollToBusiest)
  useEffect((): void => {
    const board = boardRef.current
    if (!scrollOnOpenRef.current || board === null) return
    const index = busiestColumnIndex(openColumnsRef.current)
    const column = index === null ? undefined : board.children.item(index)
    if (column instanceof HTMLElement) scrollColumnIntoView(board, column)
  }, [])
  const totals = useMemo(() => hubTotals(data, runtime), [data, runtime])
  const closed = useMemo(() => closedSessions(data), [data])
  const usage = sessionUsage ?? EMPTY_USAGE
  const total = useMemo(() => totalCost(data.sessions, usage), [data.sessions, usage])

  // W4 bulk selection over the board order (No status first, then status columns, activity order).
  const hubOrder = useMemo(
    (): readonly Id[] => columns.flatMap((column): readonly Id[] => column.sessions.map((session) => session.id)),
    [columns]
  )
  const multi = useMultiSelect(hubOrder, onOpenSession)
  // onSetStatus is fire-and-forget here (its errors go to the store banner), as with a single card.
  const bulk = useBulkActions(multi.selectedIds, data.sessions, runtime, {
    sleep: onSleepSession,
    wake: onOpenSession,
    setStatus: onSetStatus,
    move: onMoveSession,
    setQueue: onSetQueue
  })

  const handleDragStartSession = useCallback((id: Id): void => {
    setDraggedSessionId(id)
  }, [])

  const handleDragEndSession = useCallback((): void => {
    setDraggedSessionId(null)
    setDropTarget(null)
  }, [])

  const handleDragOverColumn = useCallback((statusId: Id | null): void => {
    setDropTarget((prev): DropTarget | null =>
      prev !== null && prev.statusId === statusId ? prev : { statusId }
    )
  }, [])

  const handleDragLeaveColumn = useCallback((statusId: Id | null): void => {
    setDropTarget((prev): DropTarget | null =>
      prev !== null && prev.statusId === statusId ? null : prev
    )
  }, [])

  const handleDropOnColumn = useCallback(
    (statusId: Id | null): void => {
      const draggedId = draggedSessionId
      setDropTarget(null)
      setDraggedSessionId(null)
      if (draggedId === null) return
      const action = computeStatusDrop(draggedId, statusId, data)
      if (action !== null) onSetStatus(action.sessionId, action.statusId)
    },
    [data, draggedSessionId, onSetStatus]
  )

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight">Hub</h1>
            <p className="truncate text-[12px] text-muted-foreground">
              {totals.sessions} sessions, {totals.needAttention} need attention
              {total > 0 ? ' · ' : ''}
              {total > 0 && onShowCosts !== undefined ? (
                <button
                  type="button"
                  data-hub-total-cost=""
                  title="Open the cost report"
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  onClick={onShowCosts}
                >
                  {`Total ${formatCost(total)}`}
                </button>
              ) : total > 0 ? `Total ${formatCost(total)}` : ''}
            </p>
          </div>
          <div className="relative ml-auto w-56 max-w-full shrink-0">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event): void => setQuery(event.target.value)}
              placeholder="Search sessions"
              aria-label="Search sessions"
              className="h-8 pl-8 text-[12px]"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEditStatuses}
            className="shrink-0 text-muted-foreground"
          >
            <Tag className="size-3.5" aria-hidden="true" />
            Statuses
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={(): void => onNewSession(null)}
            className="shrink-0"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            New session
          </Button>
        </header>

        <div
          ref={boardRef}
          data-hub-board=""
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
          onPointerEnter={sortFreeze.onPointerEnter}
          onPointerLeave={sortFreeze.onPointerLeave}
        >
          {columns.map((column) => {
            const statusId = column.status?.id ?? null
            return (
              <HubColumn
                key={hubColumnKey(column.status)}
                status={column.status}
                sessions={column.sessions}
                data={data}
                runtime={runtime}
                lastChange={lastChange}
                sessionUsage={usage}
                now={now}
                activeId={activeId}
                draggedSessionId={draggedSessionId}
                isDropTarget={dropTarget !== null && dropTarget.statusId === statusId}
                selectedIds={multi.selection.ids}
                onOpen={multi.handleClick}
                onSetStatus={onSetStatus}
                onNewSession={onNewSession}
                onDragStartSession={handleDragStartSession}
                onDragEndSession={handleDragEndSession}
                onDragOverColumn={handleDragOverColumn}
                onDragLeaveColumn={handleDragLeaveColumn}
                onDropOnColumn={handleDropOnColumn}
              />
            )
          })}
        </div>

        {multi.selectedIds.length > 0 && (
          <div className="shrink-0 border-t border-border px-3 py-2">
            <BulkActionBar
              count={multi.selectedIds.length}
              sleepCount={bulk.sleepIds.length}
              wakeCount={bulk.wakeIds.length}
              statuses={data.statuses}
              groups={data.groups}
              busy={bulk.busy}
              onSleep={bulk.sleep}
              onWake={bulk.wake}
              onSetStatus={bulk.setStatus}
              onMoveToGroup={bulk.moveToGroup}
              promptPlan={bulk.promptPlan}
              onSendPrompt={bulk.sendPrompt}
              onClear={multi.clear}
            />
          </div>
        )}

        {closed.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="shrink-0 font-medium">Closed ({closed.length})</span>
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Closed sessions">
              {closed.map((session) => (
                <li
                  key={session.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 py-0.5 pl-2 pr-1"
                >
                  <span className="max-w-[12rem] truncate" title={session.name}>
                    {session.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={(): void => onReopen(session.id)}
                    aria-label={`Resume ${session.name}`}
                    className="h-5 px-1.5 text-[10px]"
                  >
                    Resume
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
