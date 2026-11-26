// D60: the git part of the Changes panel: branch line (ahead/behind, Push, Create PR, Merge), the commit box, the
// last result, and the confirm step (Create PR asks for a title and body when the GitHub CLI makes it).
import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, LoaderCircle, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import { aheadBehindLabel, commitCandidates, commitState, mergeState, pullRequestState, pullState, pushState, type ActionState } from './gitActionsLogic'
import type { GitAction, GitActions } from './useGitActions'
import type { WorktreeChanges } from '../../../shared/types'

function ActionButton({ state, label, icon, action, onClick }: {
  readonly state: ActionState
  readonly label: string
  readonly icon: ReactElement
  readonly action: string
  readonly onClick: () => void
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span keeps the tooltip working on a disabled button. */}
        <span className="inline-flex">
          <Button type="button" variant="ghost" size="xs" disabled={!state.enabled} data-git-action={action} aria-label={label} onClick={onClick} className="text-[11px]">
            {icon}
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>{state.hint}</TooltipContent>
    </Tooltip>
  )
}

function BranchLine({ git }: { readonly git: GitActions }): ReactElement {
  const { status, busy } = git
  const merge = mergeState(status, busy)
  const counts = aheadBehindLabel(status)
  return (
    <div data-git-branch-line className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-border px-2 py-1">
      <span className="flex min-w-0 flex-1 items-center gap-1 px-1 text-[11px] text-muted-foreground">
        <GitBranch className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono" data-git-branch title={status?.branch ?? undefined}>{status?.branch ?? "…"}</span>
        {counts.length > 0 ? <span className="shrink-0 font-mono tabular-nums text-foreground/80" data-git-counts>{counts}</span> : null}
      </span>
      <ActionButton state={pullState(status, busy)} label="Pull" action="pull" icon={<ArrowDownToLine aria-hidden="true" />} onClick={(): void => { void git.pull() }} />
      <ActionButton state={pushState(status, busy)} label="Push" action="push" icon={<ArrowUpFromLine aria-hidden="true" />} onClick={(): void => git.ask('push')} />
      <ActionButton state={pullRequestState(status, busy)} label="Create PR" action="pr" icon={<GitPullRequest aria-hidden="true" />} onClick={(): void => git.ask('pr')} />
      {merge !== null ? (
        <ActionButton state={merge} label="Merge" action="merge" icon={<GitMerge aria-hidden="true" />} onClick={(): void => git.ask('merge')} />
      ) : null}
    </div>
  )
}

function CommitBox({ git, changes }: { readonly git: GitActions; readonly changes: WorktreeChanges | null }): ReactElement | null {
  const candidates = commitCandidates(changes).length
  if (candidates === 0) return null
  const state = commitState(git.message, git.chosen.length, git.busy)
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (state.enabled) void git.commit()
    }
  }
  return (
    <div data-git-commit-box className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2 py-2">
      <Textarea
        aria-label="Commit message"
        data-git-message
        placeholder="Commit message"
        value={git.message}
        onChange={(event): void => git.setMessage(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        className="min-h-[52px] resize-y text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground" data-git-chosen>
          {git.chosen.length} of {candidates} uncommitted file{candidates === 1 ? '' : 's'}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button type="button" size="xs" disabled={!state.enabled} data-git-action="commit" onClick={(): void => void git.commit()}>
                {git.busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <GitCommitHorizontal aria-hidden="true" />}
                Commit
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>{state.hint}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function Notice({ git, onOpenUrl }: { readonly git: GitActions; readonly onOpenUrl?: (url: string) => void }): ReactElement | null {
  const notice = git.notice
  if (notice === null) return null
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      data-git-notice={notice.kind}
      className={cn('flex shrink-0 items-start gap-1.5 border-b border-border px-3 py-1.5 text-[11px]', notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}
    >
      <span className="min-w-0 flex-1 break-words">
        {notice.text}
        {notice.url !== undefined && onOpenUrl !== undefined ? (
          <button
            type="button"
            data-git-notice-link
            className="ml-1 inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
            onClick={(): void => onOpenUrl(notice.url as string)}
          >
            Open <ExternalLink className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </span>
      <button type="button" aria-label="Dismiss" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={git.dismissNotice}>
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  )
}

const CONFIRM_COPY: Record<GitAction, { readonly title: string; readonly label: string }> = {
  push: { title: 'Push branch', label: 'Push' },
  pr: { title: 'Create pull request', label: 'Create PR' },
  merge: { title: 'Merge into base', label: 'Merge' }
}

function confirmText(git: GitActions, action: GitAction): string {
  const s = git.status
  const branch = s?.branch ?? 'this branch'
  if (action === 'push') return `Push ${branch} to ${s?.remote ?? 'the remote'} (${s?.ahead ?? 0} commit${s?.ahead === 1 ? '' : 's'})? SessionDeck never force-pushes.`
  if (action === 'merge') return `Merge ${branch} into ${s?.baseBranch ?? 'the base branch'} in the repository folder? A conflict is undone at once and nothing changes.`
  const push = s !== null && (s.upstream === null || s.ahead > 0) ? `Push ${branch} first, then ` : ''
  return s?.ghReady === true
    ? `${push}create a pull request from ${branch} into ${s.baseBranch} with the GitHub CLI.`
    : `${push}open the new pull request page for ${branch} → ${s?.baseBranch ?? 'base'} in your browser. You finish it there.`
}

function ConfirmStep({ git }: { readonly git: GitActions }): ReactElement | null {
  const action = git.confirming
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  useEffect((): void => {
    setTitle('')
    setBody('')
  }, [action])
  if (action === null) return null
  const copy = CONFIRM_COPY[action]
  const askPr = action === 'pr' && git.status?.ghReady === true
  return (
    <Dialog open onOpenChange={(open): void => { if (!open) git.cancel() }}>
      <DialogContent className="max-w-md sm:max-w-md" data-git-confirm={action}>
        <DialogHeader>
          <DialogTitle className="text-sm">{copy.title}</DialogTitle>
          <DialogDescription className="text-xs">{confirmText(git, action)}</DialogDescription>
        </DialogHeader>
        {askPr ? (
          <div className="flex flex-col gap-2">
            <Input aria-label="Pull request title" placeholder="Title (default: the last commit)" value={title} onChange={(e): void => setTitle(e.target.value)} className="text-xs" />
            <Textarea aria-label="Pull request description" placeholder="Description (default: the list of commits)" value={body} onChange={(e): void => setBody(e.target.value)} rows={4} className="text-xs" />
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={git.cancel}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            className="text-xs"
            data-git-confirm-ok
            onClick={(): void => void git.confirm(askPr ? { title, body } : undefined)}
          >
            {copy.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Branch line, result line and commit box above the file list, plus the confirm step. */
export function GitSection({ git, changes, onOpenUrl }: {
  readonly git: GitActions
  readonly changes: WorktreeChanges | null
  /** Opens a web page (the created PR); absent = no Open link. */
  readonly onOpenUrl?: (url: string) => void
}): ReactElement {
  return (
    <>
      <BranchLine git={git} />
      <Notice git={git} onOpenUrl={onOpenUrl} />
      <CommitBox git={git} changes={changes} />
      <ConfirmStep git={git} />
    </>
  )
}
