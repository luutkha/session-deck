import { useRef, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export interface UsageConsentDialogProps {
  /** User approved reading the local Claude login token for one usage request. */
  readonly onAllow: () => void
  /** User dismissed the prompt; nothing happens. */
  readonly onCancel: () => void
}

const CONSENT_BODY =
  'SessionDeck will read the Claude login token that Claude Code stores at ' +
  '~/.claude/.credentials.json and send it only to api.anthropic.com to ask for your ' +
  'current plan usage. The token is used for that one request, never saved or logged, and ' +
  "never leaves the app's background process."

/**
 * One-time consent prompt for the manual usage refresh. Mirrors our other dialogs:
 * Cancel has focus on open, Escape and the backdrop cancel, and Radix restores focus
 * to the refresh button on close.
 */
export function UsageConsentDialog({ onAllow, onCancel }: UsageConsentDialogProps): ReactElement {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  return (
    <Dialog
      open
      onOpenChange={(open: boolean): void => {
        if (!open) onCancel()
      }}
    >
      <DialogContent
        className="max-w-md sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">Refresh usage from your Claude account?</DialogTitle>
          <DialogDescription className="text-xs">{CONSENT_BODY}</DialogDescription>
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
          <Button type="button" size="sm" className="text-xs" onClick={onAllow}>
            Allow and refresh
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
