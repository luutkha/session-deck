// Loads the timeline turns of several sessions for the cost report (D51) and refetches one session when main says its
// timeline changed. Only runs while `enabled` (the dialog is open).
import { useEffect, useMemo, useState } from 'react'
import type { Id, TimelineTurn } from '../../shared/types'

export interface CostTurns {
  readonly bySession: ReadonlyMap<Id, readonly TimelineTurn[]>
  readonly loading: boolean
}

export function useCostTurns(sessionIds: readonly Id[], enabled: boolean): CostTurns {
  const [bySession, setBySession] = useState<ReadonlyMap<Id, readonly TimelineTurn[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const key = sessionIds.join('|')

  useEffect((): (() => void) | undefined => {
    if (!enabled) return undefined
    let cancelled = false
    const ids = key.length === 0 ? [] : key.split('|')
    const fetchOne = async (id: Id): Promise<readonly TimelineTurn[]> => {
      try {
        return await window.api.getTimeline(id)
      } catch {
        return [] // a session whose timeline cannot be read simply shows no cost
      }
    }
    setLoading(true)
    void Promise.all(ids.map(async (id) => [id, await fetchOne(id)] as const)).then((entries) => {
      if (cancelled) return
      setBySession(new Map(entries))
      setLoading(false)
    })
    const unsubscribe = window.api.onTimeline((changed: Id): void => {
      if (!ids.includes(changed)) return
      void fetchOne(changed).then((turns) => {
        if (cancelled) return
        setBySession((previous) => new Map(previous).set(changed, turns))
      })
    })
    return (): void => {
      cancelled = true
      unsubscribe()
    }
  }, [key, enabled])

  return useMemo(() => ({ bySession, loading }), [bySession, loading])
}
