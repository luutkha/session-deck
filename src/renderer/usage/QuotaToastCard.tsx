import type { ReactElement } from 'react'
import { AlertTriangle, Gauge, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { describeQuotaAlert, quotaToastAction, type QuotaToastAction, type QuotaToastTone } from './quotaAlertLogic'
import { QuotaToastControls } from './QuotaToastControls'
import type { QuotaToastItem } from './quotaToastLogic'

export interface QuotaToastCardProps {
  readonly item: QuotaToastItem
  /** The saved "type continue on wake" value, used until the user ticks the checkbox. */
  readonly continueDefault: boolean
  readonly onDismiss: () => void
  readonly onRun: (action: QuotaToastAction) => void
  readonly onSendContinue: (value: boolean) => void
}

function toneBorder(tone: QuotaToastTone): string {
  if (tone === 'critical') return 'border-l-[var(--destructive)]'
  if (tone === 'warn') return 'border-l-[var(--status-warning)]'
  return 'border-l-[var(--status-success)]'
}

function toneText(tone: QuotaToastTone): string {
  if (tone === 'critical') return 'text-[var(--destructive)]'
  if (tone === 'warn') return 'text-[var(--status-warning)]'
  return 'text-[var(--status-success)]'
}

function ToastIcon({ tone }: { readonly tone: QuotaToastTone }): ReactElement {
  const className = cn('mt-0.5 size-3.5 shrink-0', toneText(tone))
  if (tone === 'critical') return <AlertTriangle className={className} aria-hidden="true" />
  return <Gauge className={className} aria-hidden="true" />
}

/** One quota toast: the description, its session action (if any) and a dismiss button. */
export function QuotaToastCard(props: QuotaToastCardProps): ReactElement {
  const { item, continueDefault, onDismiss, onRun, onSendContinue } = props
  const description = describeQuotaAlert(item.alert, item.nowMs)
  const action = quotaToastAction(item.alert)
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-md border border-border border-l-2 bg-card px-3 py-2 text-xs text-foreground shadow-floating',
        toneBorder(description.tone)
      )}
    >
      <ToastIcon tone={description.tone} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{description.title}</p>
        {description.detail !== '' ? (
          <p className="truncate text-muted-foreground">{description.detail}</p>
        ) : null}
        {action !== null ? (
          <QuotaToastControls
            toastId={item.id}
            action={action}
            busy={item.busy}
            sendContinue={item.sendContinue ?? continueDefault}
            onSendContinueChange={onSendContinue}
            onRun={(): void => onRun(action)}
          />
        ) : null}
        {item.error !== null ? (
          <p role="alert" className="mt-1 text-[var(--destructive)]">
            {item.error}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        className="size-5 shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onDismiss}
      >
        <X className="size-3" aria-hidden="true" />
      </Button>
    </div>
  )
}
