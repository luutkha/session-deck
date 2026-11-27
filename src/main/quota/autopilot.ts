import { EMPTY_AUTOPILOT_STATE } from './autopilotPolicy'
import {
  armTimer,
  attempt,
  fireReset,
  forget,
  idleCandidates,
  onAlert,
  onUsageChanged,
  onUsageLimit,
  report,
  sleepIdle,
  stop,
  wake,
  type AutopilotContext
} from './autopilotOps'
import { loadAutopilotState } from './autopilotStore'
import { createResetTimer } from './autopilotTimer'
import type { QuotaAutopilot, QuotaAutopilotDeps, TimerHandle } from './autopilotTypes'

export type { QuotaAutopilot, QuotaAutopilotDeps, WakeOptions, TimerHandle } from './autopilotTypes'

/**
 * SessionDeck's quota autopilot (D30). At the critical 5-hour level it offers or does "sleep idle sessions"; at the
 * 5-hour reset it offers or does "wake them", optionally typing "continue" into sessions cut off by the usage limit.
 * Once sessions sleep no Claude process reports usage, so the autopilot keeps its own timer for the reset.
 */
export function createQuotaAutopilot(deps: QuotaAutopilotDeps): QuotaAutopilot {
  const setTimer = deps.setTimeout ?? ((callback: () => void, ms: number): TimerHandle => setTimeout(callback, ms))
  const clearTimer = deps.clearTimeout ?? ((handle: TimerHandle): void => clearTimeout(handle))
  const timer = createResetTimer({
    now: deps.now,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    onFire: () => fireReset(ctx),
    onError: deps.onError
  })
  const ctx: AutopilotContext = {
    deps,
    timer,
    setTimer,
    clearTimer,
    continues: new Map(),
    state: EMPTY_AUTOPILOT_STATE,
    handledResetAt: null,
    fallbackResetAt: null
  }

  return {
    async load(): Promise<void> {
      try {
        ctx.state = await loadAutopilotState(deps.filePath)
      } catch (error) {
        report(ctx, 'quota autopilot load', error)
        ctx.state = EMPTY_AUTOPILOT_STATE
      }
      attempt(ctx, 'quota autopilot state', () => deps.onStateChange(ctx.state))
      armTimer(ctx)
    },
    idleCandidates: () => idleCandidates(ctx),
    onAlert: (alert) => onAlert(ctx, alert),
    sleepIdle: () => sleepIdle(ctx),
    onUsageLimit: (id) => onUsageLimit(ctx, id),
    onUsageChanged: () => onUsageChanged(ctx),
    wake: (options) => wake(ctx, options),
    getState: () => ctx.state,
    forget: (id) => forget(ctx, id),
    stop: () => stop(ctx)
  }
}
