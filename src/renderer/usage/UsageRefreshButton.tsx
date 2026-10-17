import { useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { UsageConsentDialog } from './UsageConsentDialog'

export interface UsageRefreshButtonProps {
  /** Asks the app to fetch fresh usage. */
  readonly onRefresh: () => void
  /** True while a refresh is in flight. */
  readonly refreshing: boolean
  /** Formatted, credential-free failure message; null when there is none. */
  readonly refreshError: string | null
  /** When explicitly false, the first click opens the consent dialog instead of refreshing. */
  readonly consented?: boolean
  /** Records consent when the user allows the request. */
  readonly grantConsent?: () => void
}

const TOOLTIP_TITLE = 'Refresh usage from your Claude account'
const TOOLTIP_NOTE = 'Uses the login token Claude Code keeps on this machine'

/**
 * The manual refresh affordance for the usage cluster. Owns the first-use consent
 * dialog so the surrounding chips and StatusBar stay free of flow state.
 */
export function UsageRefreshButton(props: UsageRefreshButtonProps): ReactElement {
  const { onRefresh, refreshing, refreshError, consented, grantConsent } = props
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)

  const handleClick = (): void => {
    if (consented === false) {
      setDialogOpen(true)
      return
    }
    onRefresh()
  }

  const handleAllow = (): void => {
    setDialogOpen(false)
    grantConsent?.()
    onRefresh()
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      {refreshError !== null ? (
        <span role="alert" className="max-w-[18rem] truncate text-[var(--destructive)]">
          {refreshError}
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground"
            aria-label="Refresh usage"
            disabled={refreshing}
            onClick={handleClick}
          >
            <RefreshCw
              className={cn('size-3', refreshing && 'motion-safe:animate-spin')}
              aria-hidden="true"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          <div className="flex flex-col gap-0.5">
            <span>{TOOLTIP_TITLE}</span>
            <span className="text-background/70">{TOOLTIP_NOTE}</span>
            {refreshError !== null ? (
              <span className="text-[var(--destructive)]">{refreshError}</span>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
      {dialogOpen ? <UsageConsentDialog onAllow={handleAllow} onCancel={(): void => setDialogOpen(false)} /> : null}
    </span>
  )
}
