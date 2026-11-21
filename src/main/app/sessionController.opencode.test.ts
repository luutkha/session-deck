import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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
  const store = new SessionStore(makeStoreData(sessions), { schedule: saver }, { newId: () => 'new-id', now: () => 10 })
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
      expect(args).toEqual(['session', 'list', '--format', 'json'])
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
