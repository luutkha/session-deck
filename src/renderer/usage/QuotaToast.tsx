import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { QuotaAlert } from '../../shared/types'
import { quotaToastAction, type QuotaToastAction } from './quotaAlertLogic'
import { readContinueOnWake, sleepIdleSessions, wakeSessions, type QuotaActionApi, type QuotaActionResult } from './quotaActions'
import { QuotaToastCard } from './QuotaToastCard'
import { capQuotaToasts, sleptAlert, wokeAlert, type QuotaToastItem } from './quotaToastLogic'

export { describeQuotaAlert } from './quotaAlertLogic'
export type { QuotaToastDescription, QuotaToastTone } from './quotaAlertLogic'

/** Newest toasts beyond this many are dropped (action toasts are kept over plain ones). */
export const MAX_QUOTA_TOASTS = 3
/** How long each toast stays on screen before dismissing itself. */
export const QUOTA_TOAST_TIMEOUT_MS = 8000

type ActionOutcome = { readonly ok: true; readonly alert: QuotaAlert } | { readonly ok: false; readonly message: string }

/** Runs a toast's action and turns the IPC result into the alert the toast shows next. */
async function performAction(
  api: QuotaActionApi,
  item: QuotaToastItem,
  action: QuotaToastAction,
  continueDefault: boolean
): Promise<ActionOutcome> {
  if (action.kind === 'sleep') {
    const result: QuotaActionResult = await sleepIdleSessions(api)
    return result.ok ? { ok: true, alert: sleptAlert(item.alert, result.ids) } : result
  }
  const sendContinue = item.sendContinue ?? continueDefault
  const result: QuotaActionResult = await wakeSessions(api, sendContinue)
  return result.ok ? { ok: true, alert: wokeAlert(item.alert, result.ids) } : result
}

/**
 * In-app quota alerts. Subscribes to `window.api.onQuotaAlert` and stacks up to three toasts at the
 * top-right. Plain toasts auto-dismiss after 8 s; a toast with a session action stays until the user acts,
 * then turns into an info toast and auto-dismisses. Mounts once; safe when the API is absent.
 */
export function QuotaToast(): ReactElement | null {
  const [items, setItems] = useState<readonly QuotaToastItem[]>([])
  const [continueDefault, setContinueDefault] = useState<boolean>(false)
  const idRef = useRef(0)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const inFlightRef = useRef<Set<number>>(new Set())

  const dismiss = useCallback((id: number): void => {
    setItems((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const scheduleDismiss = useCallback(
    (id: number): void => {
      const timer = setTimeout((): void => {
        timersRef.current.delete(timer)
        dismiss(id)
      }, QUOTA_TOAST_TIMEOUT_MS)
      timersRef.current.add(timer)
    },
    [dismiss]
  )

  const updateItem = useCallback((id: number, patch: Partial<QuotaToastItem>): void => {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const push = useCallback(
    (alert: QuotaAlert): void => {
      const id = idRef.current
      idRef.current += 1
      const item: QuotaToastItem = { id, alert, nowMs: Date.now(), busy: false, error: null }
      setItems((previous) => capQuotaToasts([...previous, item], MAX_QUOTA_TOASTS))
      if (quotaToastAction(alert) === null) scheduleDismiss(id)
    },
    [scheduleDismiss]
  )

  const runAction = useCallback(
    async (item: QuotaToastItem, action: QuotaToastAction): Promise<void> => {
      if (inFlightRef.current.has(item.id)) return
      inFlightRef.current.add(item.id)
      updateItem(item.id, { busy: true, error: null })
      try {
        const outcome = await performAction(window.api, item, action, continueDefault)
        if (!outcome.ok) {
          updateItem(item.id, { busy: false, error: outcome.message })
          return
        }
        updateItem(item.id, { busy: false, error: null, alert: outcome.alert })
        scheduleDismiss(item.id)
      } finally {
        inFlightRef.current.delete(item.id)
      }
    },
    [continueDefault, scheduleDismiss, updateItem]
  )

  useEffect((): (() => void) | undefined => {
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (api === undefined || typeof api.onQuotaAlert !== 'function') return undefined
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = api.onQuotaAlert(push)
    } catch (error: unknown) {
      console.error('Quota toasts: could not subscribe to quota alerts', error)
    }
    return (): void => {
      if (unsubscribe !== undefined) unsubscribe()
      for (const timer of timersRef.current) clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [push])

  useEffect((): (() => void) | undefined => {
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (api === undefined) return undefined
    let active = true
    void readContinueOnWake(api).then((value: boolean): void => {
      if (active) setContinueDefault(value)
    })
    return (): void => {
      active = false
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed right-3 top-11 z-40 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2"
      aria-label="Quota alerts"
    >
      {items.map((item) => (
        <QuotaToastCard
          key={item.id}
          item={item}
          continueDefault={continueDefault}
          onDismiss={(): void => dismiss(item.id)}
          onRun={(action: QuotaToastAction): void => {
            void runAction(item, action)
          }}
          onSendContinue={(value: boolean): void => updateItem(item.id, { sendContinue: value })}
        />
      ))}
    </div>
  )
}
