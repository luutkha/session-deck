import { useRef, type ReactElement } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export interface ConfirmDialogProps {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Destructive confirmation in Orca's layout (DeleteWorktreeDialog). Uses the
 * shadcn Dialog with alertdialog semantics: Cancel has focus on open, Escape
 * and the backdrop cancel, and Radix restores focus to the opener on close.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: ConfirmDialogProps): ReactElement {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  return (
    <Dialog
      open
      onOpenChange={(open: boolean): void => {
        if (!open) onCancel()
      }}
    >
      <DialogContent
        role="alertdialog"
        className="max-w-md sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs">{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="text-xs"
            onClick={onConfirm}
          >
            <Trash2 aria-hidden="true" />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
