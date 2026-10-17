import type { ReactElement } from 'react'
import { Bell, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Id, SessionRun, UsageState } from '../../shared/types'
import { UsageChips } from '../usage/UsageChips'
import { folderName, tabIndicatorFor } from './tabStatus'

export interface StatusBarProps {
  /** Folder of the active session, or null when no tab is open. */
  readonly cwd: string | null
  readonly run: SessionRun | null
  readonly exitCode: number | null
  readonly attentionCount: number
  readonly soundEnabled: boolean
  readonly onToggleSound: (next: boolean) => void
  /** Claude usage snapshot + clock + optional manual-refresh plumbing. When absent, no usage chips render. */
  readonly usage?: {
    readonly state: UsageState
    readonly stale: boolean
    readonly now: number
    readonly onRefresh?: () => void
    readonly refreshing?: boolean
    readonly refreshError?: string | null
    readonly consented?: boolean
    readonly grantConsent?: () => void
    readonly pace?: { readonly fiveHour: string; readonly sevenDay: string }
  }
  /** Session whose model/context/cost is shown. */
  readonly activeSessionId?: Id | null
}

function runLabel(run: SessionRun | null, exitCode: number | null): string {
  const label = tabIndicatorFor(run, null).label
  if (run === 'exited' && exitCode !== null) {
    return `${label} (${String(exitCode)})`
  }
  return label
}

export function StatusBar(props: StatusBarProps): ReactElement {
  const { cwd, run, exitCode, attentionCount, soundEnabled, onToggleSound, usage, activeSessionId } =
    props
  const indicator = tabIndicatorFor(run, null)

  return (
    <footer className="flex h-6 min-h-6 shrink-0 select-none items-center gap-4 whitespace-nowrap border-t border-border bg-[var(--bg-titlebar,var(--card))] px-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        {cwd !== null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 truncate">{folderName(cwd)}</span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {cwd}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {cwd !== null ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${indicator.colorClass}`} />
            <span>{runLabel(run, exitCode)}</span>
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {usage !== undefined ? (
          <UsageChips
            state={usage.state}
            stale={usage.stale}
            now={usage.now}
            activeSessionId={activeSessionId ?? null}
            onRefresh={usage.onRefresh}
            refreshing={usage.refreshing}
            refreshError={usage.refreshError}
            consented={usage.consented}
            grantConsent={usage.grantConsent}
            pace={usage.pace}
          />
        ) : null}
        {attentionCount > 0 ? (
          <span role="status" aria-live="polite" className="flex items-center gap-1 text-[var(--attn-permission)]">
            <Bell size={14} aria-hidden="true" />
            {`${String(attentionCount)} need attention`}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={soundEnabled ? 'Sound on' : 'Sound off'}
          onClick={(): void => onToggleSound(!soundEnabled)}
        >
          {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </Button>
      </div>
    </footer>
  )
}
