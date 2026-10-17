import type { ReactElement } from 'react'
import { SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface EmptyStateProps {
  readonly onNewSession: () => void
}

export function EmptyState({ onNewSession }: EmptyStateProps): ReactElement {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <SquareTerminal size={16} aria-hidden="true" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">No open sessions</p>
        <p className="text-xs text-muted-foreground">
          Pick a session in the sidebar, or press Ctrl+Shift+N to start a new one.
        </p>
      </div>
      <Button onClick={onNewSession}>New session</Button>
    </div>
  )
}
