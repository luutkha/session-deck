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

function setup(sessions: Session[] = []) {
  const saver = vi.fn()
  const store = new SessionStore(makeStoreData(sessions), { schedule: saver }, { newId: () => 'new-id', now: () => 10 })
  const pty = createMockPty()
  const runtime = createRuntimeRegistry()
  const controller = createSessionController({
    store,
    pty,
    attention: createFakeAttention(),
    runtime,
    sendPtyData: vi.fn(),
    userDataDir: tempDir()
  })
  const stateOf = (id: Id): RuntimeState | undefined => runtime.get(id)
  return { controller, store, pty, runtime, stateOf, saver }
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

  it('reopen of an opencode session whose id was never reported starts a fresh opencode', () => {
    const { controller, pty } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'opencode' })

    controller.closeSession(created.id)
    controller.reopenSession(created.id)

    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--standalone'])
  })
})
