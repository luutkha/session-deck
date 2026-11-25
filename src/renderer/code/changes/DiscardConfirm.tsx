// D86: asks before throwing uncommitted work away. Discarding cannot be undone, so it is never one click.
import type { ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'

export type DiscardRequest =
  | { readonly kind: 'file'; readonly path: string; readonly untracked: boolean }
  | { readonly kind: 'hunk'; readonly path: string; readonly index: number; readonly header: string }

export function discardQuestion(request: DiscardRequest): { readonly title: string; readonly body: string; readonly confirm: string } {
  if (request.kind === 'hunk') {
    return {
      title: 'Discard this change block?',
      body: `The lines of this block in ${request.path} go back to how they were. This cannot be undone.`,
      confirm: 'Discard block'
    }
  }
  return request.untracked
    ? {
        title: 'Delete this new file?',
        body: `${request.path} is not tracked by git, so it is deleted from the worktree. This cannot be undone.`,
        confirm: 'Delete file'
      }
    : {
        title: 'Discard all changes in this file?',
        body: `${request.path} goes back to the last commit. Your uncommitted edits in it are lost. This cannot be undone.`,
        confirm: 'Discard changes'
      }
}

export interface DiscardConfirmProps {
  readonly request: DiscardRequest | null
  readonly busy: boolean
  readonly error: string | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function DiscardConfirm({ request, busy, error, onConfirm, onCancel }: DiscardConfirmProps): ReactElement {
  const question = request === null ? null : discardQuestion(request)
  return (
    <Dialog open={request !== null} onOpenChange={(open): void => { if (!open) onCancel() }}>
      <DialogContent data-discard-confirm="" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{question?.title ?? ''}</DialogTitle>
          <DialogDescription>{question?.body ?? ''}</DialogDescription>
        </DialogHeader>
        {error !== null ? (
          <p role="alert" data-discard-error="" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy} data-discard-cancel="">
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={busy} data-discard-yes="">
            {question?.confirm ?? 'Discard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
