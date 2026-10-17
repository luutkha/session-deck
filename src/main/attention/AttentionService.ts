import { randomBytes } from 'node:crypto'
import type { HookEvent, AttentionReason, SoundEvent } from '../../shared/types'
import { createHookServer, type HookServer } from './HookServer'
import { createIdleDetector } from './IdleDetector'
import { createAttentionManager } from './AttentionManager'
import { createNotifier } from './Notifier'
import { writeSettingsFile } from './claudeSettings'
import { writeOpencodePlugin, opencodePluginEnv } from '../opencode'

export interface AttentionServiceDeps {
  readonly isKnownSession: (id: string) => boolean
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
}

export interface AttentionService {
  start(): Promise<void>
  stop(): Promise<void>
  claudeArgs(): string[]
  envFor(sessionId: string): Record<string, string>
  /** Env entries for an OpenCode session (its injected plugin, permission bypass). Throws when not started. */
  opencodeEnv(): Record<string, string>
  noteOutput(id: string): void
  noteInput(id: string): void
  clear(id: string): void
  get(id: string): AttentionReason | null
  onChange(callback: (id: string, reason: AttentionReason | null) => void): () => void
  setSoundEnabled(enabled: boolean): void
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
    onHookEvent
  } = deps

  let hookServer: HookServer | null = null
  let settingsFilePath: string | null = null
  let pluginFilePath: string | null = null
  let port: number | null = null
  let started = false

  const attentionManager = createAttentionManager({ isFocused })
  const notifier = createNotifier({ beep, flash, isWindowFocused })
  // Output pauses are NOT a reason to ping: Claude goes quiet while thinking or running tools. Only the Stop hook
  // (turn finished) and the Notification hook (permission / question) raise attention.
  const idleDetector = createIdleDetector({
    onIdle: () => undefined
  })

  const unsubscribeManager = attentionManager.onChange((id, reason) => {
    if (reason !== null) {
      notifier.notify(id, reason)
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
        onStatusLine: (sessionId, payload) => onStatusLine?.(sessionId, payload)
      })

      const { port: serverPort } = await hookServer.start()
      port = serverPort

      settingsFilePath = writeSettingsFile(settingsDir)
      pluginFilePath = writeOpencodePlugin(settingsDir)
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

    get(id: string): AttentionReason | null {
      return attentionManager.get(id)
    },

    onChange(callback: (id: string, reason: AttentionReason | null) => void): () => void {
      return attentionManager.onChange(callback)
    },

    setSoundEnabled(enabled: boolean): void {
      notifier.setSoundEnabled(enabled)
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