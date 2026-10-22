import { ipcMain } from 'electron'
import type { AwaySummary, HookEvent, Id, QuotaAlert, QuotaAutopilotState, RuntimeState, TimelineTurn } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import type { SessionStore } from '../store'
import type { PtyManager } from '../pty/PtyManager'
import type { UsageService } from '../usage'
import { createTimelineService, type TimelineService } from '../timeline/timelineService'
import { timelineFilePath } from '../timeline/timelineFile'
import { buildAwaySummary } from '../timeline/awaySummary'
import { createQuotaAutopilot } from '../quota/autopilot'
import type { QuotaAutopilot } from '../quota/autopilotTypes'
import { quotaAutopilotFilePath } from '../quota/autopilotStore'
import { createUserPresence, type UserPresence } from './userPresence'
import { assertId } from './ipcValidation'
import type { RuntimeRegistry } from './runtimeRegistry'
import type { SessionController } from './sessionController'

const MS_PER_MINUTE = 60_000

export interface FeatureWiringDeps {
  readonly userDataDir: string
  readonly store: SessionStore
  readonly runtime: RuntimeRegistry
  readonly usage: UsageService
  readonly pty: PtyManager
  readonly controller: SessionController
  /** Sends an event to the renderer when the window is alive; a no-op otherwise. */
  readonly send: (channel: string, ...args: unknown[]) => void
  /** Toast + sound + desktop notice for an alert the autopilot raised itself. */
  readonly deliverAlert: (alert: QuotaAlert) => void
  readonly onError: (where: string, error: unknown) => void
}

/** Timeline + away summary (D29) and quota autopilot (D30), wired to the rest of the main process. */
export interface FeatureWiring {
  readonly timeline: TimelineService
  readonly autopilot: QuotaAutopilot
  readonly presence: UserPresence
  onHookEvent(event: HookEvent): void
  /** A Claude turn submitted in this process was cut off by the usage limit. */
  onUsageLimit(id: Id): void
  /** A key, click or wheel in the window, or typing into a terminal. */
  onUserActivity(): void
  /** Reads the timeline file. Call before the hook server starts so no event lands on an empty state. */
  loadTimeline(): Promise<void>
  /** Reads the autopilot state and arms its reset timer. Call once the window exists so its alerts are seen. */
  startAutopilot(): Promise<void>
  registerIpc(): void
  /** Stops timers and writes the timeline file. */
  shutdown(): Promise<void>
}

function runtimeMap(runtime: RuntimeRegistry): ReadonlyMap<Id, RuntimeState> {
  return new Map(runtime.snapshot().map((state): [Id, RuntimeState] => [state.sessionId, state]))
}

function asWakeOptions(raw: unknown): { readonly sendContinue: boolean } {
  if (typeof raw !== 'object' || raw === null || typeof (raw as { sendContinue?: unknown }).sendContinue !== 'boolean') {
    throw new Error('Invalid wake options: expected { sendContinue: boolean }')
  }
  return { sendContinue: (raw as { sendContinue: boolean }).sendContinue }
}

