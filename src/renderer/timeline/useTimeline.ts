// Loads one session's turns and refetches when main says that session changed.
// Replies from an overtaken request (or a previous session) are dropped by the request gate.
import { useEffect, useState } from 'react'
import type { Id, TimelineTurn } from '../../shared/types'
import {
  INITIAL_TIMELINE_STATE,
  beginLoad,
  createRequestGate,
  finishLoad,
  loadTimeline,
  subscribeSafely,
  type TimelineViewState
} from './timelineLoad'

export interface TimelineResult {
  readonly turns: readonly TimelineTurn[]
  readonly error: string | null
  readonly loading: boolean
}

const NOTHING_YET: TimelineResult = { turns: [], error: null, loading: true }

export function useTimeline(sessionId: Id): TimelineResult {
  const [state, setState] = useState<TimelineViewState>(INITIAL_TIMELINE_STATE)
  const [gate] = useState(createRequestGate)

  useEffect((): (() => void) => {
    const load = (): void => {
      const request = gate.next()
      setState((previous: TimelineViewState): TimelineViewState => beginLoad(previous, sessionId))
      void loadTimeline(sessionId, (id: Id) => window.api.getTimeline(id)).then(
        (result): void => {
          if (!gate.isLatest(request)) return
          setState((previous: TimelineViewState): TimelineViewState => finishLoad(previous, sessionId, result))
        }
      )
    }
    load()
    const unsubscribe = subscribeSafely((): (() => void) =>
      window.api.onTimeline((changed: Id): void => {
        if (changed === sessionId) load()
      })
    )
    return (): void => {
      unsubscribe()
      gate.cancel()
    }
  }, [sessionId, gate])

  // A render before the effect runs must not show the previous session's turns.
  if (state.sessionId !== sessionId) return NOTHING_YET
  return { turns: state.turns, error: state.error, loading: state.loading }
}
