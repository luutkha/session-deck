import { useEffect, useRef, useState } from 'react'
import type { Id, RuntimeState } from '../../shared/types'

/**
 * Wall-clock time of the most recent runtime event per session. The store
 * replaces the runtime Map reference on every event, but only the event's own
 * session gets a new RuntimeState identity, so comparing entries detects
 * exactly which session changed. Sessions never seen keep no entry; callers
 * fall back to `session.createdAt`.
 *
 * `provided` is the map a parent already derived (ModeWorkspace computes it
 * once and passes it down). When it is given there is nothing to diff, so the
 * effect does not walk the whole runtime Map again.
 */
export function useLastRuntimeChange(
  runtime: ReadonlyMap<Id, RuntimeState>,
  provided?: ReadonlyMap<Id, number>
): ReadonlyMap<Id, number> {
  const previousRef = useRef<ReadonlyMap<Id, RuntimeState>>(new Map())
  const [lastChange, setLastChange] = useState<ReadonlyMap<Id, number>>(() => new Map())

  useEffect((): void => {
    const previous = previousRef.current
    previousRef.current = runtime
    if (provided !== undefined) return
    setLastChange((current) => {
      let next: Map<Id, number> | null = null
      const now = Date.now()
      for (const [id, state] of runtime) {
        if (previous.get(id) !== state) {
          if (next === null) next = new Map(current)
          next.set(id, now)
        }
      }
      return next ?? current
    })
  }, [runtime, provided])

  return provided ?? lastChange
}