import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AttentionReason, Id, RuntimeState, Session, StoreData } from '../../shared/types'
import { SessionStore } from '../store'
import { createSessionController, type SessionController } from './sessionController'
import type { PtyManager, StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention/AttentionService'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtimeRegistry'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-sleep-'))
  dirs.push(dir)
  return dir
}

function makeSession(overrides: Partial<Session> & { id: Id }): Session {
  return {
    name: overrides.id,
    cwd: tempDir(),
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    claudeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ...overrides
  }
}

function makeStoreData(sessions: Session[]): StoreData {
  return { version: 1, sessions, groups: [], statuses: [], groupOrder: [] }
}

interface FakePty extends PtyManager {
  fireExit(id: Id, code: number | null): void
  getLastStartOpts(id: Id): StartOptions | undefined
  killCount(id: Id): number
}

function createFakePty(): FakePty {
  const starts = new Map<Id, StartOptions>()
  const running = new Set<Id>()
  const kills = new Map<Id, number>()
  const exitListeners = new Set<(id: Id, code: number | null) => void>()

  const pty = {
    start(opts: StartOptions): void {
      starts.set(opts.sessionId, opts)
      running.add(opts.sessionId)
    },
    restart(opts: StartOptions): void {
      starts.set(opts.sessionId, opts)
      running.add(opts.sessionId)
    },
    kill(id: Id): void {
      kills.set(id, (kills.get(id) ?? 0) + 1)
      running.delete(id)
    },
    isRunning: (id: Id): boolean => running.has(id),
    replay: (): { data: string; seq: number } => ({ data: '', seq: 0 }),
    onData: (): (() => void) => () => {},
    onExit(cb: (id: Id, code: number | null) => void): () => void {
      exitListeners.add(cb)
      return () => exitListeners.delete(cb)
    },
    fireExit(id: Id, code: number | null): void {
      running.delete(id)
      for (const cb of exitListeners) cb(id, code)
    },
    getLastStartOpts: (id: Id): StartOptions | undefined => starts.get(id),
    killCount: (id: Id): number => kills.get(id) ?? 0
  } as unknown as FakePty

  return pty
}

function createFakeAttention(): AttentionService {
  const map = new Map<Id, AttentionReason | null>()
  return {
    async start() {},
    async stop() {},
    claudeArgs: () => ['--settings', '/fake/settings.json'],
    envFor: (id: string) => ({ SESSIONDECK_SESSION_ID: id }),
    opencodeEnv: () => ({ OPENCODE_CONFIG_CONTENT: '{}' }),
    workerEnv: () => ({ OPENCODE_CONFIG_CONTENT: '{"plugin":[]}' }),
    endpoint: () => ({ port: 1, token: 't' }),
    noteOutput: () => {},
    noteInput: () => {},
    clear: (id: string) => map.delete(id),
    markUnread: (_id: string) => undefined,
    get: (id: string) => map.get(id) ?? null,
    onChange: () => () => {},
    setSoundEnabled: () => {},
    suspend: (_id: string) => {},
    forget: (id: string) => map.delete(id),
    raise: (id: string, reason: AttentionReason) => map.set(id, reason)
  }
}

interface Setup {
  readonly controller: SessionController
  readonly store: SessionStore
  readonly pty: FakePty
  readonly attention: AttentionService
  readonly runtime: RuntimeRegistry
}

function setup(sessions: Session[] = []): Setup {
  const store = new SessionStore(makeStoreData(sessions), { schedule: vi.fn() }, { newId: () => 'x', now: () => 1 })
  const pty = createFakePty()
  const attention = createFakeAttention()
  const runtime = createRuntimeRegistry()
  const userDataDir = tempDir()
  const controller = createSessionController({
    store,
    pty,
    attention,
    runtime,
    sendPtyData: vi.fn(),
    userDataDir
  })
  return { controller, store, pty, attention, runtime }
}

function stateOf(runtime: RuntimeRegistry, id: Id): RuntimeState | undefined {
  return runtime.get(id)
}

