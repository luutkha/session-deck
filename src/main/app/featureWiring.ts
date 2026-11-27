import { ipcMain } from 'electron'
import type { AwaySummary, HookEvent, Id, QuotaAlert, QuotaAutopilotState, RuntimeState, TimelineTurn } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import type { SessionStore } from '../store'
import type { PtyManager } from '../pty/PtyManager'
import type { UsageService } from '../usage'
import { wireProviderUsage } from '../usage/providers/providerUsageWiring'
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
  /** Desktop notice + sound when the hands-off autopilot could not continue a held session (D33). */
  readonly notifyContinueFailed?: (sessionName: string) => void
  readonly onError: (where: string, error: unknown) => void
}

/** Timeline + away summary (D29) and quota autopilot (D30), wired to the rest of the main process. */
export interface FeatureWiring {
  readonly timeline: TimelineService
  readonly autopilot: QuotaAutopilot
  readonly presence: UserPresence
  /** D54: the last "While you were away" summary of this run (null before the first one). */
  lastAway(): AwaySummary | null
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
  // D79: advisory notices (an ambiguous OpenCode conversation, for one) use the renderer's existing banner.
  controller.setNoticeHandler((message: string): void => {
    try {
      send(IPC.evNotice, message)
    } catch (error) {
      onError('session notice', error)
    }
  })
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
    // Shell sessions (Code mode) run dev servers and have no conversation to resume: never slept for the quota.
    listSessions: () => store.get().sessions.map((s) => (s.agent === 'shell' ? { ...s, keepAwake: true } : s)),
    getRuntime: () => runtimeMap(runtime),
    sleepSession: (id) => controller.sleepSession(id),
    wakeSession: (id) => controller.wakeSession(id),
    writeToSession: (id, data) => controller.writeToPty(id, data),
    subscribeOutput: (callback) => pty.onData((id) => callback(id)),
    deliverAlert: deps.deliverAlert,
    onContinueFailed: deps.notifyContinueFailed === undefined
      ? undefined
      : (id) => {
          const name = store.get().sessions.find((s) => s.id === id)?.name
          try {
            deps.notifyContinueFailed?.(name ?? id)
          } catch (error) {
            onError('quota continue notice', error)
          }
        },
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
  // Go bars are display-only: main enforces the toggle, so a disabled provider drops at once and later
  // Go payloads are ignored without restarting any OpenCode session.
  usage.setOpencodeGoEnabled(store.getSettings().quota.showOpencodeGo)
  const unwatchGoSetting = store.subscribe(() => {
    try {
      usage.setOpencodeGoEnabled(store.getSettings().quota.showOpencodeGo)
    } catch (error) {
      onError('usage provider setting', error)
    }
  })
  // Codex, Cursor, Kimi and Grok quota bars: polled from each agent's own login while a session of it is open (D96).
  const providerUsage = wireProviderUsage(store, usage, onError)
  // Turn costs settle from statusLine updates; a newer 5-hour reset time can arrive the same way. Only the session
  // whose entry changed can have a new cost, so the timeline is touched for that one (not for all sessions).
  usage.onChange((_state, sessionId) => {
    if (sessionId !== undefined) timeline.onCostChanged(sessionId)
    autopilot.onUsageChanged()
  })

  return {
    timeline,
    autopilot,
    presence,
    lastAway: () => lastAway,
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
      unwatchGoSetting()
      providerUsage.stop()
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
