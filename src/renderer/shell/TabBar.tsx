import { useEffect, useRef, type ReactElement } from 'react'
import { Columns2, LayoutDashboard, LayoutGrid, NotebookPen, PanelLeft, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { Id } from '../../shared/types'
import { Tab } from './Tab'
import { TitleBarRegion } from './TitleBarRegion'
import { WorkerTabs, type WorkerTabsProps } from '../workers/WorkerTabs'
import type { TabModel } from './tabStatus'

export interface TabBarSplit {
  /** A split layout (2+ panes) is currently shown. */
  readonly active: boolean
  /** Another session can be opened to the side. */
  readonly canSplit: boolean
  readonly visibleIds: ReadonlySet<Id>
  readonly onSplitRight: () => void
  readonly onSplitDown: () => void
  readonly onUnsplit: () => void
  readonly onOpenToSide: (id: Id) => void
}

/** Grid-view controls (D32): the preset menu opens the grid; the current preset is marked. */
export interface TabBarGrid {
  readonly active: boolean
  readonly preset: string | null
  readonly onOpenGrid: (preset: string) => void
}

export interface TabBarProps {
  readonly tabs: readonly TabModel[]
  readonly activeId: Id | null
  readonly sidebarCollapsed: boolean
  readonly onShowSidebar: () => void
  readonly onActivate: (id: Id) => void
  readonly onClose: (id: Id) => void
  readonly onCloseOthers: (id: Id) => void
  readonly onCloseAll: () => void
  readonly onNewSession: () => void
  /** Pinned Hub tab: the board of sessions by status. */
  readonly hubActive: boolean
  readonly onOpenHub: () => void
  /** Notes panel toggle for the active session (hidden when undefined). `notesBadge` is e.g. "2/5". */
  readonly onToggleNotes?: () => void
  readonly notesOpen?: boolean
  readonly notesBadge?: string | null
  /** Split-view controls (hidden when undefined). */
  readonly split?: TabBarSplit
  /** Grid-view controls (hidden when undefined) — D32. */
  readonly grid?: TabBarGrid
  /** Read-only tabs for the OpenCode workers of the active session (hidden when undefined or empty). */
  readonly workers?: WorkerTabsProps
}

function findTabElement(strip: HTMLElement | null, id: Id): HTMLElement | null {
  return strip?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`) ?? null
}

export function TabBar(props: TabBarProps): ReactElement {
  const { tabs, activeId, sidebarCollapsed, onShowSidebar, onNewSession } = props
  const stripRef = useRef<HTMLDivElement | null>(null)

  // Keep the active tab visible when it changes (keyboard cycling, new tabs, sidebar picks).
  useEffect((): void => {
    if (activeId === null) {
      return
    }
    findTabElement(stripRef.current, activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <TitleBarRegion
      reserveWindowControls
      className="flex h-9 shrink-0 items-stretch border-b border-border bg-card"
    >
      {sidebarCollapsed ? (
        <div className="app-no-drag flex shrink-0 items-center pl-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label="Show sidebar"
                onClick={onShowSidebar}
              >
                <PanelLeft size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Show sidebar
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
      <button
        type="button"
        aria-pressed={props.hubActive}
        aria-label="Hub"
        onClick={props.onOpenHub}
        className={cn(
          'app-no-drag flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
          props.hubActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <LayoutDashboard className="size-3.5" aria-hidden="true" />
        Hub
      </button>
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Open sessions"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab: TabModel): ReactElement => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onActivate={props.onActivate}
            onClose={props.onClose}
            onCloseOthers={props.onCloseOthers}
            onCloseAll={props.onCloseAll}
            split={
              props.split === undefined
                ? undefined
                : {
                    visible: props.split.visibleIds.has(tab.id),
                    canOpenToSide: props.split.canSplit,
                    onOpenToSide: props.split.onOpenToSide
                  }
            }
          />
        ))}
        {props.workers !== undefined ? <WorkerTabs {...props.workers} /> : null}
      </div>
      {props.onToggleNotes !== undefined && (
        <div className="app-no-drag flex shrink-0 items-center gap-1 px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className={cn('gap-1 px-1.5 text-muted-foreground', props.notesOpen === true && 'bg-accent text-foreground')}
                aria-label="Notes and checklist"
                aria-pressed={props.notesOpen === true}
                onClick={props.onToggleNotes}
              >
                <NotebookPen size={14} aria-hidden="true" />
                {props.notesBadge ? <span className="text-[11px] tabular-nums">{props.notesBadge}</span> : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Notes and checklist
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      {props.grid !== undefined && (
        <div className="app-no-drag flex shrink-0 items-center px-0.5">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'text-muted-foreground',
                      props.grid.active && 'bg-accent text-foreground'
                    )}
                    aria-label="Grid view"
                    aria-pressed={props.grid.active}
                  >
                    <LayoutGrid size={14} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Grid view
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              {(['1x1', '2x1', '1x2', '2x2', '2x3', '3x2'] as const).map((preset) => (
                <DropdownMenuItem
                  key={preset}
                  data-grid-preset={preset}
                  disabled={props.grid?.preset === preset && props.grid?.active === true}
                  onSelect={(): void => props.grid?.onOpenGrid(preset)}
                >
                  {preset}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {props.split !== undefined && (
        <div className="app-no-drag flex shrink-0 items-center px-0.5">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'text-muted-foreground',
                      props.split.active && 'bg-accent text-foreground'
                    )}
                    aria-label="Split view"
                    aria-pressed={props.split.active}
                  >
                    <Columns2 size={14} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Split view
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!props.split.canSplit}
                onSelect={props.split.onSplitRight}
              >
                Split right
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!props.split.canSplit} onSelect={props.split.onSplitDown}>
                Split down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!props.split.active} onSelect={props.split.onUnsplit}>
                Unsplit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="app-no-drag flex shrink-0 items-center px-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="New session"
              onClick={onNewSession}
            >
              <Plus size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            New session
          </TooltipContent>
        </Tooltip>
      </div>
    </TitleBarRegion>
  )
}
