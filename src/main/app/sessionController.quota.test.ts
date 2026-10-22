import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AttentionReason, HookEvent, Id, Session, StoreData } from '../../shared/types'
import { SessionStore } from '../store'
import type { PtyManager, StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention/AttentionService'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtimeRegistry'
import { createSessionController, type SessionController } from './sessionController'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-quota-ctl-'))
  dirs.push(dir)
  return dir
}

const LIMIT_LINE = 'Claude usage limit reached. Your limit will reset at 5pm (Europe/Berlin).'

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

function storeData(sessions: Session[]): StoreData {
  return { version: 1, sessions, groups: [], statuses: [], groupOrder: [] }
}

interface FakePty {
  pty: PtyManager
  readonly starts: StartOptions[]
  failNextStart: boolean
  fireData(id: Id, data: string): void
  fireExit(id: Id, code: number | null): void
  setRunning(id: Id): void
}

function createFakePty(): FakePty {
  const running = new Set<Id>()
  const exitListeners = new Set<(id: Id, code: number | null) => void>()
  let dataListener: (id: Id, data: string, seq: number) => void = () => {}
  const fake: FakePty = {
    pty: undefined as unknown as PtyManager,
    starts: [],
    failNextStart: false,
    fireData(id: Id, data: string): void {
      dataListener(id, data, 0)
    },
    fireExit(id: Id, code: number | null): void {
      running.delete(id)
      for (const cb of exitListeners) cb(id, code)
    },
    setRunning(id: Id): void {
      running.add(id)
    }
  }
  const start = (opts: StartOptions): void => {
    if (fake.failNextStart) {
      fake.failNextStart = false
      throw new Error('spawn failed')
    }
    fake.starts.push(opts)
    running.add(opts.sessionId)
  }
  fake.pty = {
    start,
    restart: start,
    kill(id: Id): void {
      running.delete(id)
    },
    isRunning: (id: Id): boolean => running.has(id),
    replay: (): { data: string; seq: number } => ({ data: '', seq: 0 }),
    onData(cb: (id: Id, data: string, seq: number) => void): () => void {
      dataListener = cb
      return () => {}
    },
    onExit(cb: (id: Id, code: number | null) => void): () => void {
      exitListeners.add(cb)
      return () => exitListeners.delete(cb)
    }
  } as unknown as PtyManager
  return fake
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
    markUnread: () => undefined,
    get: (id: string) => map.get(id) ?? null,
    onChange: () => () => {},
    setSoundEnabled: () => {},
    suspend: () => {},
    forget: (id: string) => map.delete(id),
    raise: (id: string, reason: AttentionReason) => map.set(id, reason)
  } as unknown as AttentionService
}

interface Harness {
  readonly controller: SessionController
  readonly fake: FakePty
  readonly runtime: RuntimeRegistry
  readonly onUsageLimit: ReturnType<typeof vi.fn>
}

function setup(sessions: Session[], withHook = true): Harness {
  const store = new SessionStore(storeData(sessions), { schedule: vi.fn() }, { newId: () => 'x', now: () => 1 })
  const fake = createFakePty()
  const runtime = createRuntimeRegistry()
  const onUsageLimit = vi.fn()
  const controller = createSessionController({
    store,
    pty: fake.pty,
    attention: createFakeAttention(),
    runtime,
    sendPtyData: () => {},
    userDataDir: tempDir(),
    ...(withHook ? { onUsageLimit } : {})
  })
  return { controller, fake, runtime, onUsageLimit }
}

function hook(sessionId: Id, event: HookEvent['event']): HookEvent {
  return { sessionId, event }
}

