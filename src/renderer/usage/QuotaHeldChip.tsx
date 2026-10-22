import { useState, type ReactElement } from 'react'
import { Moon } from 'lucide-react'
import type { QuotaAutopilotState } from '../../shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { wakeSessions } from './quotaActions'
import { heldChipLabel, heldTooltipLines } from './quotaHeldLogic'

export interface QuotaHeldChipProps {
  readonly state: QuotaAutopilotState
}

const WAKE_HINT = 'Click to wake them now (no “continue” is typed).'

/**
 * Status-bar chip for sessions the quota autopilot holds for the 5-hour reset. Click wakes them now.
 * Shown only while something is held (the parent checks `isHeldVisible`).
 */
export function QuotaHeldChip({ state }: QuotaHeldChipProps): ReactElement {
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const lines = heldTooltipLines(state)

  async function handleWake(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await wakeSessions(window.api, false)
      if (!result.ok) setError(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-quota-held
          disabled={busy}
          onClick={(): void => {
            void handleWake()
          }}
          className={cn(
            'flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground disabled:cursor-progress',
            error !== null && 'text-[var(--destructive)]'
          )}
        >
          <Moon className="size-3" aria-hidden="true" />
          <span className="tabular-nums">{heldChipLabel(state)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <span className="flex flex-col gap-0.5">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span className="text-background/70">{WAKE_HINT}</span>
          {error !== null ? <span className="text-[var(--destructive)]">{error}</span> : null}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
