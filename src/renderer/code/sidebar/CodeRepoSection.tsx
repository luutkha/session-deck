import { FolderGit2, GitBranch, Plus, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../../components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { SectionHeader } from '../../Sidebar/SectionHeader'
import { CodeWorktreeRow } from './CodeWorktreeRow'
import type { CodeRepoNode } from './codeTree'
import type { CodeTreeView } from './codeTreeView'

export interface CodeRepoSectionProps {
  readonly node: CodeRepoNode
  readonly view: CodeTreeView
}

function NewWorktreeButton({ repoName, onClick }: { readonly repoName: string; readonly onClick: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`New worktree in ${repoName}`}
          onClick={onClick}
          className="absolute right-1 top-1/2 size-5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-worktree-sidebar-accent/80 hover:text-foreground group-focus-within/repo:opacity-100 group-hover/repo:opacity-100"
        >
          <Plus className="size-3" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>New worktree</TooltipContent>
    </Tooltip>
  )
}

/** A repo header (chevron, git icon, name, worktree count) with its worktrees below it. */
export function CodeRepoSection({ node, view }: CodeRepoSectionProps): ReactElement {
  const { repo, worktrees } = node
  const { commands, handlers, searching } = view
  const collapsed = repo.collapsed && !searching
  const headerId = `code-repo-${repo.id}`

  return (
    <div role="group" aria-labelledby={headerId} data-repo-id={repo.id} className="flex flex-col gap-1 px-2 pt-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/repo relative rounded-md" title={repo.path}>
            <SectionHeader
              id={headerId}
              label={repo.name}
              count={worktrees.length}
              collapsed={collapsed}
              icon={<FolderGit2 className="size-3.5" aria-hidden="true" />}
              onToggle={(): void => void commands.toggleRepo(repo)}
            />
            <NewWorktreeButton repoName={repo.name} onClick={(): void => handlers.onNewWorktree(repo.id)} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[12rem]">
          <ContextMenuItem onSelect={(): void => handlers.onNewWorktree(repo.id)}>
            <GitBranch className="size-3.5" aria-hidden="true" />
            <span>New worktree</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={(): void => handlers.onRequestRemoveRepo(repo)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Remove repository from SessionDeck</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!collapsed && (
        <div className="flex flex-col gap-1 pl-2">
          {worktrees.length === 0 ? (
            <p className="pl-4 text-[11px] italic text-muted-foreground/60">No worktrees yet</p>
          ) : (
            worktrees.map((worktreeNode): ReactElement => (
              <CodeWorktreeRow key={worktreeNode.worktree.id} node={worktreeNode} view={view} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
