import { ChevronDown, ChevronRight, Copy, FolderOpen, GitBranch, Plus, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { WorktreeChanges } from '../../../shared/types'
import { countsLabel } from '../changes/changesFormat'
import { Button } from '../../components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../../components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import type { CodeWorktreeNode } from './codeTree'
import { CodeSessionRow } from './CodeSessionRow'
import type { CodeTreeView } from './codeTreeView'

const MINUS_SIGN = '\u2212'
const SESSIONS_INDENT_CLASS = 'flex flex-col gap-0.5 pl-3'

export interface CodeWorktreeRowProps {
  readonly node: CodeWorktreeNode
  readonly view: CodeTreeView
}

/** "+12 −3" in green and red. Renders nothing when the worktree is clean or its changes are unknown. */
function WorktreeCounts({ changes }: { readonly changes: WorktreeChanges | undefined }): ReactElement | null {
  if (changes === undefined || changes.error !== undefined || changes.files.length === 0) {
    return null
  }
  return (
    <span
      data-worktree-counts={`${String(changes.additions)}:${String(changes.deletions)}`}
      title={countsLabel(changes)}
      className="ml-auto shrink-0 pr-7 text-[11px] tabular-nums"
    >
      <span className="text-status-success">+{changes.additions}</span>{' '}
      <span className="text-destructive">{MINUS_SIGN}{changes.deletions}</span>
    </span>
  )
}

function NewSessionButton({ onClick }: { readonly onClick: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="New session in this worktree"
          onClick={onClick}
          className="absolute right-1 top-1/2 size-5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-worktree-sidebar-accent/80 hover:text-foreground group-focus-within/wt:opacity-100 group-hover/wt:opacity-100"
        >
          <Plus className="size-3" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>New session in this worktree</TooltipContent>
    </Tooltip>
  )
}

/** A worktree row (branch icon, name, branch, change counts) with its sessions below it. */
export function CodeWorktreeRow({ node, view }: CodeWorktreeRowProps): ReactElement {
  const { worktree, sessions } = node
  const { commands, handlers, changeCounts, searching } = view
  const collapsed = worktree.collapsed && !searching
  const firstSession = sessions[0]
  const showBranch = worktree.branch !== worktree.name

  return (
    <div role="group" aria-label={worktree.name} data-worktree-id={worktree.id} className="flex flex-col gap-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/wt relative flex h-7 min-w-0 items-center rounded-md hover:bg-worktree-sidebar-accent/40">
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={(): void => void commands.toggleWorktree(worktree)}
              className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left text-[12px] tracking-tight text-foreground/80"
            >
              {collapsed ? (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              )}
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium">{worktree.name}</span>
              {worktree.main === true && (
                <span data-repo-folder="" title="The repository folder itself (no new branch)" className="shrink-0 rounded-sm border border-border px-1 text-[10px] text-muted-foreground">
                  repo folder
                </span>
              )}
              {showBranch && (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground/60">{worktree.branch}</span>
              )}
              <WorktreeCounts changes={changeCounts.get(worktree.id)} />
            </button>
            <NewSessionButton onClick={(): void => handlers.onNewSessionInWorktree(worktree.id)} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[12rem]">
          <ContextMenuItem onSelect={(): void => handlers.onNewSessionInWorktree(worktree.id)}>
            <Plus className="size-3.5" aria-hidden="true" />
            <span>New session here</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={(): void => void commands.copyPath(worktree.path)}>
            <Copy className="size-3.5" aria-hidden="true" />
            <span>Copy path</span>
          </ContextMenuItem>
          {firstSession !== undefined && (
            <ContextMenuItem onSelect={(): void => void commands.openFolder(firstSession.id, worktree.path)}>
              <FolderOpen className="size-3.5" aria-hidden="true" />
              <span>Open folder</span>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={(): void => handlers.onRequestRemoveWorktree(worktree)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Remove worktree from SessionDeck</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!collapsed && (
        <div className={SESSIONS_INDENT_CLASS}>
          {sessions.map((session): ReactElement => (
            <CodeSessionRow key={session.id} session={session} view={view} />
          ))}
        </div>
      )}
    </div>
  )
}
