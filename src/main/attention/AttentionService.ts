import { randomBytes } from 'node:crypto'
import type { HookEvent, AttentionReason, ReminderSettings, SoundEvent } from '../../shared/types'
import { createHookServer, type HookServer } from './HookServer'
import { createIdleDetector } from './IdleDetector'
import { createAttentionManager } from './AttentionManager'
import { createNotifier } from './Notifier'
import {
  REMINDER_TICK_MS,
  dueReminders,
  emptyReminderState,
  noteCleared,
  noteRaised,
  noteReminded,
  type ReminderState
} from './reminder'
import { writeSettingsFile } from './claudeSettings'
import { writeOpencodePlugin, opencodePluginEnv, OPENCODE_PLUGIN_ENV_VAR } from '../opencode'
import type { OpencodePermissionPolicy } from '../opencode/pluginEnv'
import { writeWorkerPlugin, workerPluginEnv } from '../workers/workerPluginEnv'
import { isRecord } from '../../shared/guards'

export interface AttentionServiceDeps {
  readonly isKnownSession: (id: string) => boolean
  /**
   * True when this process id must not drive the session's attention/status/usage: a worker child process of an
   * OpenCode session (the owner process is learned first through the worker plugin's `hello`, see WorkerHub).
   */
  readonly isIgnoredProcess?: (sessionId: string, proc: string) => boolean
  /** True when the session is on screen in the focused window: its attention is shown but never pings. */
  readonly isFocused: (id: string) => boolean
  /** Called with the session id and sound event when a sound should play (sound enabled and debounce elapsed). */
  readonly beep: (id: string, event: SoundEvent) => void
  readonly flash: (on: boolean) => void
  readonly isWindowFocused: () => boolean
  readonly settingsDir: string
  readonly token?: string
  /** Called with the session id and the statusLine JSON object (already authenticated and session-checked). */
  readonly onStatusLine?: (sessionId: string, payload: unknown) => void
  /** Called for every accepted hook event (Notification, Stop, UserPromptSubmit), after attention is updated. */
  readonly onHookEvent?: (event: HookEvent) => void
  /** Called with each payload of the OpenCode worker plugin (already authenticated and session-checked). Return false to reject. */
  readonly onWorkerEvent?: (sessionId: string, payload: unknown) => boolean
  /** Store-backed reminder settings, read on every tick so a change applies without a restart. */
  readonly getReminderSettings?: () => ReminderSettings
  /** Called when a still-unread session's alert repeats (sound/flash already requested). */
  readonly onReminder?: (id: string, reason: AttentionReason) => void
  /** Clock for the reminder bookkeeping (tests). */
  readonly now?: () => number
  /** How often due reminders are checked (tests). */
  readonly reminderTickMs?: number
}

export interface AttentionService {
  start(): Promise<void>
  stop(): Promise<void>
  claudeArgs(): string[]
  envFor(sessionId: string): Record<string, string>
  /** Env entries for an OpenCode session (its injected plugin, permission policy). Throws when not started. */
  opencodeEnv(permissionPolicy?: OpencodePermissionPolicy): Record<string, string>
  /** Env entries for a Claude terminal so OpenCode processes it starts report to the worker tabs. Throws when not started. */
  workerEnv(): Record<string, string>
  /** Where the local hook server listens and its token (diagnostics and tests). Throws when not started. */
  endpoint(): { readonly port: number; readonly token: string }
  noteOutput(id: string): void
  noteInput(id: string): void
  clear(id: string): void
  markUnread(id: string): void
  get(id: string): AttentionReason | null
  onChange(callback: (id: string, reason: AttentionReason | null) => void): () => void
  setSoundEnabled(enabled: boolean): void
  /** The session's process stops but the session stays (sleep): drop idle timers, keep the bell. */
  suspend(id: string): void
  forget(id: string): void
  raise(id: string, reason: AttentionReason): void
}