describe('sessionController usage-limit signal', () => {
  it('reports the usage limit once for a turn, even when the message arrives in several chunks', () => {
    const { controller, fake, onUsageLimit } = setup([makeSession({ id: 's1' })])
    controller.handleHookEvent(hook('s1', 'UserPromptSubmit'))
    fake.fireData('s1', 'Claude usage ')
    fake.fireData('s1', 'limit reached. Your limit will reset')
    fake.fireData('s1', ' at 5pm')
    fake.fireData('s1', LIMIT_LINE)
    expect(onUsageLimit).toHaveBeenCalledTimes(1)
    expect(onUsageLimit).toHaveBeenCalledWith('s1')
  })

  it('re-arms the signal for the next turn after a UserPromptSubmit hook event', () => {
    const { controller, fake, onUsageLimit } = setup([makeSession({ id: 's1' })])
    controller.handleHookEvent(hook('s1', 'UserPromptSubmit'))
    fake.fireData('s1', LIMIT_LINE)
    controller.handleHookEvent(hook('s1', 'UserPromptSubmit'))
    fake.fireData('s1', LIMIT_LINE)
    expect(onUsageLimit).toHaveBeenCalledTimes(2)
  })

  it('ignores an old limit message redrawn by a restarted (resumed) session until a new prompt is sent', async () => {
    const { controller, fake, onUsageLimit } = setup([makeSession({ id: 's1' })])
    controller.initializeRestoredSessions()
    controller.handleHookEvent(hook('s1', 'UserPromptSubmit'))
    await controller.restartSession('s1')
    fake.fireData('s1', LIMIT_LINE)
    expect(onUsageLimit).not.toHaveBeenCalled()
    controller.handleHookEvent(hook('s1', 'UserPromptSubmit'))
    fake.fireData('s1', LIMIT_LINE)
    expect(onUsageLimit).toHaveBeenCalledTimes(1)
  })

  it('ignores a limit message when no prompt was sent in this process', () => {
    const { fake, onUsageLimit } = setup([makeSession({ id: 's1' })])
    fake.fireData('s1', LIMIT_LINE)
    expect(onUsageLimit).not.toHaveBeenCalled()
  })

  it('ignores the message of an OpenCode session', () => {
    const { controller, fake, onUsageLimit } = setup([makeSession({ id: 'o1', agent: 'opencode' })])
    controller.handleHookEvent(hook('o1', 'UserPromptSubmit'))
    fake.fireData('o1', LIMIT_LINE)
    expect(onUsageLimit).not.toHaveBeenCalled()
  })

  it('ignores ordinary output', () => {
    const { fake, onUsageLimit } = setup([makeSession({ id: 's1' })])
    fake.fireData('s1', 'Reading src/app.ts\r\nDone.')
    expect(onUsageLimit).not.toHaveBeenCalled()
  })

  it('keeps working without an onUsageLimit dependency', () => {
    const { fake } = setup([makeSession({ id: 's1' })], false)
    expect(() => fake.fireData('s1', LIMIT_LINE)).not.toThrow()
  })
})

describe('sessionController.wakeSession', () => {
  it('resumes a sleeping session and returns true, without changing the active session', () => {
    const { controller, fake, runtime } = setup([makeSession({ id: 's1' }), makeSession({ id: 's2' })])
    controller.initializeRestoredSessions()
    controller.setActiveSession('s2')
    fake.setRunning('s1')
    runtime.markRunning('s1')
    controller.sleepSession('s1')
    expect(runtime.get('s1')?.sleeping).toBe(true)

    expect(controller.wakeSession('s1')).toBe(true)

    const last = fake.starts[fake.starts.length - 1]
    expect(last.sessionId).toBe('s1')
    expect(last.claudeArgs.join(' ') + last.internalArgs.join(' ')).toContain('--resume')
    expect(runtime.get('s1')?.run).toBe('running')
    expect(runtime.get('s1')?.sleeping).toBeUndefined()
    expect(controller.getActiveSessionId()).toBe('s2')
  })

  it('returns false for a session that is not sleeping', () => {
    const { controller, fake, runtime } = setup([makeSession({ id: 's1' })])
    fake.setRunning('s1')
    runtime.markRunning('s1')
    expect(controller.wakeSession('s1')).toBe(false)
    expect(fake.starts).toHaveLength(0)
  })

  it('returns false for an unknown session', () => {
    const { controller } = setup([])
    expect(controller.wakeSession('missing')).toBe(false)
  })

  it('returns false for a closed session even if it was asleep', () => {
    const { controller, fake, runtime } = setup([makeSession({ id: 's1', closedAt: 5 })])
    runtime.markSleeping('s1')
    expect(controller.wakeSession('s1')).toBe(false)
    expect(fake.starts).toHaveLength(0)
  })

  it('returns false and leaves the session exited when the process cannot start', () => {
    const { controller, fake, runtime } = setup([makeSession({ id: 's1' })])
    fake.setRunning('s1')
    runtime.markRunning('s1')
    controller.sleepSession('s1')
    fake.failNextStart = true
    expect(controller.wakeSession('s1')).toBe(false)
    expect(runtime.get('s1')?.run).toBe('exited')
  })
})
