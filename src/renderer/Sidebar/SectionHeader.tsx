import { ChevronDown, ChevronRight, FolderClosed } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { Badge } from '../components/ui/badge'

export interface SectionHeaderProps {
  readonly id: string
  readonly label: string
  readonly count: number
  readonly collapsed: boolean
  readonly icon?: ReactNode
  readonly leadingDot?: { color: string | null; ariaLabel: string }
  readonly onToggle: () => void
}

export function SectionHeader(props: SectionHeaderProps): ReactElement {
  const { id, label, count, collapsed, icon, leadingDot, onToggle } = props
  return (
    <button
      type="button"
      id={id}
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="group flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] font-semibold tracking-tight text-muted-foreground hover:bg-worktree-sidebar-accent/40"
    >
      {collapsed ? (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      ) : (
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      )}
      {leadingDot !== undefined && (
        <span
          aria-label={leadingDot.ariaLabel}
          aria-hidden={leadingDot.color === null ? 'true' : undefined}
          className={
            leadingDot.color === null
              ? 'inline-block size-2 shrink-0 rounded-full border border-muted-foreground/60 bg-transparent'
              : 'inline-block size-2 shrink-0 rounded-full'
          }
          style={leadingDot.color !== null ? { backgroundColor: leadingDot.color } : undefined}
        />
      )}
      {icon !== undefined && icon !== null && (
        <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && (
        <Badge
          variant="secondary"
          className="ml-auto h-4 min-w-[1rem] rounded-full px-1 text-[10px] font-medium leading-none text-muted-foreground/70"
        >
          {count}
        </Badge>
      )}
    </button>
  )
}

/** Empty placeholder rendered in the body of an empty group section. */
export function DropHereHint(): ReactElement {
  return (
    <div className="flex h-7 items-center px-6 text-[11px] italic text-muted-foreground/60">
      Drop sessions here
    </div>
  )
}

/** Convenience for the ungrouped bucket header row. */
export function UngroupedIcon(): ReactElement {
  return <FolderClosed className="size-3.5" aria-hidden="true" />
}