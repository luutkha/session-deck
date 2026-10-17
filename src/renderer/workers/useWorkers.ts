import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Id, WorkerInfo } from '../../shared/types'
import { nextExpiryIn, visibleWorkers } from './workerLogic'

export interface WorkersApi {
  /** Workers of the active session that should have a tab right now. */
  readonly visible: readonly WorkerInfo[]
  /** The worker being read, if it is still visible. */
  readonly selected: WorkerInfo | null
  readonly select: (id: string | null) => void
  /** Closes the tab only; the worker itself keeps running. */
  readonly dismiss: (id: string) => void
}

/** Subscribes to the workers main finds for the open sessions and applies the tab rules (owner, dismissed, auto-close). */
export function useWorkers(activeSessionId: Id | null): WorkersApi {
  const [workers, setWorkers] = useState<readonly WorkerInfo[]>([])
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const api = window.api
    if (api === undefined || typeof api.onWorkers !== 'function') return undefined
    let live = true
    void api.getWorkers().then((list) => { if (live) setWorkers(list) }).catch(() => undefined)
    const off = api.onWorkers((list) => { setNow(Date.now()); setWorkers(list) })
    return () => { live = false; off() }
  }, [])

  const visible = useMemo(
    () => visibleWorkers({ workers, activeSessionId, dismissed, selectedId, now }),
    [workers, activeSessionId, dismissed, selectedId, now]
  )

  // Wake up exactly when the next finished worker is due to close.
  useEffect(() => {
    const wait = nextExpiryIn(visible, selectedId, Date.now())
    if (wait === null) return undefined
    const timer = setTimeout(() => setNow(Date.now()), wait + 50)
    return () => clearTimeout(timer)
  }, [visible, selectedId])

  const select = useCallback((id: string | null): void => setSelectedId(id), [])
  const dismiss = useCallback((id: string): void => {
    setDismissed((prev) => new Set(prev).add(id))
    setSelectedId((prev) => (prev === id ? null : prev))
  }, [])

  const selected = useMemo(() => visible.find((w) => w.id === selectedId) ?? null, [visible, selectedId])
  return { visible, selected, select, dismiss }
}
