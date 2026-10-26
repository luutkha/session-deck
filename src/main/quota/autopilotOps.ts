import type { Id, QuotaAlert, QuotaAutopilotState } from '../../shared/types'
import { scheduleContinue } from './autopilotContinue'
import {
  EMPTY_AUTOPILOT_STATE,
  RESET_DEDUP_MS,
  futureFiveHourReset,
  hasHeld,
  idleCandidateIds,
  isNewerReset,
  liveHeldIds,
  pruneHeld,
  resolveResetsAt,
  uniqueIds
} from './autopilotPolicy'
import { saveAutopilotState } from './autopilotStore'
import type { ResetTimer } from './autopilotTimer'
import type { QuotaAutopilotDeps, TimerHandle, WakeOptions } from './autopilotTypes'

/** Everything the autopilot operations work on. `state` is replaced (never edited) on every change. */
export interface AutopilotContext {
  readonly deps: QuotaAutopilotDeps
  readonly timer: ResetTimer
  readonly setTimer: (callback: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
  readonly continues: Map<Id, () => void>
  state: QuotaAutopilotState
  /** Epoch ms when the reset timer last handled a reset; the guard's copy of that reset is then dropped. */
  handledResetAt: number | null
}

const FIVE_HOUR_RESET: QuotaAlert = { window: 'fiveHour', kind: 'reset', percent: 0, resetsAt: null }

export function report(ctx: AutopilotContext, where: string, error: unknown): void {
  ctx.deps.onError(where, error)
}

export function attempt(ctx: AutopilotContext, where: string, action: () => void): void {
  try {
    action()
  } catch (error) {
    report(ctx, where, error)
  }
}

/** Announces the state to the app and saves it. Does not touch the timer. */
export function publish(ctx: AutopilotContext, next: QuotaAutopilotState): void {
  ctx.state = next
  attempt(ctx, 'quota autopilot state', () => ctx.deps.onStateChange(next))
  attempt(ctx, 'quota autopilot save', () => saveAutopilotState(ctx.deps.filePath, next))
}

export function armTimer(ctx: AutopilotContext): void {
  ctx.timer.arm(hasHeld(ctx.state) ? ctx.state.resetsAt : null)
}

/** Publishes the state and re-arms the reset timer for it. */
export function commit(ctx: AutopilotContext, next: QuotaAutopilotState): void {
  publish(ctx, next)
  armTimer(ctx)
}

function isOpenSession(ctx: AutopilotContext, id: Id): boolean {
  return ctx.deps.listSessions().some((s) => s.id === id && s.closedAt === undefined)
}

/** The reset time to wait for: fresh usage data, else the previous one while it is still ahead. */
function resetFromUsage(ctx: AutopilotContext, previous: number | null): number | null {
  const now = ctx.deps.now()
  return resolveResetsAt(previous, futureFiveHourReset(ctx.deps.getUsage(), now), now)
}

export function idleCandidates(ctx: AutopilotContext): Id[] {
  return idleCandidateIds(ctx.deps.listSessions(), ctx.deps.getRuntime())
}

function trySleep(ctx: AutopilotContext, id: Id): boolean {
  try {
    ctx.deps.sleepSession(id)
    return true
  } catch (error) {
    report(ctx, 'quota autopilot sleep', error)
    return false
  }
}

export function sleepIdle(ctx: AutopilotContext): Id[] {
  const slept = idleCandidates(ctx).filter((id) => trySleep(ctx, id))
  if (slept.length === 0) return []
  commit(ctx, {
    ...ctx.state,
    sleptForQuota: uniqueIds([...ctx.state.sleptForQuota, ...slept]),
    resetsAt: resetFromUsage(ctx, ctx.state.resetsAt)
  })
  return slept
}

export function onUsageLimit(ctx: AutopilotContext, id: Id): void {
  if (!isOpenSession(ctx, id)) return
  commit(ctx, {
    ...ctx.state,
    stoppedAtLimit: uniqueIds([...ctx.state.stoppedAtLimit, id]),
    resetsAt: resetFromUsage(ctx, ctx.state.resetsAt)
  })
}

export function onUsageChanged(ctx: AutopilotContext): void {
  if (!hasHeld(ctx.state)) return
  const fresh = futureFiveHourReset(ctx.deps.getUsage(), ctx.deps.now())
  if (fresh === null || !isNewerReset(ctx.state.resetsAt, fresh)) return
  commit(ctx, { ...ctx.state, resetsAt: fresh })
}

export function startContinue(ctx: AutopilotContext, id: Id, alreadyRunning = false): void {
  ctx.continues.get(id)?.()
  attempt(ctx, 'quota autopilot continue', () => {
    const cancel = scheduleContinue(
      {
        subscribeOutput: ctx.deps.subscribeOutput,
        writeToSession: ctx.deps.writeToSession,
        setTimeout: ctx.setTimer,
        clearTimeout: ctx.clearTimer,
        onError: ctx.deps.onError,
        onGiveUp: (id) => ctx.deps.onContinueFailed?.(id)
      },
      id,
      { alreadyRunning }
    )
    ctx.continues.set(id, cancel)
  })
}

export function stopContinue(ctx: AutopilotContext, id: Id): void {
  ctx.continues.get(id)?.()
  ctx.continues.delete(id)
}

export function stopAllContinues(ctx: AutopilotContext): void {
  for (const id of Array.from(ctx.continues.keys())) stopContinue(ctx, id)
}

function tryWake(ctx: AutopilotContext, id: Id): boolean {
  try {
    return ctx.deps.wakeSession(id)
  } catch (error) {
    report(ctx, 'quota autopilot wake', error)
    return false
  }
}

/** Wakes one held session if it sleeps, then queues "continue" if asked. Returns whether it counts as woken or continued. */
function wakeOne(ctx: AutopilotContext, id: Id, asleep: boolean, wantContinue: boolean): boolean {
  const woke = asleep && tryWake(ctx, id)
  if (asleep && !woke) {
    // Hands-off must never fail silently: the reset passed and this session is still held asleep.
    ctx.deps.onContinueFailed?.(id)
    return false
  }
  if (!wantContinue) return woke
  startContinue(ctx, id, !asleep)
  return true
}

export function wake(ctx: AutopilotContext, options: WakeOptions): Id[] {
  const held = liveHeldIds(ctx.state, ctx.deps.listSessions())
  const runtimes = ctx.deps.getRuntime()
  const stopped = new Set(ctx.state.stoppedAtLimit)
  const acted: Id[] = []
  for (const id of held) {
    const asleep = runtimes.get(id)?.sleeping === true
    if (wakeOne(ctx, id, asleep, options.sendContinue && stopped.has(id))) acted.push(id)
  }
  publish(ctx, EMPTY_AUTOPILOT_STATE)
  ctx.timer.disarm()
  return acted
}

function wokeAlert(woken: readonly Id[]): QuotaAlert {
  return woken.length === 0 ? FIVE_HOUR_RESET : { ...FIVE_HOUR_RESET, autoAction: 'woke', sessionIds: woken }
}

/**
 * Handles the 5-hour reset for the held sessions. resetAction 'wake' wakes them now; 'ask' keeps them held and offers
 * the wake. Returns the alert to deliver, or null when nothing is held.
 */
export function handleReset(ctx: AutopilotContext): QuotaAlert | null {
  ctx.timer.disarm()
  const settings = ctx.deps.getSettings()
  const sessions = ctx.deps.listSessions()
  const held = liveHeldIds(ctx.state, sessions)
  if (held.length === 0) {
    publish(ctx, EMPTY_AUTOPILOT_STATE)
    return null
  }
  if (settings.resetAction === 'wake') {
    return wokeAlert(wake(ctx, { sendContinue: settings.continueOnWake }))
  }
  // The reset is spent: the next one is unknown until fresh usage data (onUsageChanged) arrives, so a later re-arm
  // does not offer this same reset again.
  publish(ctx, { ...pruneHeld(ctx.state, sessions), resetsAt: null })
  return { ...FIVE_HOUR_RESET, sessionIds: held }
}

/** The reset timer fired: handle the reset and deliver the alert it produced. */
export function fireReset(ctx: AutopilotContext): void {
  const alert = handleReset(ctx)
  if (alert === null) return
  ctx.handledResetAt = ctx.deps.now()
  attempt(ctx, 'quota autopilot deliver', () => ctx.deps.deliverAlert(alert))
}

export function forget(ctx: AutopilotContext, id: Id): void {
  stopContinue(ctx, id)
  const next: QuotaAutopilotState = {
    ...ctx.state,
    sleptForQuota: ctx.state.sleptForQuota.filter((held) => held !== id),
    stoppedAtLimit: ctx.state.stoppedAtLimit.filter((held) => held !== id)
  }
  if (next.sleptForQuota.length === ctx.state.sleptForQuota.length &&
    next.stoppedAtLimit.length === ctx.state.stoppedAtLimit.length) return
  commit(ctx, next)
}

export function stop(ctx: AutopilotContext): void {
  ctx.timer.disarm()
  stopAllContinues(ctx)
}

function criticalAlert(ctx: AutopilotContext, alert: QuotaAlert): QuotaAlert {
  const action = ctx.deps.getSettings().criticalAction
  if (action === 'sleep') {
    const slept = sleepIdle(ctx)
    return slept.length === 0 ? alert : { ...alert, autoAction: 'slept', sessionIds: slept }
  }
  if (action === 'ask') {
    const ids = idleCandidates(ctx)
    return ids.length === 0 ? alert : { ...alert, sessionIds: ids }
  }
  return alert
}

function guardResetAlert(ctx: AutopilotContext, alert: QuotaAlert): QuotaAlert | null {
  const handledAt = ctx.handledResetAt
  if (handledAt !== null && ctx.deps.now() - handledAt < RESET_DEDUP_MS) return null
  return handleReset(ctx) ?? alert
}

/**
 * Guard alerts get the session actions: the critical level of EITHER window follows `criticalAction`, and only the
 * 5-hour reset wakes/offers held sessions (a weekly reset is notification-only: no 7-day holds exist).
 */
export function onAlert(ctx: AutopilotContext, alert: QuotaAlert): QuotaAlert | null {
  if (alert.kind === 'critical') return criticalAlert(ctx, alert)
  if (alert.window !== 'fiveHour') return alert
  if (alert.kind === 'reset') return guardResetAlert(ctx, alert)
  return alert
}
