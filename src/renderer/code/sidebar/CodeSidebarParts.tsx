import { FolderPlus, Settings, Tag } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'

export interface AddRepositoryButtonProps {
  readonly onClick: () => void
}

/** "Add repository": opens the folder picker and adds the git repository it returns. */
export function AddRepositoryButton({ onClick }: AddRepositoryButtonProps): ReactElement {
  return (
    <div className="px-2 pb-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        className="h-7 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium tracking-tight text-sidebar-foreground/70 hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground"
      >
        <FolderPlus className="size-4 shrink-0 text-sidebar-foreground/40" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1 text-left">Add repository</span>
      </Button>
    </div>
  )
}

/** Shown when no repository was added yet. The Add repository button above is the action. */
export function NoRepositoriesHint(): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-[12px] text-muted-foreground/70">
      Add a git repository to create worktrees.
    </div>
  )
}

export function NoMatchesHint(): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-[12px] text-muted-foreground/70">
      No repositories, worktrees or sessions match the search.
    </div>
  )
}

export interface CodeSidebarFooterProps {
  readonly onEditStatuses: () => void
  readonly onOpenSettings?: () => void
}

/** Bottom row: statuses editor and settings, as in Ops mode. */
export function CodeSidebarFooter({ onEditStatuses, onOpenSettings }: CodeSidebarFooterProps): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border px-2 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Edit statuses"
            onClick={onEditStatuses}
            className="text-muted-foreground"
          >
            <Tag className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>Statuses</TooltipContent>
      </Tooltip>
      {onOpenSettings !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Settings"
              onClick={onOpenSettings}
              className="text-muted-foreground"
            >
              <Settings className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Settings</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
