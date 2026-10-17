import { X } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'

export interface ErrorBannerProps {
  readonly message: string
  readonly onDismiss: () => void
}

export function ErrorBanner(props: ErrorBannerProps): ReactElement {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/15 px-3 py-1.5 text-[12px] text-destructive"
    >
      <span className="flex-1 truncate">{props.message}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss error"
        onClick={props.onDismiss}
        className="text-destructive hover:bg-destructive/20 hover:text-destructive"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}