describe('sessionController.sleepSession', () => {
  it('kills the process, suspends (not forgets) attention and marks the runtime sleeping', () => {
    const session = makeSession({ id: 's1' })
    const { controller, pty, runtime, attention } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')
    const suspendSpy = vi.spyOn(attention, 'suspend')
    const forgetSpy = vi.spyOn(attention, 'forget')

    controller.sleepSession('s1')

    expect(pty.killCount('s1')).toBe(1)
    expect(pty.isRunning('s1')).toBe(false)
    expect(suspendSpy).toHaveBeenCalledWith('s1')
    expect(forgetSpy).not.toHaveBeenCalled()
    const state = stateOf(runtime, 's1')!
    expect(state.run).toBe('exited')
    expect(state.exitCode).toBeNull()
    expect(state.sleeping).toBe(true)
  })

  it('is a no-op for an unknown session', () => {
    const { controller, pty } = setup([])
    expect(() => controller.sleepSession('ghost')).not.toThrow()
    expect(pty.killCount('ghost')).toBe(0)
  })

  it('is a no-op for a closed session', () => {
    const session = makeSession({ id: 'closed', closedAt: 5 })
    const { controller, pty, runtime } = setup([session])

    controller.sleepSession('closed')

    expect(pty.killCount('closed')).toBe(0)
    expect(stateOf(runtime, 'closed')?.sleeping).toBeUndefined()
  })

  it('is a no-op for a session that is not running', () => {
    const session = makeSession({ id: 'idle' })
    const { controller, pty, runtime } = setup([session])
    controller.initializeRestoredSessions()

    controller.sleepSession('idle')

    expect(pty.killCount('idle')).toBe(0)
    expect(stateOf(runtime, 'idle')).toBeUndefined()
  })

  it('never puts a sleeping session to sleep twice', () => {
    const session = makeSession({ id: 's1' })
    const { controller, pty } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')

    controller.sleepSession('s1')
    controller.sleepSession('s1')

    expect(pty.killCount('s1')).toBe(1)
  })

  it('does not treat the kill as a crash: an exit after sleep keeps the sleeping state and does not fall back', () => {
    const session = makeSession({ id: 's1' })
    const { controller, pty, runtime } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')

    controller.sleepSession('s1')
    const startsBefore = pty.getLastStartOpts('s1')
    pty.fireExit('s1', 1)

    const state = stateOf(runtime, 's1')!
    expect(state.sleeping).toBe(true)
    expect(state.run).toBe('exited')
    expect(state.exitCode).toBeNull()
    expect(pty.getLastStartOpts('s1')).toBe(startsBefore)
  })

  it('activating a sleeping session resumes the SAME conversation with --resume and clears sleeping', () => {
    const session = makeSession({ id: 's1', claudeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    const { controller, pty, runtime } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')
    controller.sleepSession('s1')

    controller.setActiveSession('s1')

    const opts = pty.getLastStartOpts('s1')!
    expect(opts.internalArgs).toContain('--resume')
    expect(opts.internalArgs).toContain(session.claudeSessionId)
    expect(opts.internalArgs).not.toContain('--session-id')
    const state = stateOf(runtime, 's1')!
    expect(state.run).toBe('running')
    expect(state).not.toHaveProperty('sleeping')
  })

  it('reopenSession clears sleeping', () => {
    const session = makeSession({ id: 's1' })
    const { controller, runtime } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')
    controller.sleepSession('s1')

    controller.reopenSession('s1')

    const state = stateOf(runtime, 's1')!
    expect(state.run).toBe('running')
    expect(state).not.toHaveProperty('sleeping')
  })

  it('restartSession clears sleeping', async () => {
    const session = makeSession({ id: 's1' })
    const { controller, runtime } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')
    controller.sleepSession('s1')

    await controller.restartSession('s1')

    const state = stateOf(runtime, 's1')!
    expect(state.run).toBe('running')
    expect(state).not.toHaveProperty('sleeping')
  })

  it('closing a sleeping session clears sleeping and closes it as before', () => {
    const session = makeSession({ id: 's1' })
    const { controller, store, runtime } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')
    controller.sleepSession('s1')

    controller.closeSession('s1')

    expect(store.get().sessions[0].closedAt).toEqual(expect.any(Number))
    const state = stateOf(runtime, 's1')!
    expect(state).not.toHaveProperty('sleeping')
  })

  it('removing a sleeping session works as before', () => {
    const session = makeSession({ id: 's1' })
    const { controller, store, runtime } = setup([session])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s1')
    controller.sleepSession('s1')

    controller.removeSession('s1')

    expect(store.get().sessions).toHaveLength(0)
    expect(runtime.get('s1')).toBeUndefined()
  })
})

describe('sessionController.resumeInBackground (D50)', () => {
  it('starts a stopped session with --resume without changing the active session', () => {
    const { controller, pty, runtime } = setup([makeSession({ id: 'a' }), makeSession({ id: 'b' })])
    controller.setActiveSession('b')
    expect(controller.resumeInBackground('a')).toBe(true)
    expect(pty.isRunning('a')).toBe(true)
    expect(pty.getLastStartOpts('a')?.internalArgs).toContain('--resume')
    expect(stateOf(runtime, 'a')?.run).toBe('running')
    expect(controller.getActiveSessionId()).toBe('b')
  })

  it('refuses unknown, closed and already running sessions', () => {
    const { controller, pty } = setup([makeSession({ id: 'a' }), makeSession({ id: 'closed', closedAt: 5 })])
    expect(controller.resumeInBackground('nope')).toBe(false)
    expect(controller.resumeInBackground('closed')).toBe(false)
    expect(pty.isRunning('closed')).toBe(false)
    controller.resumeInBackground('a')
    expect(controller.resumeInBackground('a')).toBe(false)
  })

  it('does not start a second process when the user opens the session right after', () => {
    const { controller, pty } = setup([makeSession({ id: 'a' })])
    controller.resumeInBackground('a')
    const first = pty.getLastStartOpts('a')
    controller.setActiveSession('a')
    expect(pty.getLastStartOpts('a')).toBe(first)
  })
})
