import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { Columns2, Moon, Sun, X } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import type { Id } from '../../shared/types'
import { AgentBadge } from '../components/AgentBadge'
import { tabIndicatorFor, type TabModel } from './tabStatus'

export interface TabSplitInfo {
  /** This session is currently visible in a split pane. */
  readonly visible: boolean
  /** There is room to open another session to the side. */
  readonly canOpenToSide: boolean
  readonly onOpenToSide: (id: Id) => void
}

export interface TabProps {
  readonly tab: TabModel
  readonly active: boolean
  readonly onActivate: (id: Id) => void
  readonly onClose: (id: Id) => void
  readonly onCloseOthers: (id: Id) => void
  readonly onCloseAll: () => void
  /** Present only when split view is available. */
  readonly split?: TabSplitInfo
}

// Orca's tab surface classes (getTabRootStateClasses in tab-bar/drop-indicator.ts).
const ACTIVE_SURFACE = 'bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] text-foreground'
const INACTIVE_SURFACE = 'bg-card text-muted-foreground hover:text-foreground'
// Orca's close button states: hidden until the tab is hovered, always visible on the active tab.
const CLOSE_ACTIVE = 'text-muted-foreground hover:text-foreground hover:bg-muted'
const CLOSE_INACTIVE =
  'text-transparent group-hover:text-muted-foreground hover:!text-foreground hover:!bg-muted'
const MIDDLE_BUTTON = 1

function preventMiddleButtonScroll(event: MouseEvent<HTMLElement>): void {
  // Blocks the Windows/Linux auto-scroll cursor that a middle press would otherwise start.
  if (event.button === MIDDLE_BUTTON) {
    event.preventDefault()
  }
}

export function Tab({
  tab,
  active,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  split
}: TabProps): ReactElement {
  const indicator = tabIndicatorFor(tab.run, tab.attention)
  const activate = (): void => onActivate(tab.id)
  const close = (): void => onClose(tab.id)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          data-tab-id={tab.id}
          data-active={active}
          onClick={activate}
          onKeyDown={handleKeyDown}
          onMouseDown={preventMiddleButtonScroll}
          onAuxClick={(event: MouseEvent<HTMLDivElement>): void => {
            if (event.button === MIDDLE_BUTTON) {
              event.preventDefault()
              close()
            }
          }}
          className={cn(
            'app-no-drag group relative flex h-full w-[180px] min-w-[96px] max-w-[200px] shrink cursor-pointer select-none items-center gap-2 border-r border-border px-2.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
            active ? ACTIVE_SURFACE : INACTIVE_SURFACE
          )}
        >
          {active ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] bg-foreground"
            />
          ) : null}
          {tab.sleeping === true ? (
            <span
              role="img"
              aria-label="Sleeping"
              className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
            >
              <Moon size={12} aria-hidden="true" />
            </span>
          ) : (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  indicator.colorClass,
                  indicator.pulse && 'animate-pulse'
                )}
              />
              <span className="sr-only">{indicator.label}</span>
            </>
          )}
          <span className="min-w-0 flex-1 truncate">{tab.title}</span>
          <AgentBadge agent={tab.agent} remote={tab.remote === true} />
          {split?.visible === true ? (
            <span
              role="img"
              aria-label="Open in split view"
              className="flex shrink-0 items-center text-muted-foreground"
            >
              <Columns2 size={11} aria-hidden="true" />
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Close session"
            className={cn(
              'app-no-drag flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:text-foreground focus-visible:bg-muted',
              active ? CLOSE_ACTIVE : CLOSE_INACTIVE
            )}
            onClick={(event: MouseEvent<HTMLButtonElement>): void => {
              event.stopPropagation()
              close()
            }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {tab.sleeping === true ? (
          <ContextMenuItem onSelect={activate}>
            <Sun aria-hidden="true" />
            Wake up
          </ContextMenuItem>
        ) : tab.run === 'running' ? (
          <ContextMenuItem
            onSelect={(): void => {
              void window.api.sleepSession(tab.id).catch((): void => undefined)
            }}
          >
            <Moon aria-hidden="true" />
            Sleep
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={close}>Close session</ContextMenuItem>
        {split !== undefined ? (
          <ContextMenuItem
            disabled={!split.canOpenToSide}
            onSelect={(): void => split.onOpenToSide(tab.id)}
          >
            Open to the side
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={(): void => onCloseOthers(tab.id)}>
          Close other sessions
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>Close all in this folder</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
