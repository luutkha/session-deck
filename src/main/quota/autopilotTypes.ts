import type { Id, QuotaAlert, QuotaAutopilotState, QuotaSettings, RuntimeState, Session, UsageState } from '../../shared/types'

export type TimerHandle = ReturnType<typeof setTimeout>

export interface QuotaAutopilotDeps {
  /** <userData>/quota-autopilot.json (see autopilotStore.ts). */
  readonly filePath: string
  /** Epoch milliseconds. */
  readonly now: () => number
  readonly getSettings: () => QuotaSettings
  readonly getUsage: () => UsageState
  readonly listSessions: () => readonly Session[]
  readonly getRuntime: () => ReadonlyMap<Id, RuntimeState>
  readonly sleepSession: (id: Id) => void
  /** Returns true when the wake was started (see SessionController.wakeSession). */
  readonly wakeSession: (id: Id) => boolean
  readonly writeToSession: (id: Id, data: string) => void
  /** Calls back with the session id for every output chunk; returns the unsubscribe function. */
  readonly subscribeOutput: (callback: (id: Id) => void) => () => void
  /** Toast + sound + desktop notice for an alert the autopilot raised itself (see quotaWiring deliverQuotaAlert). */
  readonly deliverAlert: (alert: QuotaAlert) => void
  /** Hands-off automation could not continue a held session (the "continue" gave up, or the wake failed): the user must be pinged. */
  readonly onContinueFailed?: (id: Id) => void
  readonly onStateChange: (state: QuotaAutopilotState) => void
  readonly onError: (where: string, error: unknown) => void
  readonly setTimeout?: (callback: () => void, ms: number) => TimerHandle
  readonly clearTimeout?: (handle: TimerHandle) => void
}

export interface WakeOptions {
  /** Type "continue" into the sessions whose turn was cut off by the usage limit (settings.quota.continueOnWake). */
  readonly sendContinue: boolean
}

export interface QuotaAutopilot {
  /** Reads the persisted state and arms the reset timer. A missing file is empty; a corrupt one is empty and reported. */
  load(): Promise<void>
  /** Open, running, not asleep, not working or waiting for the user, not kept awake, no Remote Control. */
  idleCandidates(): Id[]
  /** Called for every guard alert before delivery. Returns the alert to deliver (maybe with session actions) or null. */
  onAlert(alert: QuotaAlert): QuotaAlert | null
  /** Sleeps every idle candidate and holds it for the next 5-hour reset. Returns the ids that were slept. */
  sleepIdle(): Id[]
  /** A Claude turn was cut off by the usage limit: holds the session for the next 5-hour reset. */
  onUsageLimit(id: Id): void
  /** New usage data arrived: adopts a newer 5-hour reset time while sessions are held. */
  onUsageChanged(): void
  /** Wakes the held sessions. Returns the ids woken or sent "continue". */
  wake(options: WakeOptions): Id[]
  getState(): QuotaAutopilotState
  /** Drops a removed or closed session from the held lists. */
  forget(id: Id): void
  /** Clears the reset timer and any pending "continue" waiters. */
  stop(): void
}