export function createFeatureWiring(deps: FeatureWiringDeps): FeatureWiring {
  const { store, runtime, usage, pty, controller, send, onError } = deps
  let lastAway: AwaySummary | null = null
  // The quota IPC answers only after the state file was read, so a click during startup cannot be overwritten by load().
  let autopilotReady: Promise<void> = Promise.resolve()

  const timeline = createTimelineService({
    filePath: timelineFilePath(deps.userDataDir),
    now: () => Date.now(),
    getSessionCost: (id) => usage.getState().sessions.find((s) => s.sessionId === id)?.costUsd ?? null,
    onChange: (id) => send(IPC.evTimeline, id),
    onError
  })

  const autopilot = createQuotaAutopilot({
    filePath: quotaAutopilotFilePath(deps.userDataDir),
    now: () => Date.now(),
    getSettings: () => store.getSettings().quota,
    getUsage: () => usage.getState(),
    listSessions: () => store.get().sessions,
    getRuntime: () => runtimeMap(runtime),
    sleepSession: (id) => controller.sleepSession(id),
    wakeSession: (id) => controller.wakeSession(id),
    writeToSession: (id, data) => controller.writeToPty(id, data),
    subscribeOutput: (callback) => pty.onData((id) => callback(id)),
    deliverAlert: deps.deliverAlert,
    onStateChange: (state: QuotaAutopilotState) => send(IPC.evQuotaAutopilot, state),
    onError
  })

  const presence = createUserPresence({
    now: () => Date.now(),
    getAwayAfterMs: () => {
      const away = store.getSettings().away
      return away.enabled ? away.afterMinutes * MS_PER_MINUTE : null
    },
    onReturn: (since, until) => {
      const summary = buildAwaySummary({
        since,
        until,
        turns: timeline.all(),
        sessions: store.get().sessions,
        runtime: runtimeMap(runtime),
        lastSleptAt: (id) => timeline.lastSleptAt(id)
      })
      if (summary.sessions.length === 0) return
      lastAway = summary
      send(IPC.evAwaySummary, summary)
    },
    onError
  })

  wireSessionEnds(store, runtime, timeline)
  wireRemovals(store, timeline, autopilot)
  // Turn costs settle from statusLine updates; a newer 5-hour reset time can arrive the same way.
  usage.onChange((state) => {
    for (const entry of state.sessions) timeline.onCostChanged(entry.sessionId)
    autopilot.onUsageChanged()
  })

  return {
    timeline,
    autopilot,
    presence,
    onHookEvent: (event) => timeline.onHook(event),
    onUsageLimit: (id) => {
      timeline.onUsageLimit(id)
      autopilot.onUsageLimit(id)
    },
    onUserActivity: () => presence.noteInput(),
    loadTimeline: () => timeline.load(),
    startAutopilot: () => {
      autopilotReady = autopilot.load()
      return autopilotReady
    },
    registerIpc: () => {
      ipcMain.handle(IPC.timelineGet, (_event, rawId: unknown): readonly TimelineTurn[] => timeline.get(assertId(rawId, 'session id')))
      ipcMain.handle(IPC.awayGetLast, (): AwaySummary | null => lastAway)
      ipcMain.handle(IPC.quotaAutopilotGet, async (): Promise<QuotaAutopilotState> => {
        await autopilotReady
        return autopilot.getState()
      })
      ipcMain.handle(IPC.quotaSleepIdle, async (): Promise<readonly Id[]> => {
        await autopilotReady
        return autopilot.sleepIdle()
      })
      ipcMain.handle(IPC.quotaWake, async (_event, raw: unknown): Promise<readonly Id[]> => {
        const options = asWakeOptions(raw)
        await autopilotReady
        return autopilot.wake(options)
      })
    },
    shutdown: async () => {
      autopilot.stop()
      await timeline.flush()
    }
  }
}

/** Ends a running turn when its session sleeps, is closed or its process exits. */
function wireSessionEnds(store: SessionStore, runtime: RuntimeRegistry, timeline: TimelineService): void {
  const previous = new Map<Id, RuntimeState>()
  runtime.subscribe((state) => {
    const id = state.sessionId
    const before = previous.get(id)
    previous.set(id, state)
    if (before === undefined) return
    if (state.sleeping === true && before.sleeping !== true) {
      timeline.onSessionEnded(id, 'slept')
      return
    }
    if (before.run === 'running' && state.run === 'exited' && state.sleeping !== true) {
      const closed = store.get().sessions.find((s) => s.id === id)?.closedAt !== undefined
      timeline.onSessionEnded(id, closed ? 'closed' : 'exited')
    }
  })
}

/** Removed sessions leave the timeline; removed or closed sessions leave the autopilot's held lists. */
function wireRemovals(store: SessionStore, timeline: TimelineService, autopilot: QuotaAutopilot): void {
  let known = new Set(store.get().sessions.map((s) => s.id))
  store.subscribe((data) => {
    const live = new Set(data.sessions.map((s) => s.id))
    for (const id of known) {
      if (!live.has(id)) {
        timeline.forget(id)
        autopilot.forget(id)
      }
    }
    for (const session of data.sessions) {
      if (session.closedAt !== undefined) autopilot.forget(session.id)
    }
    known = live
  })
}
