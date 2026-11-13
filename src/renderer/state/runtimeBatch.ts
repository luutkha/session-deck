// Batches runtime events (performance): every runtime event used to make the renderer rebuild its runtime map and render
// the whole workspace, so 40 working agents (tens of events per second) kept the page busy. Leading + trailing: the first
// event of a quiet period is applied at once (a single click or status change is never delayed), the events that follow
// inside `intervalMs` are collected (the last state per session wins) and applied together when the interval ends.
// Timers come in through deps so tests drive them by hand.
import type { Id, RuntimeState } from '../../shared/types'

export interface RuntimeBatchDeps<Handle> {
  /** Applies one or more states (one render for all of them). */
  readonly apply: (states: readonly RuntimeState[]) => void
  readonly intervalMs: number
  readonly setTimer: (callback: () => void, milliseconds: number) => Handle
  readonly clearTimer: (handle: Handle) => void
}

export interface RuntimeBatch {
  push: (state: RuntimeState) => void
  /** Drops whatever is waiting and stops the timer (the owner unmounted). The batch stays usable: a remount pushes again. */
  dispose: () => void
}

export function createRuntimeBatch<Handle>(deps: RuntimeBatchDeps<Handle>): RuntimeBatch {
  const pending = new Map<Id, RuntimeState>()
  let timer: Handle | null = null

  const onInterval = (): void => {
    timer = null
    if (pending.size === 0) return
    const states = [...pending.values()]
    pending.clear()
    timer = deps.setTimer(onInterval, deps.intervalMs)
    deps.apply(states)
  }

  const push = (state: RuntimeState): void => {
    if (timer !== null) {
      pending.set(state.sessionId, state)
      return
    }
    timer = deps.setTimer(onInterval, deps.intervalMs)
    deps.apply([state])
  }

  const dispose = (): void => {
    pending.clear()
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
  }

  return { push, dispose }
}
