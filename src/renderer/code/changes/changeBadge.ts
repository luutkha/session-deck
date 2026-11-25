// Pure logic for the changed-files tab badge (Code mode, D31 scope): a red badge counts files the
// user has not reviewed; once all are reviewed the plain count stays visible.

export interface ChangeBadge {
  readonly text: string
  readonly unreviewed: boolean
}

/** Above this, the exact count is noise. */
const BADGE_MAX = 99

function badgeText(count: number): string {
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count)
}

/** null hides the badge when the worktree has no changes. */
export function changeBadge(unviewed: number, total: number): ChangeBadge | null {
  if (total <= 0) return null
  if (unviewed > 0) return { text: badgeText(unviewed), unreviewed: true }
  return { text: badgeText(total), unreviewed: false }
}

/** Tooltip spell-out of the same state, with singular/plural agreement. */
export function badgeTitle(unviewed: number, total: number): string {
  if (total <= 0) return ''
  const noun = total === 1 ? 'changed file' : 'changed files'
  return unviewed > 0
    ? `${unviewed} of ${total} ${noun} not reviewed yet`
    : `${total} ${noun}, all reviewed`
}
