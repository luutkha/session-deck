import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Id, AttentionReason, CreateSessionInput, RuntimeState, Session, StoreData } from '../../shared/types'
import { SessionStore } from '../store'
import type { PtyManager, StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention/AttentionService'
import { createRuntimeRegistry } from './runtimeRegistry'
import { createSessionController } from './sessionController'
import { setOpencodeSupportsStandaloneForTests } from '../opencode/capabilities'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-oc-'))
  dirs.push(dir)
  return dir
}

const OC_ID = 'ses_abcdef12345678'

function makeStoreData(sessions: Session[] = []): StoreData {
  return {
    version: 1,
    sessions,
    groups: [],
    statuses: [
      { id: 'todo', name: 'Todo', color: '#9e9e9e' },
      { id: 'working', name: 'Working', color: '#42a5f5' }
    ],
    groupOrder: []
  }
}

interface MockProcess {
  killed: boolean
  exitCode: number | null
  startOpts: StartOptions
  buffer: string
}

function createMockPty(): PtyManager & {
  fireExit: (id: Id, code: number | null) => void
  fireData: (id: Id, data: string) => void
  getLastStartOpts: (id: Id) => StartOptions | undefined
} {
  const processes = new Map<Id, MockProcess>()
  const dataListeners = new Set<(id: Id, data: string, seq: number) => void>()
  const exitListeners = new Set<(id: Id, code: number | null) => void>()

  const mock = {
    processes,

    start(opts: StartOptions): void {
      const previous = processes.get(opts.sessionId)
      if (previous && !previous.killed) {
        throw new Error(`Session already running: ${opts.sessionId}`)
      }
      processes.set(opts.sessionId, { killed: false, exitCode: null, startOpts: opts, buffer: '' })
    },

    restart(opts: StartOptions): void {
      const existing = processes.get(opts.sessionId)
      if (existing) existing.killed = true
      processes.set(opts.sessionId, { killed: false, exitCode: null, startOpts: opts, buffer: '' })
    },

    write(): void {},

    resize(): void {},

    kill(id: Id): void {
      const proc = processes.get(id)
      if (proc) proc.killed = true
    },

    killAll(): void {
      for (const proc of processes.values()) proc.killed = true
    },

    replay(id: Id): { data: string; seq: number } {
      const proc = processes.get(id)
      return { data: proc?.buffer ?? '', seq: 0 }
    },

    isRunning(id: Id): boolean {
      const proc = processes.get(id)
      return proc !== undefined && !proc.killed
    },

    onData(cb: (id: Id, data: string, seq: number) => void): () => void {
      dataListeners.add(cb)
      return () => dataListeners.delete(cb)
    },

    onExit(cb: (id: Id, code: number | null) => void): () => void {
      exitListeners.add(cb)
      return () => exitListeners.delete(cb)
    },

    fireExit(id: Id, code: number | null): void {
      const proc = processes.get(id)
      if (proc) {
        proc.exitCode = code
        proc.killed = true
      }
      for (const cb of exitListeners) cb(id, code)
    },

    fireData(id: Id, data: string): void {
      const proc = processes.get(id)
      if (proc) proc.buffer += data
      for (const cb of dataListeners) cb(id, data, 0)
    },

    getLastStartOpts(id: Id): StartOptions | undefined {
      return processes.get(id)?.startOpts
    },

    dispose(): void {
      processes.clear()
      dataListeners.clear()
      exitListeners.clear()
    }
  } as unknown as ReturnType<typeof createMockPty>

  return mock
}

