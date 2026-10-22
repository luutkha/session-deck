import { useEffect, useState } from 'react'
import type { QuotaAutopilotState } from '../../shared/types'

/** Nothing held: the state before main answers. */
export const EMPTY_QUOTA_AUTOPILOT: QuotaAutopilotState = {
  sleptForQuota: [],
  stoppedAtLimit: [],
  resetsAt: null
}

/**
 * Sessions the quota autopilot holds for the next 5-hour reset. Reads the state on mount and follows
 * `onQuotaAutopilot`. A read that resolves after a pushed update is ignored, so it cannot undo newer data.
 */
export function useQuotaAutopilot(): QuotaAutopilotState {
  const [state, setState] = useState<QuotaAutopilotState>(EMPTY_QUOTA_AUTOPILOT)

  useEffect((): (() => void) | undefined => {
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (api === undefined) return undefined
    let active = true
    let pushed = false

    const apply = (next: QuotaAutopilotState): void => {
      if (active) setState(next)
    }
    const onPush = (next: QuotaAutopilotState): void => {
      pushed = true
      apply(next)
    }

    Promise.resolve()
      .then(() => api.getQuotaAutopilot())
      .then((next: QuotaAutopilotState): void => {
        if (!pushed) apply(next)
      })
      .catch((error: unknown): void => {
        console.error('Quota autopilot: could not read the held sessions', error)
      })

    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = api.onQuotaAutopilot(onPush)
    } catch (error: unknown) {
      console.error('Quota autopilot: could not subscribe to updates', error)
    }

    return (): void => {
      active = false
      if (unsubscribe !== undefined) unsubscribe()
    }
  }, [])

  return state
}
