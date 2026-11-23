// Jarvis (D53): one Claude Code session that controls SessionDeck through a local MCP server. This file connects the
// pieces: the MCP server and its tools, the files Jarvis is launched with, the Yes/No round trip to the window, and
// the jarvis:* IPC. Only the Jarvis session gets the MCP config; the user's ~/.claude is never touched.
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, stat, truncate, writeFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { HookEvent, JarvisConfirmRequest, JarvisSchedule, JarvisSettings, JarvisUiAction, JarvisUiCommand, JarvisVoiceResult, Session, UiMode } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { assertBoolean, assertNonEmptyString } from '../app/ipcValidation'
import { sessionModelProblem, type SessionController } from '../app/sessionController'
import type { SessionStore } from '../store'
import { createMcpHttpServer } from './mcpHttpServer'
import type { McpTool } from './mcpProtocol'
import { CONFIRM_TIMEOUT_MS, JARVIS_NAME, jarvisLaunchArgs, jarvisOpencodeConfig, jarvisSystemPrompt, jarvisPaths, mcpConfigText } from './jarvisLaunch'
import type { LaunchExtras } from '../app/startOptions'
import { createJarvisTools, type ConfirmRequest, type JarvisToolDeps } from './jarvisTools'
import { isJarvis } from './targets'
import { optionalBool, schema } from './toolArgs'
import { createScheduleService } from './scheduleService'
import { scheduleWhen } from './schedules'

const RESTART_DELAY_MS = 2500

/** D80 test seam: SESSIONDECK_WATCH_WAITING_MS / SESSIONDECK_WATCH_STUCK_MS (whole ms, 1000..1 day) shorten the watch limits; anything else keeps the defaults. */
export function watchLimitsFromEnv(env: Readonly<Record<string, string | undefined>>): WatchLimits {
  const read = (name: string, fallback: number): number => {
    const value = Number(env[name])
    return Number.isInteger(value) && value >= 1000 && value <= 86_400_000 ? value : fallback
  }
  return { waitingMs: read('SESSIONDECK_WATCH_WAITING_MS', DEFAULT_WATCH_LIMITS.waitingMs), stuckMs: read('SESSIONDECK_WATCH_STUCK_MS', DEFAULT_WATCH_LIMITS.stuckMs) }
}
import { createVoiceListener } from './voice'
import { collectFleetDigest, collectWatchRows, planPhaseOf } from './digestTools'
import { createWatchService, DEFAULT_WATCH_LIMITS, type WatchLimits } from './watchService'
import { createPlanService } from './planService'
import { createPlanTools } from './planTools'
import { resolveSession } from './targets'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'

const ACTION_LOG_MAX_BYTES = 1024 * 1024
/** D55: how long a window may take to carry out a screen command (a mode switch remounts the workspace). */
const UI_TIMEOUT_MS = 10_000

export interface JarvisWiringDeps {
  readonly userDataDir: string
  readonly store: SessionStore
  readonly controller: SessionController
  /** Everything the tools need besides what this file provides (confirm, log, ids, clocks). */
  readonly tools: Omit<JarvisToolDeps, 'confirm' | 'log' | 'newId' | 'now' | 'sleep' | 'getData' | 'controller' | 'schedules' | 'ui'>
  /** Sends the Yes/No request to the main window; false when there is no window to ask. */
  readonly sendConfirm: (request: JarvisConfirmRequest) => boolean
  /** D55: sends a screen command to the window that shows that mode; false when there is no window. */
  readonly sendUi: (command: JarvisUiCommand) => boolean
  readonly appVersion: string
  /** Sends an event to every open window (the schedule list). */
  readonly broadcast: (channel: string, ...args: unknown[]) => void
  /** A desktop notice (a schedule started). */
  readonly notify: (title: string, body: string) => void
  readonly onError: (where: string, error: unknown) => void
}

export interface JarvisWiring {
  /** Starts the MCP server and writes the launch files. Call before any session can start (resume on launch). */
  start(): Promise<void>
  /** Trusted Claude launch arguments for a session: only Jarvis gets any. */
  launchExtrasFor(session: Session): LaunchExtras
  /** D54: a hook event of any session; a finished Jarvis turn (Claude) sends its reply text to the windows. */
  onHookEvent(event: HookEvent): void
  registerIpc(): void
  stop(): Promise<void>
}