function createFakeAttention(): AttentionService {
  let started = true
  const attentionMap = new Map<Id, AttentionReason | null>()
  return {
    async start() {},
    async stop() {},
    claudeArgs(): string[] {
      if (!started) throw new Error('AttentionService not started')
      return ['--settings', '/fake/settings.json']
    },
    envFor(sessionId: string): Record<string, string> {
      return { SESSIONDECK_SESSION_ID: sessionId }
    },
    opencodeEnv(): Record<string, string> {
      if (!started) throw new Error('AttentionService not started')
      return { OPENCODE_CONFIG_CONTENT: '{"plugin":["file:///x.mjs"]}' }
    },
    workerEnv(): Record<string, string> {
      return { OPENCODE_CONFIG_CONTENT: '{"plugin":[]}' }
    },
    endpoint(): { port: number; token: string } {
      return { port: 1, token: 't' }
    },
    noteOutput(): void {},
    noteInput(): void {},
    clear(id: string): void {
      attentionMap.delete(id)
    },
    get(id: string): AttentionReason | null {
      return attentionMap.get(id) ?? null
    },
    onChange(): () => void {
      return () => {}
    },
    setSoundEnabled(): void {},
    suspend(_id: string): void {},
    forget(id: string): void {
      attentionMap.delete(id)
    },
    raise(id: string, reason: AttentionReason): void {
      attentionMap.set(id, reason)
    }
  } as unknown as AttentionService
}

interface SetupOptions {
  readonly runOpencode?: (args: string[]) => Promise<string>
  readonly opencodeHealthGraceMs?: number
  readonly onUsageLimit?: (id: Id) => void
}

function setup(sessions: Session[] = [], options: SetupOptions = {}) {
  // v2.x is the normal case here (--standalone present); the probe itself would spawn the real opencode CLI.
  setOpencodeSupportsStandaloneForTests(true)
  const saver = vi.fn()
  let nextId = 0
  const store = new SessionStore(makeStoreData(sessions), { schedule: saver }, { newId: () => `new-id-${++nextId}`, now: () => 10 })
  const pty = createMockPty()
  const runtime = createRuntimeRegistry()
  const notice = vi.fn()
  const controller = createSessionController({
    store,
    pty,
    attention: createFakeAttention(),
    runtime,
    sendPtyData: vi.fn(),
    userDataDir: tempDir(),
    // Unit tests never spawn the real CLI: the default list is empty.
    runOpencode: options.runOpencode ?? (async () => '[]'),
    ...(options.opencodeHealthGraceMs !== undefined ? { opencodeHealthGraceMs: options.opencodeHealthGraceMs } : {}),
    ...(options.onUsageLimit !== undefined ? { onUsageLimit: options.onUsageLimit } : {})
  })
  controller.setNoticeHandler(notice)
  const stateOf = (id: Id): RuntimeState | undefined => runtime.get(id)
  return { controller, store, pty, runtime, stateOf, saver, notice }
}

const CLAUDE_FLAGS = ['--dangerously-skip-permissions', '--session-id', '--resume', '--settings']

describe('opencode sessions: launch spec', () => {
  it('createSession with agent opencode launches plain opencode with the model, no Claude flags and the plugin env', () => {
    const { controller, store, pty } = setup()
    const input: CreateSessionInput = {
      cwd: tempDir(),
      agent: 'opencode',
      model: 'opencode/deepseek-v4.1-flash-free'
    }
    const created = controller.createSession(input)

    const opts = pty.getLastStartOpts(created.id)
    expect(opts).toBeDefined()
    expect(opts!.command).toBe('opencode')
    expect(opts!.internalArgs).toEqual(['--standalone'])
    for (const flag of CLAUDE_FLAGS) {
      expect(opts!.internalArgs.join(' ') + ' ' + opts!.claudeArgs.join(' ')).not.toContain(flag)
    }
    // The model travels in the config content: the TUI CLI has no --model flag (it prints help and exits).
    // (The fake attention here returns the raw user config; the permission merge happens inside the real opencodeEnv.)
    expect(opts!.env.OPENCODE_CONFIG_CONTENT).toBe('{"plugin":["file:///x.mjs"],"model":"opencode/deepseek-v4.1-flash-free"}')
    expect(opts!.env.SESSIONDECK_SESSION_ID).toBe(created.id)
    // The stored session carries agent + model, no Claude conversation id bookkeeping.
    const stored = store.get().sessions.find((s) => s.id === created.id)!
    expect(stored.agent).toBe('opencode')
    expect(stored.model).toBe('opencode/deepseek-v4.1-flash-free')
    expect(stored.claudeSessionId).toBeUndefined()
  })

  it('the plugin-reported conversation id switches later starts to `opencode -s <id>`', () => {
    const { controller, pty } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    // Before the plugin reports: unknown conversation id -> plain new opencode.
    controller.sleepSession(created.id)
    controller.setActiveSession(created.id)
    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--standalone'])

    // The plugin reports AgentSession (validated by HookServer first).
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })

    controller.sleepSession(created.id)
    controller.setActiveSession(created.id)
    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--standalone', '-s', OC_ID])
  })
})

