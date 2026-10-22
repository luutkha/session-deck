import { randomBytes } from 'node:crypto'
import type { HookEvent, AttentionReason, SoundEvent } from '../../shared/types'
import { createHookServer, type HookServer } from './HookServer'
import { createIdleDetector } from './IdleDetector'
import { createAttentionManager } from './AttentionManager'
import { createNotifier } from './Notifier'
import { writeSettingsFile } from './claudeSettings'
import { writeOpencodePlugin, opencodePluginEnv } from '../opencode'
import { writeWorkerPlugin, workerPluginEnv } from '../workers/workerPluginEnv'

export interface AttentionServiceDeps {
  readonly isKnownSession: (id: string) => boolean
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
}

export interface AttentionService {
  start(): Promise<void>
  stop(): Promise<void>
  claudeArgs(): string[]
  envFor(sessionId: string): Record<string, string>
  /** Env entries for an OpenCode session (its injected plugin, permission bypass). Throws when not started. */
  opencodeEnv(): Record<string, string>
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
    onStatusLine,
    onHookEvent,
    onWorkerEvent
  } = deps

  let hookServer: HookServer | null = null
  let settingsFilePath: string | null = null
  let pluginFilePath: string | null = null
  let workerPluginPath: string | null = null
  let port: number | null = null
  let started = false

  const attentionManager = createAttentionManager()
  const notifier = createNotifier({ beep, flash, isWindowFocused })
  // Output pauses are NOT a reason to ping: Claude goes quiet while thinking or running tools. Only the Stop hook
  // (turn finished) and the Notification hook (permission / question) raise attention.
  const idleDetector = createIdleDetector({
    onIdle: () => undefined
  })

  const unsubscribeManager = attentionManager.onChange((id, reason) => {
    if (reason !== null) {
      // The session on screen still gets the bell, but no sound or flash: the user is already looking at it.
      if (!isFocused(id)) notifier.notify(id, reason)
    } else {
      notifier.stopFlash()
    }
  })

  function handleHook(event: HookEvent): void {
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
        onStatusLine: (sessionId, payload) => onStatusLine?.(sessionId, payload),
        onWorkerEvent
      })

      const { port: serverPort } = await hookServer.start()
      port = serverPort

      settingsFilePath = writeSettingsFile(settingsDir)
      pluginFilePath = writeOpencodePlugin(settingsDir)
      workerPluginPath = writeWorkerPlugin(settingsDir)
      started = true
    },

    async stop(): Promise<void> {
      if (!started) return

      unsubscribeManager()

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

    opencodeEnv(): Record<string, string> {
      if (!started || pluginFilePath === null) {
        throw new Error('AttentionService not started')
      }
      return opencodePluginEnv(pluginFilePath)
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
      attentionManager.forget(id)
      idleDetector.forget(id)
    },

    raise(id: string, reason: AttentionReason): void {
      attentionManager.raise(id, reason)
    }
  }
}