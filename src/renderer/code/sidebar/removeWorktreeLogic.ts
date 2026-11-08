// D60: the Remove worktree dialog's rules: the "also delete from disk" warnings, the button and the options sent.
// Pure, no React.
import type { WorktreeRemovalInfo, WorktreeRemoveOptions } from '../../../shared/types'

export interface RemoveDialogPlan {
  /** Red lines shown when deleting from disk would lose something. */
  readonly warnings: readonly string[]
  readonly confirmLabel: string
  /** null = cannot confirm yet (the facts are still loading). */
  readonly options: WorktreeRemoveOptions | null
}

/** What the dialog says and sends for the current tick; `info` null = still loading (or failed: then no disk delete). */
export function removeDialogPlan(deleteFromDisk: boolean, info: WorktreeRemovalInfo | null, infoFailed: boolean): RemoveDialogPlan {
  if (!deleteFromDisk) return { warnings: [], confirmLabel: 'Remove', options: {} }
  if (info === null) {
    return infoFailed
      ? { warnings: ['Could not check the worktree, so it cannot be deleted from disk now.'], confirmLabel: 'Delete', options: null }
      : { warnings: [], confirmLabel: 'Delete', options: null }
  }
  const warnings: string[] = []
  if (info.uncommitted > 0) warnings.push(`${info.uncommitted} uncommitted file${info.uncommitted === 1 ? '' : 's'} will be lost.`)
  if (!info.branchMerged) warnings.push(`Branch ${info.branch} has commits that ${info.baseBranch} does not have; they will be lost.`)
  return {
    warnings,
    confirmLabel: warnings.length > 0 ? 'Delete anyway' : 'Delete',
    options: { deleteFromDisk: true, discardChanges: info.uncommitted > 0, deleteUnmergedBranch: !info.branchMerged }
  }
}

/** The checkbox label: names the folder and branch that go. */
export function deleteFromDiskLabel(branch: string): string {
  return `Also delete the folder and branch ${branch} from disk`
}