describe('opencode sessions: AgentSession hook events', () => {
  it('stores the reported id as opencodeSessionId (persisted), once', () => {
    const { controller, store, saver } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })
    expect(store.get().sessions.find((s) => s.id === created.id)!.opencodeSessionId).toBe(OC_ID)
    const savesAfterFirst = saver.mock.calls.length
    expect(savesAfterFirst).toBeGreaterThan(0)

    // Same id again: no change, no save.
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })
    expect(saver.mock.calls.length).toBe(savesAfterFirst)

    // Nothing else happens for the AgentSession event: no activity, no auto status.
    expect(store.get().sessions.find((s) => s.id === created.id)!.statusId).toBeNull()
    expect(store.get().sessions.find((s) => s.id === created.id)!.opencodeSessionId).toBe(OC_ID)
  })

  it('AgentSession events for claude sessions are ignored (the id only makes sense for opencode)', () => {
    const { controller, store } = setup()
    controller.createSession({ cwd: tempDir() })
    const claudeSession = store.get().sessions[0]
    expect(claudeSession.claudeSessionId).toBeDefined()
    controller.handleHookEvent({ sessionId: claudeSession.id, event: 'AgentSession', message: OC_ID })
    expect(store.get().sessions[0].opencodeSessionId).toBeUndefined()
    expect(store.get().sessions[0].claudeSessionId).toBe(claudeSession.claudeSessionId)
  })
})

describe('opencode sessions: exit code', () => {
  it('records the pty exit code like a Claude session, so Exited (N) can be shown for every agent', () => {
    const { controller, pty, stateOf } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    pty.fireExit(created.id, 42)

    expect(stateOf(created.id)?.run).toBe('exited')
    expect(stateOf(created.id)?.exitCode).toBe(42)
  })
})

describe('opencode sessions: sleep + wake and close/reopen', () => {
  it('sleeping and reactivating an opencode session resumes with -s when the id is known', () => {
    const { controller, pty, stateOf } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode', model: 'p/m' })
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })

    controller.sleepSession(created.id)
    expect(stateOf(created.id)?.sleeping).toBe(true)

    controller.setActiveSession(created.id)
    const opts = pty.getLastStartOpts(created.id)!
    expect(opts.command).toBe('opencode')
    expect(opts.internalArgs).toEqual(['--standalone', '-s', OC_ID])
    expect(JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT).model).toBe('p/m')
    expect(opts.claudeArgs).toEqual([])
  })

  it('close + reopen of an opencode session with a used conversation id uses -s', () => {
    const { controller, store, pty } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })

    controller.closeSession(created.id)
    controller.reopenSession(created.id)

    const opts = pty.getLastStartOpts(created.id)!
    expect(opts.internalArgs).toEqual(['--standalone', '-s', OC_ID])
    expect(store.get().sessions.find((s) => s.id === created.id)!.closedAt).toBeUndefined()
  })
})

describe('opencode sessions: close/reopen starts a fresh opencode when the id is unknown', () => {
  it('reopen of an opencode session whose id was never reported starts a fresh opencode', () => {
    const { controller, pty } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    controller.closeSession(created.id)
    controller.reopenSession(created.id)

    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--standalone'])
  })
})

function listRow(id: string, directory: string, at: number): string {
  return JSON.stringify([{ id, directory, created: at, updated: at }])
}

