import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, Gauge, X } from 'lucide-react'
import type { QuotaAlert } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { describeQuotaAlert, type QuotaToastTone } from './quotaAlertLogic'

export { describeQuotaAlert } from './quotaAlertLogic'
export type { QuotaToastDescription, QuotaToastTone } from './quotaAlertLogic'

/** Newest toasts beyond this many are dropped. */
export const MAX_QUOTA_TOASTS = 3
/** How long each toast stays on screen before dismissing itself. */
export const QUOTA_TOAST_TIMEOUT_MS = 8000

interface ToastItem {
  readonly id: number
  readonly alert: QuotaAlert
  readonly nowMs: number
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

/**
 * In-app quota alerts. Subscribes to `window.api.onQuotaAlert` and stacks up to
 * three toasts at the top-right, each auto-dismissing after 8 s. Mounts once;
 * safe when the API is absent.
 */
export function QuotaToast(): ReactElement | null {
  const [items, setItems] = useState<readonly ToastItem[]>([])
  const idRef = useRef(0)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const dismiss = useCallback((id: number): void => {
    setItems((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const push = useCallback(
    (alert: QuotaAlert): void => {
      const id = idRef.current
      idRef.current += 1
      setItems((previous) => {
        const next = [...previous, { id, alert, nowMs: Date.now() }]
        return next.length > MAX_QUOTA_TOASTS ? next.slice(next.length - MAX_QUOTA_TOASTS) : next
      })
      const timer = setTimeout((): void => {
        timersRef.current.delete(timer)
        dismiss(id)
      }, QUOTA_TOAST_TIMEOUT_MS)
      timersRef.current.add(timer)
    },
    [dismiss]
  )

  useEffect((): (() => void) | undefined => {
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (api === undefined || typeof api.onQuotaAlert !== 'function') return undefined
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = api.onQuotaAlert(push)
    } catch {
      unsubscribe = undefined
    }
    return (): void => {
      if (unsubscribe !== undefined) unsubscribe()
      for (const timer of timersRef.current) clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [push])

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed right-3 top-11 z-40 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2"
      aria-label="Quota alerts"
    >
      {items.map((item) => {
        const description = describeQuotaAlert(item.alert, item.nowMs)
        return (
          <div
            key={item.id}
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
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              className="size-5 shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={(): void => dismiss(item.id)}
            >
              <X className="size-3" aria-hidden="true" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
