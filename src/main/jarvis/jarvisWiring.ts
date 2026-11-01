// Jarvis (D53): one Claude Code session that controls SessionDeck through a local MCP server. This file connects the
// pieces: the MCP server and its tools, the files Jarvis is launched with, the Yes/No round trip to the window, and
// the jarvis:* IPC. Only the Jarvis session gets the MCP config; the user's ~/.claude is never touched.
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, stat, truncate, writeFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { JarvisConfirmRequest, JarvisSchedule, Session } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { assertBoolean, assertNonEmptyString } from '../app/ipcValidation'
import type { SessionController } from '../app/sessionController'
import type { SessionStore } from '../store'
import { createMcpHttpServer } from './mcpHttpServer'
import { CONFIRM_TIMEOUT_MS, JARVIS_NAME, jarvisLaunchArgs, jarvisSystemPrompt, jarvisPaths, mcpConfigText } from './jarvisLaunch'
import { createJarvisTools, type ConfirmRequest, type JarvisToolDeps } from './jarvisTools'
import { isJarvis } from './targets'
import { createScheduleService } from './scheduleService'
import { scheduleWhen } from './schedules'

const ACTION_LOG_MAX_BYTES = 1024 * 1024

export interface JarvisWiringDeps {
  readonly userDataDir: string
  readonly store: SessionStore
  readonly controller: SessionController
  /** Everything the tools need besides what this file provides (confirm, log, ids, clocks). */
  readonly tools: Omit<JarvisToolDeps, 'confirm' | 'log' | 'newId' | 'now' | 'sleep' | 'getData' | 'controller' | 'schedules'>
  /** Sends the Yes/No request to the main window; false when there is no window to ask. */
  readonly sendConfirm: (request: JarvisConfirmRequest) => boolean
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
  claudeArgsFor(session: Session): readonly string[]
  registerIpc(): void
  stop(): Promise<void>
}

export function createJarvisWiring(deps: JarvisWiringDeps): JarvisWiring {
  const paths = jarvisPaths(deps.userDataDir)
  const token = randomBytes(32).toString('hex')
  const pending = new Map<string, { resolve: (yes: boolean) => void; timer: ReturnType<typeof setTimeout> }>()
  let started = false

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

  const tools = createJarvisTools({
    ...deps.tools,
    schedules,
    getData: () => deps.store.get(),
    controller: deps.controller,
    confirm,
    log,
    newId: () => randomUUID(),
    now: () => Date.now(),
    sleep
  })
  const server = createMcpHttpServer({ token, tools: () => tools, version: deps.appVersion })

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
    return deps.controller.createSession({ cwd: paths.dir, name: JARVIS_NAME, agent: 'claude', claudeArgs: [], role: 'jarvis' })
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
      const { port } = await server.start()
      await writeFile(paths.mcpConfig, mcpConfigText(port, token), 'utf-8')
      await writeFile(paths.prompt, jarvisSystemPrompt(tools.map((tool) => tool.name)), 'utf-8')
      started = true
      await schedules.load()
      schedules.start()
    },

    claudeArgsFor(session: Session): readonly string[] {
      if (!isJarvis(session) || !started) return []
      return jarvisLaunchArgs(paths, deps.store.getSettings().jarvis.model)
    },

    registerIpc(): void {
      // The renderer shows Jarvis in its own panel (D53); main only makes sure the session exists and runs.
      ipcMain.handle(IPC.jarvisOpen, async (): Promise<Session> => serial(openJarvis))
      ipcMain.handle(IPC.jarvisReset, async (): Promise<Session> => serial(resetJarvis))
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
    },

    async stop(): Promise<void> {
      schedules.stop()
      for (const [id] of pending) answer(id, false)
      await server.stop()
    }
  }
}