export function createAttentionService(deps: AttentionServiceDeps): AttentionService {
  const {
    isKnownSession,
    isFocused,
    beep,
    flash,
    isWindowFocused,
    settingsDir,
    token = randomBytes(24).toString('hex'),
    isIgnoredProcess,
    onStatusLine,
    onHookEvent,
    onWorkerEvent,
    getReminderSettings,
    onReminder,
    now = () => Date.now(),
    reminderTickMs = REMINDER_TICK_MS
  } = deps

  let hookServer: HookServer | null = null
  let settingsFilePath: string | null = null
  let pluginFilePath: string | null = null
  let workerPluginPath: string | null = null
  let port: number | null = null
  let started = false
  let reminderTimer: ReturnType<typeof setInterval> | null = null
  let reminders: ReminderState = emptyReminderState()

  const attentionManager = createAttentionManager()
  const notifier = createNotifier({ beep, flash, isWindowFocused, now })
  // Output pauses are NOT a reason to ping: Claude goes quiet while thinking or running tools. Only the Stop hook
  // (turn finished) and the Notification hook (permission / question) raise attention.
  const idleDetector = createIdleDetector({
    onIdle: () => undefined
  })

  const unsubscribeManager = attentionManager.onChange((id, reason) => {
    if (reason !== null) {
      // Arm (or re-arm on a priority upgrade) the reminder; unread is handled inside noteRaised and never schedules.
      reminders = noteRaised(reminders, id, now(), reason)
      // The session on screen still gets the bell, but no sound or flash: the user is already looking at it.
      if (!isFocused(id)) notifier.notify(id, reason)
    } else {
      reminders = noteCleared(reminders, id)
      notifier.stopFlash()
    }
  })

  /**
   * Repeats the alert for sessions that are still needs-you and unread. The session on screen is skipped but still
   * counts as snoozed for one interval, so leaving it does not immediately ping.
   */
  function runReminderTick(): void {
    const settings = getReminderSettings?.()
    if (settings === undefined) return
    const at = now()
    for (const id of dueReminders(reminders, settings, at)) {
      const reason = attentionManager.get(id)
      if (reason === null || reason === 'unread') {
        reminders = noteCleared(reminders, id)
        continue
      }
      reminders = noteReminded(reminders, id, at)
      if (isFocused(id)) continue
      notifier.notify(id, reason)
      onReminder?.(id, reason)
    }
  }

  function isIgnored(sessionId: string, proc: string | undefined): boolean {
    return proc !== undefined && isIgnoredProcess !== undefined && isIgnoredProcess(sessionId, proc)
  }

  function handleHook(event: HookEvent): void {
    // A worker child of an OpenCode session must not raise attention, change activity/status or the timeline.
    if (isIgnored(event.sessionId, event.proc)) return
    attentionManager.handleHook(event)
    onHookEvent?.(event)
  }

  return {
    async start(): Promise<void> {
      if (started) return

      hookServer = createHookServer({
        token,
        isKnownSession,
        onEvent: handleHook,
        onStatusLine: (sessionId, payload) => {
          // A worker child's statusline must not add its cost to the parent session's usage.
          if (isRecord(payload) && isIgnored(sessionId, typeof payload.proc === 'string' ? payload.proc : undefined)) return
          onStatusLine?.(sessionId, payload)
        },
        onWorkerEvent
      })

      const { port: serverPort } = await hookServer.start()
      port = serverPort

      settingsFilePath = writeSettingsFile(settingsDir)
      pluginFilePath = writeOpencodePlugin(settingsDir)
      workerPluginPath = writeWorkerPlugin(settingsDir)
      if (getReminderSettings !== undefined) {
        reminderTimer = setInterval(runReminderTick, reminderTickMs)
      }
      started = true
    },

    async stop(): Promise<void> {
      if (!started) return

      unsubscribeManager()
      if (reminderTimer !== null) {
        clearInterval(reminderTimer)
        reminderTimer = null
      }
      reminders = emptyReminderState()

      if (hookServer) {
        await hookServer.stop()
        hookServer = null
      }

      port = null
      settingsFilePath = null
      pluginFilePath = null
      workerPluginPath = null
      started = false
    },

    claudeArgs(): string[] {
      if (!started || !settingsFilePath) {
        throw new Error('AttentionService not started')
      }
      return ['--settings', settingsFilePath]
    },

    envFor(sessionId: string): Record<string, string> {
      if (!started || port === null) {
        throw new Error('AttentionService not started')
      }
      return {
        SESSIONDECK_SESSION_ID: sessionId,
        SESSIONDECK_PORT: String(port),
        SESSIONDECK_TOKEN: token
      }
    },

    opencodeEnv(permissionPolicy: OpencodePermissionPolicy = 'yolo'): Record<string, string> {
      if (!started || pluginFilePath === null || workerPluginPath === null) {
        throw new Error('AttentionService not started')
      }
      // The worker plugin loads first, so the parent (owner) OpenCode process reports itself before it can start
      // any worker; the session plugin follows (see docs/DECISIONS D19 and the worker-tabs handshake).
      return opencodePluginEnv([workerPluginPath, pluginFilePath], process.env[OPENCODE_PLUGIN_ENV_VAR], permissionPolicy)
    },

    workerEnv(): Record<string, string> {
      if (!started || workerPluginPath === null) {
        throw new Error('AttentionService not started')
      }
      return workerPluginEnv(workerPluginPath)
    },

    endpoint(): { readonly port: number; readonly token: string } {
      if (!started || port === null) {
        throw new Error('AttentionService not started')
      }
      return { port, token }
    },

    noteOutput(id: string): void {
      idleDetector.noteOutput(id)
    },

    noteInput(id: string): void {
      idleDetector.noteInput(id)
      attentionManager.clear(id)
    },

    clear(id: string): void {
      attentionManager.clear(id)
    },

    markUnread(id: string): void {
      if (isKnownSession(id)) {
        attentionManager.markUnread(id)
      }
    },

    get(id: string): AttentionReason | null {
      return attentionManager.get(id)
    },

    onChange(callback: (id: string, reason: AttentionReason | null) => void): () => void {
      return attentionManager.onChange(callback)
    },

    setSoundEnabled(enabled: boolean): void {
      notifier.setSoundEnabled(enabled)
    },

    suspend(id: string): void {
      idleDetector.forget(id)
    },

    forget(id: string): void {
      reminders = noteCleared(reminders, id)
      attentionManager.forget(id)
      idleDetector.forget(id)
    },

    raise(id: string, reason: AttentionReason): void {
      attentionManager.raise(id, reason)
    }
  }
}