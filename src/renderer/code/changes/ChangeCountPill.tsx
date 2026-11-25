// D86: the small "N files" pill of a worktree row or session tab. Amber while some files are not reviewed yet.
import type { ReactElement } from 'react'
import { cn } from '../../lib/utils'
import { badgeTitle, changeBadge } from './changeBadge'
import type { ChangeSummary } from './changeSummaryStore'

export function ChangeCountPill({ summary }: { readonly summary: ChangeSummary }): ReactElement | null {
  const badge = changeBadge(summary.unviewed, summary.total)
  if (badge === null) return null
  return (
    <span
      data-change-badge={badge.unreviewed ? 'unreviewed' : 'reviewed'}
      title={badgeTitle(summary.unviewed, summary.total)}
      className={cn(
        'ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-4',
        badge.unreviewed ? 'bg-amber-400/20 text-amber-500' : 'bg-muted text-muted-foreground'
      )}
    >
      {badge.text}
    </span>
  )
}