/** D54/D79: what a Settings change to Jarvis's engine or OpenCode model needs the next time Jarvis opens. */
export type JarvisSwitchPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'model'; readonly model: string | undefined }
  | { readonly kind: 'recreate' }

/**
 * D54: another engine cannot continue this conversation, so Jarvis is recreated. D79: an OpenCode model change on an
 * OpenCode Jarvis KEEPS the conversation (the controller restarts it on the new model and resumes with `-s`); the
 * Claude model is a launch argument and needs nothing here. A model id the per-session rule refuses still switches
 * (as a new conversation), so a value already stored in Settings can never stop Jarvis from opening.
 */
export function jarvisSwitchPlan(current: Session | undefined, settings: JarvisSettings): JarvisSwitchPlan {
  if (current === undefined) return { kind: 'none' }
  if ((current.agent ?? 'claude') !== settings.agent) return { kind: 'recreate' }
  if (settings.agent !== 'opencode' || (current.model ?? '') === settings.opencodeModel) return { kind: 'none' }
  const model = settings.opencodeModel.trim()
  if (model.length > 0 && sessionModelProblem(model) !== null) return { kind: 'recreate' }
  return { kind: 'model', model: model.length > 0 ? model : undefined }
}

export function createJarvisWiring(deps: JarvisWiringDeps): JarvisWiring {
  const paths = jarvisPaths(deps.userDataDir)
  const token = randomBytes(32).toString('hex')
  const pending = new Map<string, { resolve: (yes: boolean) => void; timer: ReturnType<typeof setTimeout> }>()
  let started = false
  let port = 0

  function confirm(request: ConfirmRequest): Promise<boolean> {
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve(false)
      }, CONFIRM_TIMEOUT_MS)
      pending.set(id, { resolve, timer })
      if (!deps.sendConfirm({ id, ...request })) {
        clearTimeout(timer)
        pending.delete(id)
        resolve(false)
      }
    })
  }

  function answer(id: string, yes: boolean): void {
    const entry = pending.get(id)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    pending.delete(id)
    entry.resolve(yes)
  }

  // D55: a screen command goes to the window, which answers with jarvis:uiReply (ok + what it did).
  const pendingUi = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  function ui(mode: UiMode | undefined, action: JarvisUiAction): Promise<string> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingUi.delete(id)
        reject(new Error('The SessionDeck window did not answer. Is it open?'))
      }, UI_TIMEOUT_MS)
      pendingUi.set(id, { resolve, reject, timer })
      if (!deps.sendUi({ id, ...(mode !== undefined ? { mode } : {}), action })) {
        clearTimeout(timer)
        pendingUi.delete(id)
        reject(new Error('There is no SessionDeck window to change.'))
      }
    })
  }
  function uiAnswer(id: string, ok: boolean, text: string): void {
    const entry = pendingUi.get(id)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    pendingUi.delete(id)
    if (ok) entry.resolve(text)
    else entry.reject(new Error(text))
  }

  function log(tool: string, detail: string): void {
    const line = `${JSON.stringify({ at: new Date().toISOString(), tool, detail })}\n`
    appendFile(paths.log, line, 'utf-8').catch((error: unknown) => deps.onError('jarvis action log', error))
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  // D54: scheduled instructions are given to Jarvis as a prompt (the same sender as send_prompt: start/wake Jarvis,
  // wait until ready, or queue behind a running turn). A fresh Jarvis may still show its folder-trust question for a
  // moment (answered by itself), so that answer is retried.
  async function deliver(schedule: JarvisSchedule): Promise<void> {
    const session = await serial(openJarvis)
    const message = `[Scheduled task${schedule.label ? ` "${schedule.label}"` : ''}, ${scheduleWhen(schedule)}] ${schedule.instruction}`
    deps.notify('Jarvis', `Running the scheduled task: ${schedule.label || schedule.instruction.slice(0, 80)}`)
    let result = await tools.sendPrompt(session, message, 'auto')
    for (let attempt = 0; attempt < 3 && /trust its folder/.test(result); attempt += 1) {
      await sleep(3000)
      result = await tools.sendPrompt(session, message, 'auto')
    }
    log('schedule_run', `${scheduleWhen(schedule)}: ${result}`)
  }

  // D54: voice input (Windows speech recognition) -> the same sender as send_prompt, into Jarvis.
  const voice = createVoiceListener({ wavFile: () => process.env.SESSIONDECK_VOICE_WAV ?? null, platform: process.platform })
  async function voiceCommand(): Promise<JarvisVoiceResult> {
    const heard = await voice.listen()
    if (heard === null) return { heard: null, result: null }
    const session = await serial(openJarvis)
    log('voice', heard)
    return { heard, result: await tools.sendPrompt(session, heard, 'auto') }
  }

  const schedules = createScheduleService({
    readFile: () => readFile(paths.schedules, 'utf-8'),
    writeFile: (text) => writeFile(paths.schedules, text, 'utf-8'),
    now: () => Date.now(),
    newId: () => randomUUID().slice(0, 8),
    deliver,
    onChange: (list) => deps.broadcast(IPC.evJarvisSchedules, list),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer),
    onError: deps.onError
  })

  const toolDeps: JarvisToolDeps = {
    ...deps.tools,
    schedules,
    getData: () => deps.store.get(),
    controller: deps.controller,
    ui,
    confirm,
    log,
    newId: () => randomUUID(),
    now: () => Date.now(),
    sleep
  }
  const tools = createJarvisTools(toolDeps)

  // D80: watch mode (a timer tells Jarvis when a session waits for the user or looks stuck) and task plans (a goal split
  // into steps that run in sessions). Both are off until Settings turns them on and read the setting every time.
  async function deliverToJarvis(message: string): Promise<void> {
    const session = await serial(openJarvis)
    let result = await tools.sendPrompt(session, message, 'auto')
    for (let attempt = 0; attempt < 3 && /trust its folder/.test(result); attempt += 1) {
      await sleep(3000)
      result = await tools.sendPrompt(session, message, 'auto')
    }
  }
  const watch = createWatchService({
    settings: () => {
      const jarvis = deps.store.getSettings().jarvis
      return { enabled: jarvis.watchEnabled, everyMinutes: jarvis.watchEveryMinutes }
    },
    rows: () => collectWatchRows(toolDeps),
    limits: watchLimitsFromEnv(process.env),
    digest: (onlyNeedingAttention) => collectFleetDigest(toolDeps, { onlyNeedingAttention }),
    deliver: deliverToJarvis,
    canDeliver: () => {
      const current = findJarvis()
      return current !== undefined && jarvisSwitchPlan(current, deps.store.getSettings().jarvis).kind === 'none'
    },
    now: () => Date.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer),
    onError: deps.onError,
    log
  })
  const plans = createPlanService({
    enabled: () => deps.store.getSettings().jarvis.plansEnabled,
    now: () => Date.now(),
    newId: () => randomUUID().slice(0, 8),
    findSession: (ref) => {
      try {
        const found = resolveSession(deps.store.get(), ref)
        return { id: found.id, name: found.name }
      } catch {
        return null
      }
    },
    createSession: (target) => {
      const cwd = target.cwd === undefined ? homedir() : target.cwd
      if (!isAbsolute(cwd) || !existsSync(cwd)) throw new Error(`Folder not found (use a full folder path): ${cwd}`)
      const agent = target.agent ?? 'claude'
      const created = deps.controller.createSession({
        cwd,
        name: target.name.trim(),
        claudeArgs: [],
        agent,
        ...(agent === 'opencode' && target.model !== undefined ? { model: target.model } : {})
      })
      log('plan_session', `"${created.name}" in ${cwd}`)
      return { id: created.id, name: created.name }
    },
    sendPrompt: async (sessionId, text) => {
      const session = deps.store.get().sessions.find((candidate) => candidate.id === sessionId)
      if (session === undefined) throw new Error('The session no longer exists.')
      const result = await tools.sendPrompt(session, text, 'auto')
      // Not typed (the folder-trust question): the step would otherwise wait for a turn that never starts.
      if (/Nothing was typed/.test(result)) throw new Error(result)
      return result
    },
    sessionPhase: (sessionId) => planPhaseOf(toolDeps, sessionId),
    lastAnswer: async (sessionId) => {
      const session = deps.store.get().sessions.find((candidate) => candidate.id === sessionId)
      return session === undefined ? null : deps.tools.lastAnswer(session)
    },
    deliver: deliverToJarvis,
    log,
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer),
    onError: deps.onError
  })
  // The Settings change has no event: the timer follows it within half a minute.
  let settingsSync: ReturnType<typeof setInterval> | null = null
  // D58: Jarvis restarts itself (a new conversation, or a changed engine/model from Settings). It answers first and
  // restarts a moment later, since the restart ends the call that asked for it.
  const restartTool: McpTool = {
    name: 'restart_jarvis',
    description: 'Restarts you (Jarvis) a few seconds after this answer: fresh true starts a new, empty conversation (this one is forgotten); otherwise the same conversation continues. A Jarvis engine or model changed with update_settings (section jarvis) takes effect with this restart.',
    inputSchema: schema({ fresh: { type: 'boolean' } }),
    run: async (args) => {
      const fresh = optionalBool(args, 'fresh') === true
      log('restart_jarvis', fresh ? 'new conversation' : 'same conversation')
      setTimeout(() => {
        serial(async (): Promise<unknown> => {
          const current = findJarvis()
          if (fresh || current === undefined) return resetJarvis()
          // D79: an OpenCode model change keeps the conversation, so it goes through openJarvis like a new engine.
          if (jarvisSwitchPlan(current, deps.store.getSettings().jarvis).kind !== 'none') return openJarvis()
          return deps.controller.restartSession(current.id)
        }).catch((error: unknown) => deps.onError('restart_jarvis', error))
      }, RESTART_DELAY_MS)
      return fresh ? 'Starting a new Jarvis conversation in a few seconds.' : 'Restarting Jarvis in a few seconds; the conversation continues.'
    }
  }
  const served: readonly McpTool[] = [...tools, ...createPlanTools(plans, log), restartTool]
  const server = createMcpHttpServer({ token, tools: () => served, version: deps.appVersion })

  function findJarvis(): Session | undefined {
    return deps.store.get().sessions.find(isJarvis)
  }

  // One at a time: two quick requests (shortcut + palette) must not create two Jarvis sessions.
  let queue: Promise<unknown> = Promise.resolve()
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function openJarvis(): Promise<Session> {
    if (!started) throw new Error('Jarvis is not ready yet.')
    const settings = deps.store.getSettings().jarvis
    const wantModel = settings.agent === 'opencode' ? settings.opencodeModel : ''
    const current = findJarvis()
    // D54/D79: the engine (or an invalid OpenCode model) changed: the old conversation cannot move, start a new
    // Jarvis. A valid OpenCode model change keeps the conversation (D79): the same session continues on the new model.
    const plan = jarvisSwitchPlan(current, settings)
    if (current !== undefined && plan.kind === 'recreate') {
      deps.controller.removeSession(current.id)
    } else if (current !== undefined && plan.kind === 'model') {
      deps.controller.setOpencodeModel(current.id, plan.model)
    }
    const existing = findJarvis()
    if (existing !== undefined) {
      // The panel shows a running Jarvis: a closed one is reopened, a sleeping one woken, a stopped one started.
      const state = deps.tools.getRuntime(existing.id)
      if (existing.closedAt !== undefined) deps.controller.reopenSession(existing.id)
      else if (state?.sleeping === true) deps.controller.wakeSession(existing.id)
      else if (state === undefined || state.run !== 'running') deps.controller.resumeInBackground(existing.id)
      return deps.store.get().sessions.find((s) => s.id === existing.id) ?? existing
    }
    await mkdir(paths.dir, { recursive: true })
    return deps.controller.createSession({
      cwd: paths.dir, name: JARVIS_NAME, agent: settings.agent, claudeArgs: [], role: 'jarvis',
      ...(wantModel.length > 0 ? { model: wantModel } : {})
    })
  }

  async function resetJarvis(): Promise<Session> {
    const existing = findJarvis()
    if (existing !== undefined) deps.controller.removeSession(existing.id)
    return openJarvis()
  }

  return {
    async start(): Promise<void> {
      await mkdir(paths.dir, { recursive: true })
      // The log is a convenience: keep it bounded by starting over when it grows past the limit.
      try {
        if ((await stat(paths.log)).size > ACTION_LOG_MAX_BYTES) await truncate(paths.log, 0)
      } catch {
        // no log yet
      }
      port = (await server.start()).port
      await writeFile(paths.mcpConfig, mcpConfigText(port, token), 'utf-8')
      await writeFile(paths.prompt, jarvisSystemPrompt(served.map((tool) => tool.name)), 'utf-8')
      started = true
      await schedules.load()
      schedules.start()
      watch.start()
      plans.start()
      settingsSync = setInterval(() => watch.refresh(), 30_000)
    },

    onHookEvent(event: HookEvent): void {
      if (event.event !== 'Stop') return
      const session = deps.store.get().sessions.find((s) => s.id === event.sessionId)
      if (session === undefined || !isJarvis(session)) return
      // D79: an OpenCode Jarvis reads its reply from `opencode session export` like Claude reads its transcript; the
      // injected lastAnswer does that (and returns null when the export has nothing), so no id and no reply = nothing.
      const agent = session.agent ?? 'claude'
      if (agent !== 'claude' && (agent !== 'opencode' || session.opencodeSessionId === undefined)) return
      deps.tools.lastAnswer(session).then((text) => {
        if (text !== null && text.trim().length > 0) deps.broadcast(IPC.evJarvisReply, text)
      }).catch((error: unknown) => deps.onError('jarvis reply', error))
    },

    launchExtrasFor(session: Session): LaunchExtras {
      if (!isJarvis(session) || !started) return {}
      if (session.agent === 'opencode') return { opencodeConfig: jarvisOpencodeConfig(port, token, paths.prompt) }
      return { claudeArgs: jarvisLaunchArgs(paths, deps.store.getSettings().jarvis.model) }
    },

    registerIpc(): void {
      // The renderer shows Jarvis in its own panel (D53); main only makes sure the session exists and runs.
      ipcMain.handle(IPC.jarvisOpen, async (): Promise<Session> => serial(openJarvis))
      ipcMain.handle(IPC.jarvisReset, async (): Promise<Session> => serial(resetJarvis))
      ipcMain.handle(IPC.jarvisVoice, (): Promise<JarvisVoiceResult> => voiceCommand())
      ipcMain.handle(IPC.jarvisVoiceCancel, (): void => voice.cancel())
      ipcMain.handle(IPC.jarvisUndo, (): Promise<string> => tools.undoLast())
      ipcMain.handle(IPC.jarvisSchedulesGet, (): readonly JarvisSchedule[] => schedules.list())
      ipcMain.handle(IPC.jarvisScheduleRemove, (_event, rawId: unknown): void => {
        const removed = schedules.remove(assertNonEmptyString(rawId, 'schedule id', 64))
        log('schedule_remove (user)', `${scheduleWhen(removed)}: ${removed.instruction.slice(0, 80)}`)
      })
      ipcMain.handle(IPC.jarvisScheduleSetEnabled, (_event, rawId: unknown, rawEnabled: unknown): void => {
        schedules.setEnabled(assertNonEmptyString(rawId, 'schedule id', 64), assertBoolean(rawEnabled, 'enabled'))
      })
      ipcMain.handle(IPC.jarvisConfirmReply, async (_event, rawId: unknown, rawYes: unknown): Promise<void> => {
        answer(assertNonEmptyString(rawId, 'request id'), assertBoolean(rawYes, 'yes'))
      })
      ipcMain.handle(IPC.jarvisUiReply, async (_event, rawId: unknown, rawOk: unknown, rawText: unknown): Promise<void> => {
        const text = typeof rawText === 'string' ? rawText.slice(0, 20_000) : ''
        uiAnswer(assertNonEmptyString(rawId, 'command id'), assertBoolean(rawOk, 'ok'), text)
      })
    },

    async stop(): Promise<void> {
      schedules.stop()
      watch.stop()
      plans.stop()
      if (settingsSync !== null) clearInterval(settingsSync)
      voice.cancel()
      for (const [id] of pending) answer(id, false)
      for (const [id] of pendingUi) uiAnswer(id, false, 'SessionDeck is closing.')
      await server.stop()
    }
  }
}