describe('opencode sessions: session-id recovery (D79)', () => {
  it('a resume without an id lists sessions and adopts the single match (same setter as the plugin)', async () => {
    const cwd = tempDir()
    let output = '[]'
    const run = vi.fn(async (args: string[]) => {
      expect(args).toEqual(['session', 'list', '--format', 'json', '--max-count', '300'])
      return output
    })
    const { controller, store } = setup([], { runOpencode: run })
    const created = controller.createSession({ cwd, agent: 'opencode' })
    expect(run).not.toHaveBeenCalled()

    controller.sleepSession(created.id)
    output = listRow(OC_ID, cwd, Date.now())
    controller.setActiveSession(created.id)

    await vi.waitFor(() => {
      expect(store.get().sessions.find((s) => s.id === created.id)!.opencodeSessionId).toBe(OC_ID)
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('several matches are not guessed: nothing is stored and one notice is shown', async () => {
    const cwd = tempDir()
    let output = '[]'
    const run = vi.fn(async () => output)
    const { controller, store, notice } = setup([], { runOpencode: run })
    const created = controller.createSession({ cwd, agent: 'opencode' })

    controller.sleepSession(created.id)
    const at = Date.now()
    output = JSON.stringify([
      { id: OC_ID, directory: cwd, created: at, updated: at },
      { id: 'ses_second12345678', directory: cwd, created: at, updated: at }
    ])
    controller.setActiveSession(created.id)

    await vi.waitFor(() => expect(notice).toHaveBeenCalledTimes(1))
    expect(String(notice.mock.calls[0][0])).toContain('several conversations match this launch')
    expect(store.get().sessions.find((s) => s.id === created.id)!.opencodeSessionId).toBeUndefined()
  })

  it('a plugin-health "missing" with no id also recovers through the list', async () => {
    vi.useFakeTimers()
    try {
      const cwd = tempDir()
      const run = vi.fn(async () => listRow(OC_ID, cwd, Date.now()))
      const { controller, store, stateOf } = setup([], { runOpencode: run, opencodeHealthGraceMs: 1000 })
      const created = controller.createSession({ cwd, agent: 'opencode' })

      await vi.advanceTimersByTimeAsync(1000)

      expect(stateOf(created.id)?.opencodePlugin).toBe('missing')
      await vi.waitFor(() => {
        expect(store.get().sessions.find((s) => s.id === created.id)!.opencodeSessionId).toBe(OC_ID)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('never runs for a Claude session resumed without a conversation id', async () => {
    const run = vi.fn(async () => '[]')
    const { controller } = setup([], { runOpencode: run })
    const created = controller.createSession({ cwd: tempDir() })

    controller.sleepSession(created.id)
    controller.setActiveSession(created.id)
    await Promise.resolve()

    expect(run).not.toHaveBeenCalled()
  })
})

describe('opencode sessions: plugin health (D79)', () => {
  it('is "missing" after the grace window without a plugin event, and "ok" once one arrives', async () => {
    vi.useFakeTimers()
    try {
      const { controller, stateOf } = setup([], { opencodeHealthGraceMs: 1000 })
      const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })
      expect(stateOf(created.id)?.opencodePlugin).toBeUndefined()

      await vi.advanceTimersByTimeAsync(1000)
      expect(stateOf(created.id)?.opencodePlugin).toBe('missing')

      controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })
      expect(stateOf(created.id)?.opencodePlugin).toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an event inside the window marks it "ok" at once and the window never fires later', async () => {
    vi.useFakeTimers()
    try {
      const { controller, stateOf } = setup([], { opencodeHealthGraceMs: 1000 })
      const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })
      controller.handleHookEvent({ sessionId: created.id, event: 'Stop' })
      expect(stateOf(created.id)?.opencodePlugin).toBe('ok')

      await vi.advanceTimersByTimeAsync(5000)
      expect(stateOf(created.id)?.opencodePlugin).toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a fresh process starts unknown again (a previous ok is cleared on restart)', async () => {
    const { controller, stateOf } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })
    expect(stateOf(created.id)?.opencodePlugin).toBe('ok')

    await controller.restartSession(created.id)
    expect(stateOf(created.id)?.opencodePlugin).toBeUndefined()
  })
})

describe('opencode sessions: usage-limit scan (D79)', () => {
  it('reports a limit once per occurrence and again after a new prompt', () => {
    const onUsageLimit = vi.fn()
    const { controller, pty } = setup([], { onUsageLimit })
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    pty.fireData(created.id, 'Reading files...\nFree usage limit reached, resets at 5pm\n')
    expect(onUsageLimit).toHaveBeenCalledTimes(1)

    // The same banner redrawn while the turn is cut off is not a second occurrence.
    pty.fireData(created.id, 'Free usage limit reached, resets at 5pm\n')
    expect(onUsageLimit).toHaveBeenCalledTimes(1)

    controller.handleHookEvent({ sessionId: created.id, event: 'UserPromptSubmit' })
    pty.fireData(created.id, 'Free usage limit reached, resets at 5pm\n')
    expect(onUsageLimit).toHaveBeenCalledTimes(2)
  })

  it('ignores ordinary output and a limit line that scrolled out of the last 25 lines', () => {
    const onUsageLimit = vi.fn()
    const { controller, pty } = setup([], { onUsageLimit })
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    pty.fireData(created.id, 'Done.\nChecking src/rate-limit.ts and error handling\n')
    expect(onUsageLimit).not.toHaveBeenCalled()

    pty.fireData(created.id, `Free usage limit reached\n${'plain output line\n'.repeat(30)}`)
    expect(onUsageLimit).not.toHaveBeenCalled()
  })
})

describe('opencode sessions: session-id recovery runs in the session folder (D79)', () => {
  it('passes the session cwd to the listing, so another project cannot hide the conversation', async () => {
    const cwd = tempDir()
    const run = vi.fn(async (_args: string[], _cwd?: string): Promise<string> => listRow(OC_ID, cwd, Date.now()))
    const { controller } = setup([], { runOpencode: run })
    const created = controller.createSession({ cwd, agent: 'opencode' })

    controller.sleepSession(created.id)
    controller.setActiveSession(created.id)

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run.mock.calls[0][1]).toBe(cwd)
  })
})

describe('opencode sessions: setOpencodeModel (D79)', () => {
  const NEW_MODEL = 'opencode/deepseek-v4.1-flash-free'

  it('restarts a running conversation on the new model and resumes it with -s', () => {
    const { controller, store, pty, stateOf } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode', model: 'p/old' })
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })

    expect(controller.setOpencodeModel(created.id, NEW_MODEL)).toBe('restarted')

    const stored = store.get().sessions.find((s) => s.id === created.id)!
    expect(stored.model).toBe(NEW_MODEL)
    const opts = pty.getLastStartOpts(created.id)!
    expect(opts.internalArgs).toEqual(['--standalone', '-s', OC_ID])
    expect(JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT).model).toBe(NEW_MODEL)
    expect(stateOf(created.id)?.sleeping).not.toBe(true)
    expect(stateOf(created.id)?.run).toBe('running')
  })

  it('only stores the model for a session with no conversation id (a restart would lose the conversation)', () => {
    const { controller, store, pty, stateOf } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode', model: 'p/old' })
    const before = pty.getLastStartOpts(created.id)

    expect(controller.setOpencodeModel(created.id, NEW_MODEL)).toBe('next-start')

    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBe(NEW_MODEL)
    expect(pty.getLastStartOpts(created.id)).toBe(before)
    expect(stateOf(created.id)?.sleeping).not.toBe(true)
  })

  it('only stores the model for a sleeping session, which starts on it when woken', () => {
    const { controller, store, pty } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode', model: 'p/old' })
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })
    controller.sleepSession(created.id)

    expect(controller.setOpencodeModel(created.id, NEW_MODEL)).toBe('next-start')
    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBe(NEW_MODEL)

    controller.setActiveSession(created.id)
    const opts = pty.getLastStartOpts(created.id)!
    expect(opts.internalArgs).toEqual(['--standalone', '-s', OC_ID])
    expect(JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT).model).toBe(NEW_MODEL)
  })

  it('only stores the model for a stopped or closed session', () => {
    const { controller, store, pty } = setup()
    const stopped = controller.createSession({ cwd: tempDir(), agent: 'opencode', model: 'p/old' })
    pty.fireExit(stopped.id, 0)
    expect(controller.setOpencodeModel(stopped.id, NEW_MODEL)).toBe('next-start')

    const closed = controller.createSession({ cwd: tempDir(), agent: 'opencode', model: 'p/old' })
    controller.closeSession(closed.id)
    expect(controller.setOpencodeModel(closed.id, NEW_MODEL)).toBe('next-start')

    expect(store.get().sessions.find((s) => s.id === closed.id)!.model).toBe(NEW_MODEL)
  })

  it('clears the model with undefined (OpenCode default) and does not restart for the same value', () => {
    const { controller, store, pty } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode', model: 'p/old' })
    controller.handleHookEvent({ sessionId: created.id, event: 'AgentSession', message: OC_ID })

    const before = pty.getLastStartOpts(created.id)
    expect(controller.setOpencodeModel(created.id, 'p/old')).toBe('next-start')
    expect(pty.getLastStartOpts(created.id)).toBe(before)

    expect(controller.setOpencodeModel(created.id, undefined)).toBe('restarted')
    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBeUndefined()
    expect('model' in JSON.parse(pty.getLastStartOpts(created.id)!.env.OPENCODE_CONFIG_CONTENT)).toBe(false)
  })

  it('refuses Claude and shell sessions and validates the model id', () => {
    const { controller, store } = setup()
    const claude = controller.createSession({ cwd: tempDir() })
    const shell = controller.createSession({ cwd: tempDir(), agent: 'shell' })
    const opencode = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    expect(() => controller.setOpencodeModel(claude.id, NEW_MODEL)).toThrow('is a Claude session')
    expect(() => controller.setOpencodeModel(shell.id, NEW_MODEL)).toThrow('shell session')
    expect(() => controller.setOpencodeModel('nope', NEW_MODEL)).toThrow('Unknown session')
    expect(() => controller.setOpencodeModel(opencode.id, '-rf')).toThrow('looks like a command flag')
    expect(() => controller.setOpencodeModel(opencode.id, 'provider model')).toThrow('is not a model id')
    expect(() => controller.setOpencodeModel(opencode.id, `p/${'x'.repeat(99)}`)).toThrow('too long')
    expect(() => controller.setOpencodeModel(opencode.id, 'p/m@latest')).toThrow('is not a model id')
    expect(store.get().sessions.find((s) => s.id === opencode.id)!.model).toBeUndefined()
  })
})

