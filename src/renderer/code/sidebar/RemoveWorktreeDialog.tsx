// D60: Remove worktree, with the optional "also delete the folder and branch from disk" (never for the repository
// folder). The facts (uncommitted files, unmerged branch) are read when the dialog opens and shown as warnings.
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Trash2 } from 'lucide-react'
import type { Worktree, WorktreeRemovalInfo, WorktreeRemoveOptions } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { deleteFromDiskLabel, removeDialogPlan } from './removeWorktreeLogic'
import { worktreeRemoveMessage } from './removeCopy'

export interface RemoveWorktreeDialogProps {
  readonly worktree: Worktree
  readonly sessionCount: number
  readonly onConfirm: (options: WorktreeRemoveOptions) => void
  readonly onCancel: () => void
}

export function RemoveWorktreeDialog({ worktree, sessionCount, onConfirm, onCancel }: RemoveWorktreeDialogProps): ReactElement {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const repoFolder = worktree.main === true
  const [deleteFromDisk, setDeleteFromDisk] = useState(false)
  const [info, setInfo] = useState<WorktreeRemovalInfo | null>(null)
  const [infoFailed, setInfoFailed] = useState(false)

  useEffect((): (() => void) | undefined => {
    if (repoFolder) return undefined
    let live = true
    window.api.getWorktreeRemovalInfo(worktree.id).then(
      (facts): void => { if (live) setInfo(facts) },
      (): void => { if (live) setInfoFailed(true) }
    )
    return (): void => { live = false }
  }, [worktree.id, repoFolder])

  const plan = removeDialogPlan(deleteFromDisk, info, infoFailed)
  return (
    <Dialog open onOpenChange={(open): void => { if (!open) onCancel() }}>
      <DialogContent
        role="alertdialog"
        data-remove-worktree-dialog
        className="max-w-md sm:max-w-md"
        onOpenAutoFocus={(event): void => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">Remove worktree</DialogTitle>
          <DialogDescription className="text-xs">
            {deleteFromDisk
              ? `Stops its ${sessionCount} session(s), removes ${worktree.name} from SessionDeck and deletes ${worktree.path} and its branch.`
              : worktreeRemoveMessage(worktree.name, sessionCount, worktree.path, repoFolder)}
          </DialogDescription>
        </DialogHeader>
        {!repoFolder ? (
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox
              data-delete-from-disk
              checked={deleteFromDisk}
              onCheckedChange={(value): void => setDeleteFromDisk(value === true)}
              className="mt-0.5"
            />
            <span>{deleteFromDiskLabel(worktree.branch)}</span>
          </label>
        ) : null}
        {plan.warnings.length > 0 ? (
          <ul data-remove-warnings className="flex flex-col gap-0.5 text-xs text-destructive">
            {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="outline" size="sm" className="text-xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="text-xs"
            data-remove-confirm
            disabled={plan.options === null}
            onClick={(): void => { if (plan.options !== null) onConfirm(plan.options) }}
          >
            <Trash2 aria-hidden="true" />
            {plan.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
