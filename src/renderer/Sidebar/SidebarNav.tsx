import { Bot, LayoutDashboard, Plus, Search } from 'lucide-react'
import { useEffect, useRef, type ReactElement } from 'react'
import type { Id } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'

export interface SidebarNavProps {
  readonly searchOpen: boolean
  readonly searchValue: string
  readonly onToggleSearch: () => void
  readonly onSearchChange: (value: string) => void
  readonly onClearSearch: () => void
  readonly onNewSession: (groupId?: Id | null) => void
  /** Opens the Hub board (sessions by status). Omitted = no Hub entry. */
  readonly onOpenHub?: () => void
  readonly hubActive?: boolean
  /** D53: the pinned Jarvis entry. Omitted = none. */
  readonly jarvis?: JarvisNavEntry
}

export interface JarvisNavEntry {
  /** Short state ("Ready", "Working…", "Not started"...). */
  readonly state: string
  readonly active: boolean
  readonly working: boolean
  readonly onOpen: () => void
}

const KBD = 'rounded border border-sidebar-border/80 bg-worktree-sidebar-accent px-1 py-px text-[9px] tracking-tight shadow-none'

export function SidebarNav(props: SidebarNavProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect((): void => {
    if (props.searchOpen) {
      inputRef.current?.focus()
    }
  }, [props.searchOpen])

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2 pb-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(): void => props.onNewSession()}
        className="h-7 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium tracking-tight text-sidebar-foreground/70 hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground"
      >
        <Plus className="size-4 shrink-0 text-sidebar-foreground/40" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1 text-left">New session</span>
        <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-sidebar-foreground/40">
          <span className="rounded border border-sidebar-border/80 bg-worktree-sidebar-accent px-1 py-px text-[9px] tracking-tight shadow-none">Ctrl</span>
          <span className="text-[9px]">+</span>
          <span className="rounded border border-sidebar-border/80 bg-worktree-sidebar-accent px-1 py-px text-[9px] tracking-tight shadow-none">Shift</span>
          <span className="text-[9px]">+</span>
          <span className="rounded border border-sidebar-border/80 bg-worktree-sidebar-accent px-1 py-px text-[9px] tracking-tight shadow-none">N</span>
        </span>
      </Button>
      {props.onOpenHub !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onOpenHub}
          aria-label="Open Hub"
          aria-pressed={props.hubActive === true}
          className={cn(
            'h-7 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium tracking-tight hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground',
            props.hubActive === true ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground' : 'text-sidebar-foreground/70'
          )}
        >
          <LayoutDashboard className="size-4 shrink-0 text-sidebar-foreground/40" strokeWidth={1.75} aria-hidden="true" />
          <span className="flex-1 text-left">Hub</span>
        </Button>
      )}
      {props.jarvis !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.jarvis.onOpen}
          aria-label="Open Jarvis"
          aria-pressed={props.jarvis.active}
          data-jarvis-entry=""
          title="Jarvis controls SessionDeck for you: ask it to create, sleep, wake, close sessions or send them prompts."
          className={cn(
            'h-7 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium tracking-tight hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground',
            props.jarvis.active ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground' : 'text-sidebar-foreground/70'
          )}
        >
          <Bot className={cn('size-4 shrink-0 text-sidebar-foreground/40', props.jarvis.working && 'text-sky-400 motion-safe:animate-pulse')} strokeWidth={1.75} aria-hidden="true" />
          <span className="text-left">Jarvis</span>
          <span className="truncate text-[11px] font-normal text-sidebar-foreground/40" data-jarvis-state="">{props.jarvis.state}</span>
          <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-sidebar-foreground/40">
            <span className={KBD}>Ctrl</span>
            <span className="text-[9px]">+</span>
            <span className={KBD}>Shift</span>
            <span className="text-[9px]">+</span>
            <span className={KBD}>J</span>
          </span>
        </Button>
      )}
      <div
        className={
          props.searchOpen
            ? 'flex items-center gap-2 rounded-md bg-worktree-sidebar-accent/50 px-2 py-1.5 text-[13px]'
            : 'hidden'
        }
      >
        <Search className="size-4 shrink-0 text-sidebar-foreground/40" strokeWidth={1.75} aria-hidden="true" />
        <Input
          ref={inputRef}
          value={props.searchValue}
          onChange={(event): void => props.onSearchChange(event.target.value)}
          onKeyDown={(event): void => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              props.onClearSearch()
            }
          }}
          placeholder="Search sessions"
          aria-label="Search sessions"
          className="h-6 border-0 bg-transparent px-0 py-0 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      {!props.searchOpen && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onToggleSearch}
          aria-label="Search sessions"
          className="h-7 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium tracking-tight text-sidebar-foreground/70 hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground"
        >
          <Search className="size-4 shrink-0 text-sidebar-foreground/40" strokeWidth={1.75} aria-hidden="true" />
          <span className="flex-1 text-left">Search</span>
        </Button>
      )}
    </div>
  )
}