describe('opencode sessions: copy fork (D79)', () => {
  const COPY_ID = 'ses_copy12345678'
  const EXPORT = JSON.stringify({ info: { id: OC_ID }, messages: [{ id: 'msg_1', type: 'user', text: 'hello' }] })

  /** A fake CLI: export prints EXPORT, import answers with `importOutput`, and the list shows the copy once imported. */
  function cli(options: { importOutput?: string; listCopyAfterImport?: boolean; importError?: string } = {}) {
    let imported = false
    return vi.fn(async (args: string[], _cwd?: string): Promise<string> => {
      if (args[1] === 'export') return EXPORT
      if (args[1] === 'import') {
        if (options.importError !== undefined) throw new Error(options.importError)
        imported = options.listCopyAfterImport !== false
        return options.importOutput ?? ''
      }
      return imported ? JSON.stringify([{ id: COPY_ID, directory: 'C:\\copied', created: 1, updated: 1 }]) : '[]'
    })
  }

  it('exports, imports and creates a session on the new conversation (a copy, not a true fork)', async () => {
    const cwd = tempDir()
    const run = cli({ importOutput: `Imported session ${COPY_ID}` })
    const { controller, store, pty, notice } = setup([], { runOpencode: run })
    const parent = controller.createSession({ cwd, agent: 'opencode', model: 'p/m' })
    controller.handleHookEvent({ sessionId: parent.id, event: 'AgentSession', message: OC_ID })

    const fork = await controller.forkSession(parent.id)

    expect(fork.name).toBe(`${parent.name} (fork)`)
    expect(fork.cwd).toBe(cwd)
    expect(fork.agent).toBe('opencode')
    expect(fork.model).toBe('p/m')
    expect(fork.opencodeSessionId).toBe(COPY_ID)
    expect(store.get().sessions).toHaveLength(2)
    const opts = pty.getLastStartOpts(fork.id)!
    expect(opts.internalArgs).toEqual(['--standalone', '-s', COPY_ID])
    expect(JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT).model).toBe('p/m')
    expect(store.get().sessions.find((s) => s.id === parent.id)!.opencodeSessionId).toBe(OC_ID)
    expect(String(notice.mock.calls[0][0])).toContain('not a true fork')
  })

  it('finds the new id in the before/after list when import prints none, and deletes the temp file', async () => {
    const cwd = tempDir()
    const files: string[] = []
    const run = cli({ listCopyAfterImport: true })
    const { controller } = setup([], { runOpencode: run })
    const parent = controller.createSession({ cwd, agent: 'opencode' })
    controller.handleHookEvent({ sessionId: parent.id, event: 'AgentSession', message: OC_ID })
    run.mockImplementation(async (args: string[], _cwd?: string): Promise<string> => {
      if (args[1] === 'export') return EXPORT
      if (args[1] === 'import') {
        files.push(args[2])
        return ''
      }
      return files.length > 0 ? JSON.stringify([{ id: COPY_ID, directory: cwd, created: 1, updated: 1 }]) : '[]'
    })

    const fork = await controller.forkSession(parent.id)

    expect(fork.opencodeSessionId).toBe(COPY_ID)
    expect(files).toHaveLength(1)
    expect(existsSync(files[0])).toBe(false)
    // Import runs in the session's folder, and both listings (before and after) do too.
    const importCall = run.mock.calls.find((call) => call[0][1] === 'import')
    expect(importCall?.[1]).toBe(cwd)
    const listCwds = run.mock.calls.filter((call) => call[0][1] === 'list').map((call) => call[1])
    expect(listCwds).toEqual([cwd, cwd])
  })

  it('leaves no session behind when the import fails', async () => {
    const cwd = tempDir()
    const { controller, store } = setup([], { runOpencode: cli({ importError: 'boom' }) })
    const parent = controller.createSession({ cwd, agent: 'opencode' })
    controller.handleHookEvent({ sessionId: parent.id, event: 'AgentSession', message: OC_ID })

    await expect(controller.forkSession(parent.id)).rejects.toThrow('Could not copy the OpenCode conversation: boom')
    expect(store.get().sessions).toHaveLength(1)
  })

  it('refuses (and adds nothing) when import neither prints the id nor adds a row', async () => {
    const cwd = tempDir()
    const { controller, store } = setup([], { runOpencode: cli({ listCopyAfterImport: false }) })
    const parent = controller.createSession({ cwd, agent: 'opencode' })
    controller.handleHookEvent({ sessionId: parent.id, event: 'AgentSession', message: OC_ID })

    await expect(controller.forkSession(parent.id)).rejects.toThrow('did not say which new session')
    expect(store.get().sessions).toHaveLength(1)
  })

  it('deletes the imported conversation when the import did not say which one it made', async () => {
    const cwd = tempDir()
    const bigExport = JSON.stringify({ info: { id: 'ses_0123456789abAAAAAAAAAAAAAA' }, messages: [] })
    const run = vi.fn(async (args: string[]): Promise<string> => (args[1] === 'export' ? bigExport : args[1] === 'list' ? '[]' : ''))
    const { controller } = setup([], { runOpencode: run })
    const parent = controller.createSession({ cwd, agent: 'opencode' })
    controller.handleHookEvent({ sessionId: parent.id, event: 'AgentSession', message: OC_ID })

    await expect(controller.forkSession(parent.id)).rejects.toThrow('did not say which new session')
    const del = run.mock.calls.find((call) => call[0][1] === 'delete')
    expect(del?.[0][2]).toMatch(/^ses_0123456789ab/)
    expect(del?.[0][2]).not.toBe('ses_0123456789abAAAAAAAAAAAAAA')
  })

  it('refuses an OpenCode session with no saved conversation and an export that is not JSON', async () => {
    const cwd = tempDir()
    const noId = setup([], { runOpencode: cli() })
    const parent = noId.controller.createSession({ cwd, agent: 'opencode' })
    await expect(noId.controller.forkSession(parent.id)).rejects.toThrow('Nothing to fork yet')

    const badExport = setup([], { runOpencode: async (): Promise<string> => 'Session not found: ses_x12345678' })
    const withId = badExport.controller.createSession({ cwd, agent: 'opencode' })
    badExport.controller.handleHookEvent({ sessionId: withId.id, event: 'AgentSession', message: OC_ID })
    await expect(badExport.controller.forkSession(withId.id)).rejects.toThrow('did not print session JSON')
    expect(badExport.store.get().sessions).toHaveLength(1)
  })
})
