import { ChevronDown, ChevronRight, Copy, FolderOpen, GitBranch, Plus, Trash2 } from 'lucide-react'
import { memo, useRef, type ReactElement } from 'react'
import type { Worktree, WorktreeChanges } from '../../../shared/types'
import { countsLabel } from '../changes/changesFormat'
import { useChangeSummary } from '../changes/changeSummaryStore'
import { ChangeCountPill } from '../changes/ChangeCountPill'
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
import { sameCodeList, sameCodeRuntime, sameCodeSession } from './CodeSessionCard'
import type { CodeTreeView } from './codeTreeView'

const MINUS_SIGN = '\u2212'
const SESSIONS_INDENT_CLASS = 'flex flex-col gap-0.5 pl-3'

export interface CodeWorktreeRowProps {
  readonly node: CodeWorktreeNode
  readonly view: CodeTreeView
}

/** "+12 −3" in green and red. Renders nothing when the worktree is clean or its changes are unknown. */
function WorktreeCounts({ changes }: { readonly changes: WorktreeChanges | undefined }): ReactElement | null {
  const summary = useChangeSummary(changes?.worktreeId)
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
      {summary !== null ? <ChangeCountPill summary={summary} /> : null}
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

function sameWorktree(a: Worktree, b: Worktree): boolean {
  return (
    a === b || (
      a.id === b.id &&
      a.name === b.name &&
      a.branch === b.branch &&
      a.path === b.path &&
      a.repoId === b.repoId &&
      a.collapsed === b.collapsed &&
      (a.main === true) === (b.main === true)
    )
  )
}

/**
 * Conservative value comparison: the row's own display plus everything its session children read. A worktree that
 * (and every session in it that) is unchanged keeps its DOM across a runtime batch, while a child that did change
 * still gets a fresh view through this row.
 */
export function codeWorktreeRowPropsEqual(prev: CodeWorktreeRowProps, next: CodeWorktreeRowProps): boolean {
  const { node: a, view: av } = prev
  const { node: b, view: bv } = next
  if (!sameWorktree(a.worktree, b.worktree) || !sameCodeList(a.sessions, b.sessions)) return false
  return (
    av.now === bv.now &&
    av.activeId === bv.activeId &&
    av.renamingId === bv.renamingId &&
    av.searching === bv.searching &&
    sameCodeList(av.data.statuses, bv.data.statuses) &&
    av.data === bv.data &&
    av.actions === bv.actions &&
    av.commands === bv.commands &&
    av.handlers === bv.handlers &&
    // These two are not wrapped for the rows, and onViewChanges changes with the open view: compare identity.
    av.onForkSession === bv.onForkSession &&
    av.onViewChanges === bv.onViewChanges &&
    av.changeCounts.get(a.worktree.id) === bv.changeCounts.get(b.worktree.id) &&
    a.sessions.every((session, index): boolean => {
      const other = b.sessions[index]!
      return (
        sameCodeSession(session, other) &&
        sameCodeRuntime(av.runtime.get(session.id), bv.runtime.get(other.id)) &&
        (av.runtime.get(session.id)?.activityAt ?? av.lastChange.get(session.id) ?? session.createdAt) ===
          (bv.runtime.get(other.id)?.activityAt ?? bv.lastChange.get(other.id) ?? other.createdAt)
      )
    })
  )
  // Inline callbacks are deliberately ignored: they read the current view through the ref in the row below.
}

/** A worktree row (branch icon, name, branch, change counts) with its sessions below it. */
export function CodeWorktreeRowView(props: CodeWorktreeRowProps): ReactElement {
  // Latest props for the menu callbacks; the memo ignores their identity.
  const latest = useRef(props)
  latest.current = props
  const { node, view } = props
  const { worktree, sessions } = node
  const { changeCounts, searching } = view
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
              onClick={(): void => void latest.current.view.commands.toggleWorktree(latest.current.node.worktree)}
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
            <NewSessionButton onClick={(): void => latest.current.view.handlers.onNewSessionInWorktree(latest.current.node.worktree.id)} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[12rem]">
          <ContextMenuItem onSelect={(): void => latest.current.view.handlers.onNewSessionInWorktree(latest.current.node.worktree.id)}>
            <Plus className="size-3.5" aria-hidden="true" />
            <span>New session here</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={(): void => void latest.current.view.commands.copyPath(latest.current.node.worktree.path)}>
            <Copy className="size-3.5" aria-hidden="true" />
            <span>Copy path</span>
          </ContextMenuItem>
          {firstSession !== undefined && (
            <ContextMenuItem onSelect={(): void => void latest.current.view.commands.openFolder(firstSession.id, latest.current.node.worktree.path)}>
              <FolderOpen className="size-3.5" aria-hidden="true" />
              <span>Open folder</span>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={(): void => latest.current.view.handlers.onRequestRemoveWorktree(latest.current.node.worktree)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Remove worktree…</span>
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

/** Memoized worktree row: an unchanged worktree (and children) keeps its DOM across a runtime batch. */
export const CodeWorktreeRow = memo(CodeWorktreeRowView, codeWorktreeRowPropsEqual)
