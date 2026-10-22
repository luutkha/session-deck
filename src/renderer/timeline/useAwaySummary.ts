// Holds the "While you were away" summary shown in AwayDialog. A new summary replaces the open one.
import { useCallback, useEffect, useState } from 'react'
import type { AwaySummary } from '../../shared/types'
import { subscribeSafely } from './timelineLoad'
import { fetchLastAwaySummary } from './awayState'

export interface AwaySummaryControl {
  readonly summary: AwaySummary | null
  readonly show: (summary: AwaySummary) => void
  readonly close: () => void
  /** Shows the last summary of this app run; does nothing when there is none. */
  readonly showLast: () => void
}

export function useAwaySummary(): AwaySummaryControl {
  const [summary, setSummary] = useState<AwaySummary | null>(null)

  useEffect((): (() => void) => {
    return subscribeSafely((): (() => void) =>
      window.api.onAwaySummary((next: AwaySummary): void => setSummary(next))
    )
  }, [])

  const show = useCallback((next: AwaySummary): void => setSummary(next), [])
  const close = useCallback((): void => setSummary(null), [])
  const showLast = useCallback((): void => {
    void fetchLastAwaySummary((): Promise<AwaySummary | null> => window.api.getLastAwaySummary()).then(
      (last: AwaySummary | null): void => {
        if (last !== null) setSummary(last)
      }
    )
  }, [])

  return { summary, show, close, showLast }
}
